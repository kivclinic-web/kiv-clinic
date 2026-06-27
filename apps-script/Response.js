/**
 * Response.js — uniform success/error envelopes + typed errors.
 * See docs/API-CONTRACT.md for the contract and stable error codes.
 */

var ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID: 'AUTH_INVALID',
  AUTH_LOCKED: 'AUTH_LOCKED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FK_VIOLATION: 'FK_VIOLATION',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  STORAGE_FULL: 'STORAGE_FULL',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL: 'INTERNAL'
};

/** Typed error carrying a stable client-facing code. */
function ApiError(code, message, fields) {
  this.name = 'ApiError';
  this.code = code || ERROR_CODES.INTERNAL;
  this.message = message || 'Unexpected error';
  this.fields = fields || null;
}
ApiError.prototype = Object.create(Error.prototype);

/** Build a success envelope. */
function ok_(data, extraMeta) {
  var meta = { schema_version: CONFIG.SCHEMA_VERSION };
  if (extraMeta) Object.keys(extraMeta).forEach(function (k) { meta[k] = extraMeta[k]; });
  return { ok: true, data: data === undefined ? null : data, meta: meta };
}

/** Build an error envelope. */
function err_(code, message, fields) {
  return { ok: false, error: { code: code, message: message, fields: fields || undefined },
           meta: { schema_version: CONFIG.SCHEMA_VERSION } };
}

/** Serialize an object as a JSON text response (CORS-safe simple response). */
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
