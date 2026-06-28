// core.js — shared primitives for every screen: helpers, data hooks, the write-feedback mutation
// pattern, toasts, modal + form controls. Screen modules import ONLY from here (no circular deps).
import { html, render, useState, useEffect, useRef } from './vendor/preact-standalone.module.js';
import { api, humanError, ApiError, isAdmin, getSession, subscribeActivity, getActivity, uuid } from './api.js';
import { Icon } from './icons.js';
export { html, useState, useEffect, useRef, render, api, humanError, ApiError, isAdmin, getSession, Icon, uuid };

/* ---------- formatting helpers ---------- */
const PALETTE = ['#0E7C6E', '#6E5BB0', '#B07C2C', '#3A6E96', '#BB493B', '#0A5A50', '#9A6A2C'];
export const initials = (n = '') => n.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
export const colorFor = (k = '') => { let h = 0; for (const c of String(k)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
export const asList = (x) => Array.isArray(x) ? x : (x && x.items) || [];
export const TYPE_CLS = { OPD: 'opd', Surgery: 'surgery', Grooming: 'groom', FollowUp: 'followup', Vaccination: 'vacc' };
export const TYPE_LABEL = (t) => (t === 'FollowUp' ? 'Follow-up' : t);
export const BAR = { OPD: '#0E7C6E', Surgery: '#BB493B', Grooming: '#6E5BB0', FollowUp: '#B07C2C' };
export const APPT_STAT = { completed: ['done', 'Done'], scheduled: ['wait', 'Waiting'], rescheduled: ['prog', 'Rescheduled'], cancelled: ['cancel', 'Cancelled'], no_show: ['cancel', 'No-show'] };
export function fmtTime(iso) { if (!iso) return ['--', '']; const d = new Date(iso); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = ((h + 11) % 12) + 1; return [`${h}:${String(m).padStart(2, '0')}`, ap]; }
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
export const ageText = (months) => { if (months == null) return '—'; const y = Math.floor(months / 12), m = months % 12; return (y ? y + ' yr' : '') + (y && m ? ' ' : '') + (m ? m + ' mo' : (y ? '' : '0 mo')); };
export const todayISO = () => new Date().toISOString().slice(0, 10);

/* ---------- routing ---------- */
export const go = (path) => { location.hash = '#/' + path; };
export function useHashRoute() {
  const parse = () => { const h = (location.hash || '#/today').replace(/^#\//, ''); const [name, param] = h.split('/'); return { name: name || 'today', param }; };
  const [route, setRoute] = useState(parse());
  useEffect(() => { const f = () => setRoute(parse()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return route;
}

/* ---------- tiny event bus (create flows + cross-screen refresh) ---------- */
export const emit = (name, detail) => dispatchEvent(new CustomEvent(name, { detail }));
export function useEvent(name, fn, deps = []) {
  useEffect(() => { const h = (e) => fn(e.detail); addEventListener(name, h); return () => removeEventListener(name, h); }, deps);
}
/** Open a create/edit form from anywhere (Quick Add, headers, deep-links). */
export const openForm = (entity, props = {}) => emit('kiv-form', { entity, props });
/** Ask all mounted screens to reload their data after a successful write. */
export const refreshAll = () => emit('kiv-refresh', {});

/* ---------- toasts (global write-completion signal) ---------- */
let _toastCb = null, _tid = 0;
export function toast(message, kind = 'ok') { _toastCb && _toastCb({ id: ++_tid, message, kind }); }
export function Toasts() {
  const [items, setItems] = useState([]);
  // Success toasts auto-dismiss; ERROR toasts stay until dismissed (F11) so a user who glanced away
  // during a multi-second save can't miss a failure. All toasts are dismissible by their × button.
  useEffect(() => {
    _toastCb = (t) => { setItems(x => [...x, t]); if (t.kind !== 'err') setTimeout(() => setItems(x => x.filter(i => i.id !== t.id)), 4200); };
    return () => { _toastCb = null; };
  }, []);
  const dismiss = (id) => setItems(x => x.filter(i => i.id !== id));
  return html`<div class="toasts">${items.map(t => html`<div key=${t.id} class="toast ${t.kind}" role=${t.kind === 'err' ? 'alert' : 'status'} aria-live=${t.kind === 'err' ? 'assertive' : 'polite'}>${Icon(t.kind === 'err' ? 'warn' : 'check', 17)}<span>${t.message}</span><button class="toastx" aria-label="Dismiss" onClick=${() => dismiss(t.id)}>${Icon('x', 14)}</button></div>`)}</div>`;
}

/* ---------- progress / activity affordances ---------- */
/** Three animated dots — pair with a caption ("Almost there"). */
export const LoadingDots = () => html`<span class="ldots" aria-hidden="true"><i></i><i></i><i></i></span>`;

/** Cycles reassuring captions on a timer while a long call is in flight. */
export function CyclingText({ messages, interval = 2200 }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % messages.length), interval); return () => clearInterval(t); }, [messages.length, interval]);
  return html`<span class="cyct">${messages[i]}${LoadingDots()}</span>`;
}

/**
 * Faux progress bar for the highest-wait moments (login, first cold call). The fill is NOT a real
 * measurement — it eases toward ~92% and holds, which reads as "almost done" and keeps the wait calm.
 * When `done` flips true it snaps to 100%. Always pair with honest cycling text so we never imply a
 * real percentage; it's purely a calming affordance over an unknowable Apps Script wait.
 */
const COLD_MSG = 'The server is waking up after idle — this can take up to 30 seconds';
export function FauxProgress({ messages = ['Connecting to the clinic server', 'Waking things up', 'Almost there'], done = false }) {
  const [pct, setPct] = useState(8);
  const [el, setEl] = useState(0);
  useEffect(() => {
    if (done) { setPct(100); return; }
    const t0 = Date.now();
    const t = setInterval(() => { setPct(p => (p >= 92 ? 92 : p + Math.max(0.6, (92 - p) * 0.08))); setEl(Math.floor((Date.now() - t0) / 1000)); }, 360);
    return () => clearInterval(t);
  }, [done]);
  const cold = el >= 8; // after ~8s it's almost certainly a cold start — say so honestly (F3)
  return html`<div class="fauxprog" role="progressbar" aria-label="Loading">
    <div class="fauxbar"><i style=${`width:${done ? 100 : pct}%`}></i></div>
    <div class="fauxcap">${cold ? html`<span class="cyct">${COLD_MSG}${LoadingDots()}</span>` : html`<${CyclingText} messages=${messages}/>`}</div>
  </div>`;
}

/** Time-escalating wait caption for first-load skeletons: calm at first, honest about cold starts later (F3). */
export function WaitHint({ base = 'Loading' }) {
  const [el, setEl] = useState(0);
  useEffect(() => { const t0 = Date.now(); const t = setInterval(() => setEl(Math.floor((Date.now() - t0) / 1000)), 1000); return () => clearInterval(t); }, []);
  const msg = el >= 8 ? COLD_MSG : el >= 3 ? 'Still working' : base;
  return html`<span class="cyct">${msg}${LoadingDots()}</span>`;
}

/**
 * Top-right sync status dot. Teal = up to date (idle), amber (pulsing) = something syncing in the
 * background, red = last refresh failed so on-screen data may be stale. Driven by the global api()
 * activity signal, so it reflects SWR background revalidation automatically.
 */
export function SyncDot() {
  const [st, setSt] = useState(getActivity());
  useEffect(() => subscribeActivity(setSt), []);
  const state = st.inflight > 0 ? 'busy' : st.failed ? 'error' : 'idle';
  const label = state === 'busy' ? 'Syncing…' : state === 'error' ? 'Couldn’t refresh — showing saved data' : 'Up to date';
  return html`<span class="syncdot is-${state}" role="status" title=${label} aria-label=${label}><i></i></span>`;
}

/* ---------- state primitives ---------- */
export const Spinner = (size) => html`<span class="spin" role="status" aria-label="Loading" style=${size ? `width:${size}px;height:${size}px` : ''}></span>`;
export const Loading = (label = 'Loading…') => html`<div class="center">${Spinner()} ${label}</div>`;
export const SkeletonKpis = (n = 8) => html`<div class="kpis">${Array.from({ length: n }).map((_, i) => html`<div key=${i} class="skel skel-kpi"></div>`)}</div>`;
export const SkeletonRows = (n = 4) => html`<div>${Array.from({ length: n }).map((_, i) => html`<div key=${i} class="skel skel-row"></div>`)}</div>`;
export function ErrorState({ error, onRetry }) { return html`<div class="errbox">${Icon('warn', 20)}<span style="flex:1">${humanError(error)}</span>${onRetry && html`<button class="btn gho" onClick=${onRetry}>Retry</button>`}</div>`; }
export function EmptyState({ icon = 'paw', title, sub, action }) { return html`<div class="empty"><div style="display:flex;justify-content:center;margin-bottom:10px">${Icon(icon, 30)}</div><div style="font-weight:700;color:var(--soft);font-size:15px">${title}</div>${sub && html`<div class="alsub" style="margin-top:4px">${sub}</div>`}${action && html`<div style="margin-top:14px">${action}</div>`}</div>`; }

/**
 * Stale-while-revalidate fetch hook → { data, loading, error, stale, reload }.
 * On mount it paints the last-known payload INSTANTLY from cache (memory + localStorage), then
 * revalidates in the background. Skeletons (`loading`) only show on a genuine first-ever load.
 * `stale` is true while a background refresh of already-shown data is in flight (for a subtle hint).
 * A failed background revalidation keeps the cached data on screen rather than blanking it.
 */
const _apiCache = new Map();
const _apiTime = new Map();
const SWR_PREFIX = 'kiv_swr_';
function swrKey(action, payload) { return action + ':' + JSON.stringify(payload || {}); }
function swrRead(key) {
  if (_apiCache.has(key)) return _apiCache.get(key);
  try {
    const raw = localStorage.getItem(SWR_PREFIX + key);
    if (raw != null) {
      const p = JSON.parse(raw);
      const data = (p && typeof p === 'object' && 'd' in p) ? p.d : p; // back-compat with old flat shape
      _apiCache.set(key, data);
      if (p && p.t) _apiTime.set(key, p.t);
      return data;
    }
  } catch {}
  return undefined;
}
function swrWrite(key, data) {
  const t = Date.now();
  _apiCache.set(key, data); _apiTime.set(key, t);
  try { localStorage.setItem(SWR_PREFIX + key, JSON.stringify({ d: data, t })); } catch {}
}
const swrTimeOf = (key) => _apiTime.get(key) || null;

/** Drop a cached SWR entry so the next mount of that screen loads fresh (e.g. after writing data it shows). */
export function invalidateApi(action, payload) {
  const key = swrKey(action, payload);
  _apiCache.delete(key); _apiTime.delete(key);
  try { localStorage.removeItem(SWR_PREFIX + key); } catch {}
}

/** Debounce a rapidly-changing value (e.g. a search box) so it only settles after `delay` ms idle. */
export function useDebounce(value, delay = 280) {
  const [d, setD] = useState(value);
  useEffect(() => { const t = setTimeout(() => setD(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return d;
}

/**
 * Stale-while-revalidate fetch hook → { data, loading, error, stale, refreshError, fetchedAt, reload }.
 * - paints the last-known payload INSTANTLY from cache, then revalidates in the background (skeletons
 *   only on a genuine first-ever load);
 * - `fetchedAt` stamps when the shown data was fetched (drives "Updated X ago", F1);
 * - a failed BACKGROUND revalidation keeps the cached data but sets `refreshError` (no longer swallowed,
 *   F2) so screens / the global banner can say "couldn't refresh";
 * - an out-of-order guard (seq) ignores responses from superseded requests so a fast-typed search can't
 *   settle on a stale prefix (F5).
 */
export function useApi(action, payload, deps = []) {
  const key = swrKey(action, payload);
  const seq = useRef(0);
  const [s, setS] = useState(() => {
    const cached = swrRead(key);
    return cached !== undefined
      ? { data: cached, loading: false, error: null, stale: true, refreshError: null, fetchedAt: swrTimeOf(key) }
      : { data: null, loading: true, error: null, stale: false, refreshError: null, fetchedAt: null };
  });
  const load = () => {
    const my = ++seq.current;
    setS(v => v.data !== null ? { ...v, stale: true, refreshError: null } : { data: null, loading: true, error: null, stale: false, refreshError: null, fetchedAt: null });
    api(action, payload)
      .then(d => { if (my !== seq.current) return; swrWrite(key, d); setS({ data: d, loading: false, error: null, stale: false, refreshError: null, fetchedAt: swrTimeOf(key) }); })
      .catch(e => { if (my !== seq.current) return; setS(v => v.data !== null
        ? { ...v, stale: false, refreshError: e }                                  // keep good data, but flag it (F2)
        : { data: null, loading: false, error: e, stale: false, refreshError: null, fetchedAt: null }); });
  };
  useEffect(load, deps);
  return { ...s, reload: load };
}

const relTime = (t) => { const s = Math.floor((Date.now() - t) / 1000); if (s < 10) return 'just now'; if (s < 60) return s + 's ago'; const m = Math.floor(s / 60); if (m < 60) return m + ' min ago'; const h = Math.floor(m / 60); if (h < 24) return h + 'h ago'; return Math.floor(h / 24) + 'd ago'; };
/** Small "Updated X ago / Refreshing… / Couldn't refresh" label for data-heavy screens (F1/F2). */
export function FreshnessLabel({ at, stale, error }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  let cls = '', txt;
  if (error) { cls = 'err'; txt = 'Couldn’t refresh'; }
  else if (stale) { cls = 'busy'; txt = 'Refreshing…'; }
  else if (at) txt = 'Updated ' + relTime(at);
  else return null;
  return html`<span class="freshlbl ${cls}">${txt}</span>`;
}

/** App-wide banner shown when a background refresh failed (data on screen may be stale). Offers Retry. */
export function SyncBanner() {
  const [st, setSt] = useState(getActivity());
  useEffect(() => subscribeActivity(setSt), []);
  if (!st.failed || st.inflight > 0) return null;
  return html`<div class="syncbanner" role="alert">${Icon('warn', 15)}<span>Couldn’t refresh — showing saved data.</span><button class="lnk" onClick=${() => refreshAll()}>Retry</button></div>`;
}

/**
 * useMutation — the WRITE-FEEDBACK pattern. Returns { run, busy, fieldErrors }.
 * While the API call is in flight `busy` is true (drive a spinner/"Saving…"); on completion a success
 * toast fires and onSuccess runs; on VALIDATION/CONFLICT the offending fields come back as fieldErrors;
 * other errors raise an error toast. The user always sees when the write finished.
 */
export function useMutation(action, { successMsg = 'Saved', onSuccess } = {}) {
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState(null);
  const ridRef = useRef(null);
  async function run(payload, opts = {}) {
    setBusy(true); setFieldErrors(null);
    // F3: reuse ONE requestId across manual retries of the same submission so a lost-response retry
    // dedups server-side (no duplicate record / double stock deduction). Cleared only on success.
    if (!ridRef.current) ridRef.current = uuid();
    try {
      const data = await api(action, payload, { mutating: true, requestId: ridRef.current });
      ridRef.current = null;
      toast(opts.successMsg || successMsg, 'ok');
      onSuccess && onSuccess(data);
      return data;
    } catch (e) {
      if ((e.code === 'VALIDATION_ERROR' || e.code === 'CONFLICT' || e.code === 'FK_VIOLATION') && e.fields) {
        setFieldErrors(e.fields); // inline on the field(s)
      } else {
        toast(humanError(e), 'err');
      }
      throw e;
    } finally { setBusy(false); }
  }
  return { run, busy, fieldErrors, clearErrors: () => setFieldErrors(null) };
}

export async function copyText(text) { try { await navigator.clipboard.writeText(text); toast('Copied', 'ok'); } catch { toast('Copy failed', 'err'); } }

/** F10: open a private medical document by fetching it through the RBAC-gated serve proxy (never a
 *  public Drive link). Streams base64 → Blob → new tab. */
export async function openDocument(id) {
  toast('Opening document…', 'ok');
  try {
    const d = await api('documents.serve', { id });
    const bin = atob(d.base64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: d.mime_type || 'application/octet-stream' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast(humanError(e), 'err'); }
}

/* ---------- form controls ---------- */
export function Field({ label, error, children, hint }) {
  return html`<div class="field"><label class="lab">${label}</label>${children}${error && html`<div class="ferr">${error}</div>`}${hint && !error && html`<div class="alsub" style="margin-top:5px">${hint}</div>`}</div>`;
}
export function Input({ value, onInput, error, type = 'text', placeholder, autofocus }) {
  return html`<input class="inp ${error ? 'bad' : ''}" type=${type} placeholder=${placeholder || ''} autofocus=${autofocus} value=${value ?? ''} onInput=${e => onInput(e.target.value)} />`;
}
export function Textarea({ value, onInput, placeholder }) { return html`<textarea class="inp" placeholder=${placeholder || ''} value=${value ?? ''} onInput=${e => onInput(e.target.value)}></textarea>`; }
export function Select({ value, onInput, options, error, loading, disabled }) {
  const opts = loading ? [['', 'Loading…']] : options; // F7: never render an empty/usable menu mid-load
  return html`<select class="inp ${error ? 'bad' : ''}" disabled=${disabled || loading} value=${value ?? ''} onChange=${e => onInput(e.target.value)}>${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return html`<option value=${v}>${l}</option>`; })}</select>`;
}
export function Seg({ value, onInput, options }) {
  return html`<div class="seg">${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return html`<button type="button" class="segb ${value === v ? 'on' : ''}" onClick=${() => onInput(v)}>${l}</button>`; })}</div>`;
}

/* ---------- modal + confirm ---------- */
export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef();
  useEffect(() => {
    // Initial focus on the first field, and a basic focus trap so keyboard users stay in the dialog (F13).
    const root = ref.current;
    const focusables = () => Array.from(root.querySelectorAll('input,select,textarea,button,[href],[tabindex]:not([tabindex="-1"])')).filter(el => !el.disabled && el.offsetParent !== null);
    const first = focusables()[0]; if (first) setTimeout(() => first.focus(), 0);
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables(); if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, []);
  return html`<div class="modalscrim" onClick=${onClose}><div class="modal" ref=${ref} style=${wide ? 'max-width:760px' : ''} role="dialog" aria-modal="true" onClick=${e => e.stopPropagation()}>
    <div class="modalhead"><div class="sectttl">${title}</div><button class="iconbtn" aria-label="Close" onClick=${onClose}>${Icon('x', 18)}</button></div>
    <div class="modalbody">${children}</div>
    ${footer && html`<div class="modalfoot">${footer}</div>`}
  </div></div>`;
}
/** A submit button that visibly reflects the in-flight write. */
export function SaveButton({ busy, disabled, label = 'Save', icon = 'check', onClick, type = 'button' }) {
  return html`<button class="btn pri" type=${type} disabled=${busy || disabled} onClick=${onClick}>${busy ? html`${Spinner(16)} Saving…` : html`${Icon(icon, 17)}${label}`}</button>`;
}
export function ConfirmDialog({ title, body, danger, confirmLabel = 'Confirm', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  async function doIt() { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }
  return html`<${Modal} title=${title} onClose=${onClose}
    footer=${html`<button class="btn gho" onClick=${onClose}>Cancel</button><button class="btn ${danger ? 'pri' : 'pri'}" style=${danger ? 'background:var(--red)' : ''} disabled=${busy} onClick=${doIt}>${busy ? html`${Spinner(16)} Working…` : confirmLabel}</button>`}>
    ${danger ? html`<div class="dangerline">${Icon('warn', 18)}<span>${body}</span></div>` : html`<p class="mut">${body}</p>`}
  <//>`;
}
