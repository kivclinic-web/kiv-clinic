/**
 * Validate.js — server-side validation/coercion helpers. All input is validated here before any write.
 */

function v_required_(obj, fields) {
  var missing = {};
  fields.forEach(function (f) {
    var val = obj[f];
    if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
      missing[f] = 'required';
    }
  });
  if (Object.keys(missing).length) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Missing required fields', missing);
}

function v_enum_(value, enumName) {
  if (value === undefined || value === null || value === '') return value;
  if (ENUMS[enumName].indexOf(value) === -1) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Invalid ' + enumName + ': ' + value,
      _obj(enumName, 'must be one of ' + ENUMS[enumName].join(', ')));
  }
  return value;
}

function v_string_(value, max) {
  if (value === undefined || value === null) return '';
  var s = String(value).trim();
  if (max && s.length > max) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Value too long (max ' + max + ')');
  return s;
}

function v_number_(value, opts) {
  opts = opts || {};
  if (value === '' || value === null || value === undefined) {
    if (opts.required) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Number required');
    return null;
  }
  var n = Number(value);
  if (isNaN(n)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Not a number: ' + value);
  if (opts.min !== undefined && n < opts.min) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Must be >= ' + opts.min);
  if (opts.integer && Math.floor(n) !== n) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Must be an integer');
  return n;
}

function v_email_(value, required) {
  var s = v_string_(value);
  if (!s) { if (required) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Email required'); return ''; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Invalid email', { email: 'invalid' });
  return s.toLowerCase();
}

/** Normalize a mobile number to digits (for unique comparison + storage). */
function normalizeMobile_(value) {
  var digits = String(value || '').replace(/[^0-9]/g, '');
  return digits;
}

function v_mobile_(value, required) {
  var d = normalizeMobile_(value);
  if (!d) { if (required) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Mobile required', { mobile: 'required' }); return ''; }
  if (d.length < 7 || d.length > 15) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Invalid mobile number', { mobile: 'invalid' });
  return d;
}

function v_date_(value, required) {
  if (!value) { if (required) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Date required'); return null; }
  var d = (value instanceof Date) ? value : new Date(value);
  if (isNaN(d.getTime())) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Invalid date: ' + value);
  return d;
}

function v_bool_(value) { return value === true || value === 'true' || value === 1 || value === '1'; }

function _obj(k, val) { var o = {}; o[k] = val; return o; }
