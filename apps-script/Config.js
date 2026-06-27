/**
 * Config.js — central configuration, secrets, and constants.
 * Secrets/IDs live ONLY in Script Properties (never hardcoded/committed). See docs/CONVENTIONS.md.
 */

var CONFIG = {
  SCHEMA_VERSION: 1,

  // Auth / security
  HASH_ITERATIONS: 100000,        // key-stretching for password hashing
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

/** Read a Script Property (throws if a required one is missing). */
function prop_(key, required) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !v) throw new ApiError('INTERNAL', 'Missing script property: ' + key);
  return v;
}

/** Set a Script Property. */
function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}
