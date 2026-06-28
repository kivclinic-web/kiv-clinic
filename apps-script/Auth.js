/**
 * Auth.js — password hashing, HMAC session tokens, login, RBAC, throttling, user management.
 * See docs/CONVENTIONS.md (Auth & security). Passwords are NEVER stored in plaintext.
 */

// ---------- hashing ----------
function genSalt_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }

function bytesToHex_(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** Key-stretched salted SHA-256. */
function hashPassword_(plain, salt) {
  var data = salt + '|' + plain;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data, Utilities.Charset.UTF_8);
  for (var i = 1; i < CONFIG.HASH_ITERATIONS; i++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytesToHex_(digest) + salt);
  }
  return bytesToHex_(digest);
}

/** Constant-time-ish string compare. */
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}

/** Generate a readable but strong temporary password. */
function generatePassword_() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + new Date().getTime());
  var out = '';
  for (var i = 0; i < 14; i++) out += alphabet[(bytes[i] < 0 ? bytes[i] + 256 : bytes[i]) % alphabet.length];
  return out.slice(0, 4) + '-' + out.slice(4, 9) + '-' + out.slice(9, 14);
}

// ---------- HMAC tokens (stateless sessions) ----------
function b64url_(bytesOrString) {
  var b64 = (typeof bytesOrString === 'string')
    ? Utilities.base64EncodeWebSafe(bytesOrString)
    : Utilities.base64EncodeWebSafe(bytesOrString);
  return b64.replace(/=+$/, '');
}

function signToken_(claims) {
  var secret = prop_(CONFIG.PROP.TOKEN_SECRET, true);
  var payload = b64url_(JSON.stringify(claims));
  var sig = b64url_(Utilities.computeHmacSha256Signature(payload, secret));
  return payload + '.' + sig;
}

function issueToken_(user) {
  var claims = { sub: user.id, role: user.role, jti: Utilities.getUuid(),
    exp: new Date().getTime() + CONFIG.TOKEN_TTL_MS };
  return { token: signToken_(claims), claims: claims };
}

function verifyToken_(token) {
  if (!token) throw new ApiError(ERROR_CODES.AUTH_REQUIRED, 'Authentication required');
  var parts = String(token).split('.');
  if (parts.length !== 2) throw new ApiError(ERROR_CODES.AUTH_INVALID, 'Malformed token');
  var secret = prop_(CONFIG.PROP.TOKEN_SECRET, true);
  var expected = b64url_(Utilities.computeHmacSha256Signature(parts[0], secret));
  if (!safeEqual_(expected, parts[1])) throw new ApiError(ERROR_CODES.AUTH_INVALID, 'Invalid token signature');
  var claims;
  try { claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); }
  catch (e) { throw new ApiError(ERROR_CODES.AUTH_INVALID, 'Invalid token payload'); }
  if (!claims.exp || claims.exp < new Date().getTime()) throw new ApiError(ERROR_CODES.AUTH_INVALID, 'Token expired');
  if (isTokenRevoked_(claims.jti)) throw new ApiError(ERROR_CODES.AUTH_INVALID, 'Token revoked');
  return claims;
}

// Revocation set is cached cross-request in CacheService (P5) so the hot auth path does a cheap
// cache get instead of a full revoked_tokens sheet read on EVERY authenticated request. The sheet
// stays the durable source of truth; on a cache miss (cold start / TTL expiry) we rebuild from it,
// and logout_ invalidates the key so a freshly revoked jti is reflected immediately.
var REVOKED_CACHE_KEY = 'revoked_set';
var REVOKED_CACHE_TTL = 600; // seconds; backstop — the sheet is authoritative

function revokedSet_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(REVOKED_CACHE_KEY);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  var set = {};
  readAll_('revoked_tokens').forEach(function (r) { if (r.jti) set[r.jti] = 1; });
  try { cache.put(REVOKED_CACHE_KEY, JSON.stringify(set), REVOKED_CACHE_TTL); } catch (e) {}
  return set;
}

function isTokenRevoked_(jti) {
  return !!revokedSet_()[jti];
}

// ---------- request auth + RBAC ----------
function requireAuth_(req) { return verifyToken_(req.token); }

function requireRole_(actor, role) {
  if (actor.role !== role) throw new ApiError(ERROR_CODES.FORBIDDEN, 'Requires ' + role + ' role');
  return actor;
}

function requireAdmin_(actor) { return requireRole_(actor, 'administrator'); }

// ---------- login / logout ----------
function login_(req) {
  var identifier = (req.payload.identifier_type === 'mobile')
    ? normalizeMobile_(req.payload.identifier) : v_string_(req.payload.identifier).toLowerCase();
  var password = req.payload.password;
  if (!identifier || !password) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'identifier and password required');

  return withLock_(function () {
    var users = findBy_('auth_users', 'identifier', identifier);
    var user = users[0];
    // Uniform failure to avoid user enumeration.
    if (!user) throw new ApiError(ERROR_CODES.AUTH_INVALID, 'Invalid credentials');
    if (user.status === 'disabled') throw new ApiError(ERROR_CODES.FORBIDDEN, 'Account disabled');
    if (user.locked_until && new Date(user.locked_until).getTime() > new Date().getTime()) {
      throw new ApiError(ERROR_CODES.AUTH_LOCKED, 'Account temporarily locked. Try later.');
    }
    var computed = hashPassword_(password, user.password_salt);
    if (!safeEqual_(computed, String(user.password_hash))) {
      var attempts = Number(user.failed_attempts || 0) + 1;
      var patch = { failed_attempts: attempts };
      if (attempts >= CONFIG.MAX_FAILED_ATTEMPTS) {
        patch.locked_until = new Date(new Date().getTime() + CONFIG.LOCKOUT_MS).toISOString();
        patch.failed_attempts = 0;
      }
      update_('auth_users', user.id, patch, null);
      writeAudit_('auth.login_failed', 'auth_users', user.id, { attempts: attempts });
      throw new ApiError(ERROR_CODES.AUTH_INVALID, 'Invalid credentials');
    }
    update_('auth_users', user.id, { failed_attempts: 0, locked_until: '', last_login_at: new Date().toISOString() }, null);
    var t = issueToken_(user);
    writeAudit_('auth.login', 'auth_users', user.id, null, { sub: user.id, role: user.role });
    return { token: t.token, role: user.role, display_name: user.display_name, must_reset: v_bool_(user.must_reset) };
  });
}

function logout_(req) {
  var actor = requireAuth_(req);
  getSheet_('revoked_tokens').appendRow([actor.jti, actor.sub, new Date().toISOString(),
    new Date(actor.exp).toISOString()]);
  invalidateRead_('revoked_tokens');
  CacheService.getScriptCache().remove(REVOKED_CACHE_KEY); // force rebuild incl. this jti (P5)
  writeAudit_('auth.logout', 'auth_users', actor.sub, null, actor);
  return ok_({ loggedOut: true });
}

function changePassword_(req) {
  var actor = requireAuth_(req);
  var user = findById_('auth_users', actor.sub);
  if (!user) throw new ApiError(ERROR_CODES.NOT_FOUND, 'User not found');
  if (!safeEqual_(hashPassword_(req.payload.old, user.password_salt), String(user.password_hash))) {
    throw new ApiError(ERROR_CODES.AUTH_INVALID, 'Current password incorrect');
  }
  var newPlain = v_string_(req.payload.new);
  if (newPlain.length < 8) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Password must be at least 8 characters');
  var salt = genSalt_();
  update_('auth_users', user.id, { password_salt: salt, password_hash: hashPassword_(newPlain, salt), must_reset: false }, actor);
  writeAudit_('auth.password_change', 'auth_users', user.id, null, actor);
  return ok_({ changed: true });
}

// ---------- user management (admin) ----------
function bootstrapAdmin_(req) {
  var token = req.payload && req.payload.bootstrap_token;
  if (!token || !safeEqual_(String(token), prop_(CONFIG.PROP.BOOTSTRAP_ADMIN_TOKEN, true))) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, 'Invalid bootstrap token');
  }
  return withLock_(function () {
    var admins = readAll_('auth_users').filter(function (u) { return u.role === 'administrator'; });
    if (admins.length) throw new ApiError(ERROR_CODES.CONFLICT, 'Administrator already exists');
    var created = createUserRecord_({ identifier: req.payload.identifier, identifier_type: req.payload.identifier_type,
      display_name: req.payload.display_name, role: 'administrator' }, null);
    writeAudit_('auth.bootstrap_admin', 'auth_users', created.user.id, null, { sub: 'system', role: 'system' });
    return ok_({ id: created.user.id, identifier: created.user.identifier, password: created.password,
      note: 'Store this password securely — it is shown only once.' });
  });
}

function createUser_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  return withLock_(function () {
    var created = createUserRecord_(req.payload, actor);
    writeAudit_('users.create', 'auth_users', created.user.id, { role: created.user.role }, actor);
    return ok_({ id: created.user.id, identifier: created.user.identifier, role: created.user.role,
      password: created.password, note: 'Deliver securely; shown only once.' });
  });
}

/** Shared user creation: validates, generates password, hashes, inserts. Returns {user, password}. */
function createUserRecord_(payload, actor) {
  v_required_(payload, ['identifier', 'identifier_type', 'display_name']);
  var type = v_enum_(payload.identifier_type, 'identifier_type');
  var identifier = (type === 'email') ? v_email_(payload.identifier, true) : v_mobile_(payload.identifier, true);
  var role = v_enum_(payload.role || 'manager', 'role');
  checkUnique_('auth_users', 'identifier', identifier);
  var plain = generatePassword_();
  var salt = genSalt_();
  var user = insert_('auth_users', {
    identifier: identifier, identifier_type: type, display_name: v_string_(payload.display_name, 120),
    role: role, password_hash: hashPassword_(plain, salt), password_salt: salt,
    status: 'active', must_reset: true, failed_attempts: 0, locked_until: '', last_login_at: ''
  }, actor);
  return { user: user, password: plain };
}

function listUsers_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  var users = readAll_('auth_users').map(function (u) {
    return { id: u.id, identifier: u.identifier, identifier_type: u.identifier_type,
      display_name: u.display_name, role: u.role, status: u.status, last_login_at: u.last_login_at };
  });
  return ok_(users);
}

function updateUser_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  var id = req.payload.id;
  var patch = {};
  if (req.payload.display_name !== undefined) patch.display_name = v_string_(req.payload.display_name, 120);
  if (req.payload.role !== undefined) patch.role = v_enum_(req.payload.role, 'role');
  if (req.payload.status !== undefined) patch.status = v_enum_(req.payload.status, 'user_status');
  var updated = update_('auth_users', id, patch, actor);
  writeAudit_('users.update', 'auth_users', id, patch, actor);
  return ok_({ id: updated.id });
}
