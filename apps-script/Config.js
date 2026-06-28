/**
 * Config.js — central configuration, secrets, and constants.
 * Secrets/IDs live ONLY in Script Properties (never hardcoded/committed). See docs/CONVENTIONS.md.
 */

var CONFIG = {
  SCHEMA_VERSION: 1,

  // Auth / security
  // Key-stretching for password hashing. NOTE: each iteration is a Utilities.computeDigest call,
  // which on Apps Script costs ~0.3 ms — so 100000 made every login ~30 s AND it ran under the
  // global script lock (→ RATE_LIMITED for concurrent logins). 2500 keeps meaningful stretching
  // (~1 s) given the private sheet + login throttling + HMAC tokens. Hashes are self-describing
  // (see Auth.js hashPassword_/verifyPassword_) so old 100k hashes still verify and upgrade on login.
  HASH_ITERATIONS: 2500,
  LEGACY_HASH_ITERATIONS: 100000, // bare-hex hashes (no "v1$" prefix) were stretched this many times
  TOKEN_TTL_MS: 1000 * 60 * 60 * 8, // 8h session token
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_MS: 1000 * 60 * 15,     // 15 min lockout after too many failures

  // Concurrency
  LOCK_TIMEOUT_MS: 25000,         // wait up to 25s for the script lock

  // Listing
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 200,

  // Business rules (from PRD)
  ACTIVE_APPT_WINDOW_DAYS: 7,
  RECENT_CONSULTATIONS: 3,
  LOW_STOCK_THRESHOLD: 3,
  EXPIRY_WARN_MONTHS: 6,
  DEWORM_INTERVAL_MONTHS: 3,
  DEWORM_MIN_AGE_MONTHS: 6,
  FOLLOWUP_INTERVALS: { '5d': 5, '1w': 7 },

  // Storage
  DRIVE_TOTAL_BYTES: 15 * 1024 * 1024 * 1024, // 15 GB free quota
  DEFAULT_STORAGE_WARN_PCT: 85,

  // Property keys (Script Properties)
  PROP: {
    SPREADSHEET_ID: 'SPREADSHEET_ID',
    DRIVE_ROOT_FOLDER_ID: 'DRIVE_ROOT_FOLDER_ID',
    DOCS_FOLDER_ID: 'DOCS_FOLDER_ID',
    PRESCRIPTIONS_FOLDER_ID: 'PRESCRIPTIONS_FOLDER_ID',
    BACKUPS_FOLDER_ID: 'BACKUPS_FOLDER_ID',
    TOKEN_SECRET: 'TOKEN_SECRET',
    BOOTSTRAP_ADMIN_TOKEN: 'BOOTSTRAP_ADMIN_TOKEN',
    SCHEMA_VERSION: 'SCHEMA_VERSION'
  }
};

/**
 * Read a Script Property (throws if a required one is missing).
 * Memoized per execution (P6) — properties are stable within a request, so repeated reads of
 * SPREADSHEET_ID / TOKEN_SECRET etc. avoid extra PropertiesService round trips.
 */
var __propCache = {};
function prop_(key, required) {
  var v = (key in __propCache) ? __propCache[key]
    : (__propCache[key] = PropertiesService.getScriptProperties().getProperty(key));
  if (required && !v) throw new ApiError('INTERNAL', 'Missing script property: ' + key);
  return v;
}

/** Set a Script Property (keeps the per-execution cache consistent). */
function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
  __propCache[key] = value;
}
