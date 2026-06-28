// core.js — shared primitives for every screen: helpers, data hooks, the write-feedback mutation
// pattern, toasts, modal + form controls. Screen modules import ONLY from here (no circular deps).
import { html, render, useState, useEffect, useRef } from './vendor/preact-standalone.module.js';
import { api, humanError, ApiError, isAdmin, getSession } from './api.js';
import { Icon } from './icons.js';
export { html, useState, useEffect, useRef, render, api, humanError, ApiError, isAdmin, getSession, Icon };

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
  useEffect(() => { _toastCb = (t) => { setItems(x => [...x, t]); setTimeout(() => setItems(x => x.filter(i => i.id !== t.id)), 4200); }; return () => { _toastCb = null; }; }, []);
  return html`<div class="toasts" aria-live="polite">${items.map(t => html`<div key=${t.id} class="toast ${t.kind}">${Icon(t.kind === 'err' ? 'warn' : 'check', 17)}<span>${t.message}</span></div>`)}</div>`;
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
const SWR_PREFIX = 'kiv_swr_';
function swrKey(action, payload) { return action + ':' + JSON.stringify(payload || {}); }
function swrRead(key) {
  if (_apiCache.has(key)) return _apiCache.get(key);
  try { const raw = localStorage.getItem(SWR_PREFIX + key); if (raw != null) { const v = JSON.parse(raw); _apiCache.set(key, v); return v; } } catch {}
  return undefined;
}
function swrWrite(key, data) {
  _apiCache.set(key, data);
  try { localStorage.setItem(SWR_PREFIX + key, JSON.stringify(data)); } catch {}
}
export function useApi(action, payload, deps = []) {
  const key = swrKey(action, payload);
  const [s, setS] = useState(() => {
    const cached = swrRead(key);
    return cached !== undefined
      ? { data: cached, loading: false, error: null, stale: true }
      : { data: null, loading: true, error: null, stale: false };
  });
  const load = () => {
    setS(v => v.data !== null ? { ...v, stale: true, error: null } : { data: null, loading: true, error: null, stale: false });
    api(action, payload)
      .then(d => { swrWrite(key, d); setS({ data: d, loading: false, error: null, stale: false }); })
      .catch(e => setS(v => v.data !== null
        ? { ...v, stale: false, error: null }            // keep showing good data on a transient blip
        : { data: null, loading: false, error: e, stale: false }));
  };
  useEffect(load, deps);
  return { ...s, reload: load };
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
  async function run(payload, opts = {}) {
    setBusy(true); setFieldErrors(null);
    try {
      const data = await api(action, payload, { mutating: true });
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

/* ---------- form controls ---------- */
export function Field({ label, error, children, hint }) {
  return html`<div class="field"><label class="lab">${label}</label>${children}${error && html`<div class="ferr">${error}</div>`}${hint && !error && html`<div class="alsub" style="margin-top:5px">${hint}</div>`}</div>`;
}
export function Input({ value, onInput, error, type = 'text', placeholder, autofocus }) {
  return html`<input class="inp ${error ? 'bad' : ''}" type=${type} placeholder=${placeholder || ''} autofocus=${autofocus} value=${value ?? ''} onInput=${e => onInput(e.target.value)} />`;
}
export function Textarea({ value, onInput, placeholder }) { return html`<textarea class="inp" placeholder=${placeholder || ''} value=${value ?? ''} onInput=${e => onInput(e.target.value)}></textarea>`; }
export function Select({ value, onInput, options, error }) {
  return html`<select class="inp ${error ? 'bad' : ''}" value=${value ?? ''} onChange=${e => onInput(e.target.value)}>${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return html`<option value=${v}>${l}</option>`; })}</select>`;
}
export function Seg({ value, onInput, options }) {
  return html`<div class="seg">${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return html`<button type="button" class="segb ${value === v ? 'on' : ''}" onClick=${() => onInput(v)}>${l}</button>`; })}</div>`;
}

/* ---------- modal + confirm ---------- */
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  return html`<div class="modalscrim" onClick=${onClose}><div class="modal" style=${wide ? 'max-width:760px' : ''} role="dialog" aria-modal="true" onClick=${e => e.stopPropagation()}>
    <div class="modalhead"><div class="sectttl">${title}</div><button class="iconbtn" aria-label="Close" onClick=${onClose}>${Icon('x', 18)}</button></div>
    <div class="modalbody">${children}</div>
    ${footer && html`<div class="modalfoot">${footer}</div>`}
  </div></div>`;
}
/** A submit button that visibly reflects the in-flight write. */
export function SaveButton({ busy, label = 'Save', icon = 'check', onClick, type = 'button' }) {
  return html`<button class="btn pri" type=${type} disabled=${busy} onClick=${onClick}>${busy ? html`${Spinner(16)} Saving…` : html`${Icon(icon, 17)}${label}`}</button>`;
}
export function ConfirmDialog({ title, body, danger, confirmLabel = 'Confirm', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  async function doIt() { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }
  return html`<${Modal} title=${title} onClose=${onClose}
    footer=${html`<button class="btn gho" onClick=${onClose}>Cancel</button><button class="btn ${danger ? 'pri' : 'pri'}" style=${danger ? 'background:var(--red)' : ''} disabled=${busy} onClick=${doIt}>${busy ? html`${Spinner(16)} Working…` : confirmLabel}</button>`}>
    ${danger ? html`<div class="dangerline">${Icon('warn', 18)}<span>${body}</span></div>` : html`<p class="mut">${body}</p>`}
  <//>`;
}
