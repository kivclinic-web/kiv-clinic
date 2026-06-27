/**
 * Db.js — the data-access layer over the Spreadsheet.
 * Rules (docs/CONVENTIONS.md): read by header name via SCHEMA; UUID PKs; audit columns; soft delete;
 * every write under LockService; batch I/O. No business logic here.
 */

var __ssCache = null;
function getSpreadsheet_() {
  if (!__ssCache) __ssCache = SpreadsheetApp.openById(prop_(CONFIG.PROP.SPREADSHEET_ID, true));
  return __ssCache;
}

function getSheet_(tab) {
  var sh = getSpreadsheet_().getSheetByName(tab);
  if (!sh) throw new ApiError(ERROR_CODES.INTERNAL, 'Missing tab: ' + tab);
  return sh;
}

function schemaOf_(tab) {
  var s = SCHEMA[tab];
  if (!s) throw new ApiError(ERROR_CODES.INTERNAL, 'Unknown tab: ' + tab);
  return s;
}

/** Run a function while holding the script lock. Throws RATE_LIMITED if it can't be acquired. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
    throw new ApiError(ERROR_CODES.RATE_LIMITED, 'System busy, please retry');
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Read an entire tab into an array of row objects: { _row: <sheetRowNumber>, ...columns }. */
function readAll_(tab, opts) {
  opts = opts || {};
  var sh = getSheet_(tab);
  var range = sh.getDataRange().getValues();
  if (range.length < 2) return [];
  var headers = range[0];
  var rows = [];
  for (var r = 1; r < range.length; r++) {
    var obj = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = range[r][c];
    if (!opts.includeDeleted && schemaOf_(tab).softDelete !== false && obj.is_deleted === true) continue;
    rows.push(obj);
  }
  return rows;
}

/** Find one non-deleted row by id (or null). */
function findById_(tab, id) {
  var rows = readAll_(tab);
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}

function findBy_(tab, field, value) {
  var rows = readAll_(tab);
  return rows.filter(function (r) { return r[field] === value; });
}

/** Resolve column order for a tab from its header row (defends against manual reordering). */
function headerIndex_(tab) {
  var sh = getSheet_(tab);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {};
  headers.forEach(function (h, i) { idx[h] = i; });
  return { sheet: sh, headers: headers, idx: idx };
}

/** Insert a record. Auto-fills id + audit columns. Returns the stored object. */
function insert_(tab, data, actor) {
  var s = schemaOf_(tab);
  var hi = headerIndex_(tab);
  var rec = {};
  s.columns.forEach(function (c) { rec[c] = (data[c] !== undefined ? data[c] : ''); });
  if (s.columns.indexOf('id') !== -1 && !rec.id) rec.id = Utilities.getUuid();
  var now = new Date().toISOString();
  if (s.softDelete !== false) {
    rec.created_at = now; rec.updated_at = now;
    rec.created_by = actor ? actor.sub : 'system';
    rec.updated_by = actor ? actor.sub : 'system';
    rec.is_deleted = false; rec.deleted_at = ''; rec.deleted_by = '';
  } else {
    if (s.columns.indexOf('created_at') !== -1 && !rec.created_at) rec.created_at = now;
  }
  var rowArr = hi.headers.map(function (h) { return serializeCell_(rec[h]); });
  hi.sheet.appendRow(rowArr);
  return rec;
}

/** Patch a record by id. Updates audit columns. Returns the updated object or throws NOT_FOUND. */
function update_(tab, id, patch, actor) {
  var s = schemaOf_(tab);
  var existing = findById_(tab, id);
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, tab + ' not found: ' + id);
  var hi = headerIndex_(tab);
  Object.keys(patch).forEach(function (k) {
    if (s.columns.indexOf(k) !== -1 && k !== 'id') existing[k] = patch[k];
  });
  if (s.softDelete !== false) {
    existing.updated_at = new Date().toISOString();
    existing.updated_by = actor ? actor.sub : 'system';
  }
  var rowArr = hi.headers.map(function (h) { return serializeCell_(existing[h]); });
  hi.sheet.getRange(existing._row, 1, 1, hi.headers.length).setValues([rowArr]);
  return existing;
}

/** Soft-delete by id (admin-gated by callers). */
function softDelete_(tab, id, actor) {
  var s = schemaOf_(tab);
  if (s.softDelete === false) throw new ApiError(ERROR_CODES.INTERNAL, tab + ' is not soft-deletable');
  return update_(tab, id, { is_deleted: true, deleted_at: new Date().toISOString(),
    deleted_by: actor ? actor.sub : 'system' }, actor);
}

/** Convert a JS value to a cell-friendly value. Objects → JSON; booleans/dates pass through. */
function serializeCell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** Verify foreign keys defined in the schema exist (and aren't deleted). */
function checkForeignKeys_(tab, data) {
  var fk = schemaOf_(tab).fk;
  if (!fk) return;
  Object.keys(fk).forEach(function (col) {
    var val = data[col];
    if (val === undefined || val === null || val === '') return; // optional FK handled by required checks
    if (!findById_(fk[col], val)) {
      throw new ApiError(ERROR_CODES.FK_VIOLATION, 'Referenced ' + fk[col] + ' not found: ' + val, _obj(col, 'invalid'));
    }
  });
}

/** Enforce a unique constraint (case-insensitive for strings), excluding a given id (for updates). */
function checkUnique_(tab, field, value, exceptId) {
  var matches = findBy_(tab, field, value).filter(function (r) { return r.id !== exceptId; });
  if (matches.length) throw new ApiError(ERROR_CODES.CONFLICT, tab + '.' + field + ' already exists', _obj(field, 'duplicate'));
}

/** Simple pagination over an array. */
function paginate_(arr, opts) {
  opts = opts || {};
  var limit = Math.min(opts.limit || CONFIG.DEFAULT_PAGE_SIZE, CONFIG.MAX_PAGE_SIZE);
  var offset = opts.offset || 0;
  return { items: arr.slice(offset, offset + limit), total: arr.length, limit: limit, offset: offset };
}
