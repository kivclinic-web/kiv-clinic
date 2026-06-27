// API client — single POST endpoint, text/plain (CORS-safe), {ok,data|error} envelope, idempotency.
import { API_BASE } from './config.js';

const TOKEN_KEY = 'kiv_token';
const SESSION_KEY = 'kiv_session';

let _token = localStorage.getItem(TOKEN_KEY) || null;
let _session = safeParse(localStorage.getItem(SESSION_KEY)) || null;

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
export function getToken() { return _token; }
export function getSession() { return _session; }
export function setSession(token, session) {
  _token = token; _session = session;
  if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY);
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(SESSION_KEY);
}
export function clearSession() { setSession(null, null); }
export function isAdmin() { return _session && _session.role === 'administrator'; }

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));

/** Typed client error carrying the server's stable code. */
export class ApiError extends Error {
  constructor(code, message, fields) { super(message || code); this.code = code; this.fields = fields || null; }
}

/**
 * Call the API. Mutations auto-attach a requestId (idempotency).
 * Resolves to `data` on success; throws ApiError on failure.
 */
export async function api(action, payload = {}, { mutating = false, requestId } = {}) {
  const body = JSON.stringify({
    action, token: _token || undefined,
    requestId: mutating ? (requestId || uuid()) : undefined, payload
  });
  let res, text;
  try {
    res = await fetch(API_BASE, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
    text = await res.text();
  } catch (e) {
    throw new ApiError('NETWORK', 'Could not reach the server. Check your connection.');
  }
  let json;
  try { json = JSON.parse(text); }
  catch { throw new ApiError('INTERNAL', 'Unexpected server response.'); }
  if (!json.ok) {
    const err = json.error || {};
    if (err.code === 'AUTH_INVALID' || err.code === 'AUTH_REQUIRED') {
      // Session no longer valid — drop it so the app routes to login.
      if (_token) clearSession();
    }
    throw new ApiError(err.code || 'INTERNAL', err.message, err.fields);
  }
  return json.data;
}

// Human-readable fallbacks for the stable error codes (never show raw codes).
const HUMAN = {
  NETWORK: 'Could not reach the server. Check your connection and try again.',
  AUTH_REQUIRED: 'Please sign in again.',
  AUTH_INVALID: 'Your session expired. Please sign in again.',
  AUTH_LOCKED: 'Too many attempts. This account is locked for a few minutes.',
  FORBIDDEN: 'You don’t have permission to do that.',
  VALIDATION_ERROR: 'Please check the highlighted fields.',
  NOT_FOUND: 'That record could not be found.',
  CONFLICT: 'That already exists.',
  FK_VIOLATION: 'A linked record is missing or invalid.',
  OUT_OF_STOCK: 'Not enough stock to dispense that quantity.',
  STORAGE_FULL: 'Document storage is full — free space before uploading.',
  RATE_LIMITED: 'The system is busy. Please try again in a moment.',
  INTERNAL: 'Something went wrong. Please try again.'
};
export function humanError(err) {
  if (err && err.message && err.code !== 'INTERNAL' && err.code !== 'NETWORK') return err.message;
  return (err && HUMAN[err.code]) || HUMAN.INTERNAL;
}
