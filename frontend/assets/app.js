// KIV Clinic — SPA entry. Preact + htm, hash routing. Faithful to KIV Clinic.dc.html.
import {
  html, render, useState, useEffect, useRef, api, isAdmin, getSession, humanError, ApiError, Icon,
  initials, colorFor, inr, asList, fmtTime, fmtDate, TYPE_CLS, TYPE_LABEL, BAR, APPT_STAT,
  go, useHashRoute, toast, Toasts, Spinner, Loading, SkeletonKpis, SkeletonRows, ErrorState, EmptyState,
  FauxProgress, SyncDot, SyncBanner, FreshnessLabel, WaitHint, useApi, useEvent, openForm
} from './core.js';
import { setSession, clearSession } from './api.js';
import { APP_NAME, API_BASE } from './config.js';

// Keep the Apps Script container warm (it cold-starts after a few minutes idle, ~20-30s). We ping on
// load AND every ~4 min while the tab is visible, plus immediately when the tab regains focus — so the
// first action after a lunch/between-patient lull doesn't pay a cold start (F4). Gated on visibility so
// background tabs don't ping needlessly.
const ping = () => { try { fetch(API_BASE + '?action=ping', { method: 'GET', mode: 'no-cors' }).catch(() => {}); } catch {} };
let _warmStarted = false;
function warmUp() {
  if (_warmStarted) return; _warmStarted = true;
  ping();
  setInterval(() => { if (document.visibilityState === 'visible') ping(); }, 4 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ping(); });
}
import { FormHost } from './forms.js';
import { Clients, Pets, PetTimeline } from './screens-people.js';
import { Consultation, ConsultationsList, Appointments, Vaccinations } from './screens-clinical.js';
import { Inventory, Reports, Settings } from './screens-ops.js';

/* ---------------- login ---------------- */
function Login({ onAuthed }) {
  const [idf, setIdf] = useState(''); const [pw, setPw] = useState(''); const [type, setType] = useState('email');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const [mustReset, setMustReset] = useState(false); const [np, setNp] = useState(''); const [np2, setNp2] = useState('');
  async function submit(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const d = await api('auth.login', { identifier: idf, identifier_type: type, password: pw });
      // F7: persist must_reset so a reload can't drop a temp-password session into the app.
      setSession(d.token, { role: d.role, display_name: d.display_name, must_reset: !!d.must_reset });
      if (d.must_reset) { setMustReset(true); setBusy(false); return; }
      onAuthed();
    } catch (e) { setErr(e); setBusy(false); }
  }
  async function changePw(e) {
    e.preventDefault(); setErr(null);
    if (np.length < 8) return setErr(new ApiError('VALIDATION_ERROR', 'New password must be at least 8 characters.'));
    if (np !== np2) return setErr(new ApiError('VALIDATION_ERROR', 'Passwords do not match.'));
    setBusy(true);
    try {
      // Backend re-issues a fresh token at the new epoch (old sessions are revoked). Adopt it so this
      // session stays valid and is no longer flagged must_reset.
      const d = await api('auth.changePassword', { old: pw, new: np }, { mutating: true });
      if (d && d.token) setSession(d.token, { role: d.role, display_name: d.display_name, must_reset: false });
      toast('Password updated', 'ok'); onAuthed();
    } catch (e) { setErr(e); setBusy(false); }
  }
  return html`<div class="authwrap"><div class="authcard">
    <div class="authbrand"><div class="logo">KV</div><div><div class="bname">${APP_NAME}</div><div class="btag">Clinic OS</div></div></div>
    ${err && html`<div class="autherr">${humanError(err)}</div>`}
    ${!mustReset ? html`<form onSubmit=${submit}>
      <div class="field"><label class="lab">Email or mobile</label><input class="inp" autocomplete="username" value=${idf} onInput=${e => { const v = e.target.value; setIdf(v); setType(/@/.test(v) ? 'email' : 'mobile'); }} placeholder="you@clinic.com"/></div>
      <div class="field"><label class="lab">Password</label><input class="inp" type="password" autocomplete="current-password" value=${pw} onInput=${e => setPw(e.target.value)} placeholder="••••••••"/></div>
      <button class="btn pri" style="width:100%;margin-top:6px" disabled=${busy}>${busy ? html`${Spinner(16)} Signing in…` : 'Sign in'}</button>
      ${busy && html`<${FauxProgress} messages=${['Connecting to the clinic server', 'Waking the server up', 'Signing you in', 'Almost there']}/>`}
    </form>` : html`<form onSubmit=${changePw}>
      <p class="mut" style="font-size:14px;margin:0 0 14px">Set a new password to continue.</p>
      <div class="field"><label class="lab">New password</label><input class="inp" type="password" autocomplete="new-password" value=${np} onInput=${e => setNp(e.target.value)}/></div>
      <div class="field"><label class="lab">Confirm new password</label><input class="inp" type="password" autocomplete="new-password" value=${np2} onInput=${e => setNp2(e.target.value)}/></div>
      <button class="btn pri" style="width:100%" disabled=${busy}>${busy ? html`${Spinner(16)} Saving…` : 'Update & continue'}</button>
    </form>`}
    ${!mustReset && html`<div class="authfoot">First time setting up the clinic? <a href="https://github.com/kivclinic-web/kiv-clinic#first-run-setup" target="_blank" rel="noopener">Read the setup guide</a> to create the administrator account.</div>`}
  </div></div>`;
}

/* ---------------- navigation model ---------------- */
const NAV_MAIN = [['today', 'Today', 'home'], ['clients', 'Clients', 'users'], ['pets', 'Pets', 'paw'], ['appointments', 'Appointments', 'cal']];
const NAV_OPS = [['consultations', 'Consultations', 'stetho'], ['vaccinations', 'Vaccinations', 'syringe'], ['inventory', 'Inventory', 'box'], ['reports', 'Reports', 'chart'], ['settings', 'Settings', 'gear']];
const MNAV = [['today', 'Today', 'home'], ['clients', 'Clients', 'users'], ['appointments', 'Visits', 'cal'], ['inventory', 'Stock', 'box']];

/* ---------------- Quick Add ---------------- */
const QA_TILES = [
  ['New consultation', 'Record a visit', 'stetho', 'var(--tealtint)', { view: 'consult' }],
  ['Book appointment', 'OPD · Surgery · Groom', 'cal', 'var(--ambtint)', { form: 'appointment' }],
  ['Add client', 'New pet owner', 'users', 'var(--vtint)', { form: 'client' }],
  ['Record vaccination', 'Auto due date', 'syringe', '#E2EEF6', { form: 'vaccination' }],
  ['Add to inventory', 'New medicine batch', 'box', 'var(--tealtint)', { form: 'medicine' }],
  ['Add pet', 'New patient', 'paw', 'var(--redtint)', { form: 'pet' }]
];
function QuickAdd({ close }) {
  const [q, setQ] = useState(''); const [res, setRes] = useState([]); const [state, setState] = useState('idle'); const t = useRef();
  const act = (a) => { if (a.form) openForm(a.form); else if (a.view) go(a.view); close(); };
  useEffect(() => { const onKey = (e) => e.key === 'Escape' && close(); addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey); }, []); // F8: ESC really closes
  useEffect(() => {
    clearTimeout(t.current);
    if (!q.trim()) { setRes([]); setState('idle'); return; }
    setState('searching');
    t.current = setTimeout(async () => {
      try {
        const [clients, pets, meds] = await Promise.all([
          api('clients.list', { search: q, limit: 4 }),
          api('pets.list', { search: q, limit: 4 }),
          api('medicines.list', { search: q, limit: 3 })]);
        const cl = asList(clients).map(c => ({ initial: initials(c.name), color: colorFor(c.id), title: c.name, sub: c.mobile, tag: 'Client', tagcls: 'opd', go: () => { go('clients'); close(); } }));
        const pl = asList(pets).map(p => ({ initial: initials(p.name), color: colorFor(p.id), title: p.name, sub: `${p.breed} · ${p.owner || ''}`, tag: 'Pet', tagcls: 'groom', go: () => { go('pet/' + p.id); close(); } }));
        const md = asList(meds).map(m => ({ initial: 'Rx', color: colorFor(m.id), title: m.name, sub: (m.quantity ?? '') + ' in stock', tag: 'Medicine', tagcls: 'vacc', go: () => { go('inventory'); close(); } }));
        setRes([...pl, ...cl, ...md]); setState('done');
      } catch { setRes([]); setState('error'); } // F8: don't disguise a failed search as "no matches"
    }, 260);
    return () => clearTimeout(t.current);
  }, [q]);
  return html`<div class="scrim" onClick=${close}><div class="qa" onClick=${e => e.stopPropagation()}>
    <div class="qasearch">${Icon('search', 19)}<input autofocus placeholder="Search clients, pets, medicines — or pick an action" value=${q} onInput=${e => setQ(e.target.value)}/><button class="kbd" onClick=${close}>ESC</button></div>
    <div class="qasec">Quick actions</div>
    <div class="qatiles">${QA_TILES.map(([label, hint, ic, tint, a]) => html`<button class="qatile" aria-label=${label} onClick=${() => act(a)}><span class="kdot" style="background:${tint}">${Icon(ic, 18)}</span><b>${label}</b><span>${hint}</span></button>`)}</div>
    ${q.trim() && html`<div class="qasec">Jump to</div>${
      state === 'searching' ? html`<div class="center" style="padding:18px">${Spinner(16)} Searching…</div>` :
      state === 'error' ? html`<div class="alsub" style="padding:14px;color:var(--red)">Couldn’t search just now — check your connection and try again.</div>` :
      res.length === 0 ? html`<div class="alsub" style="padding:14px">No matches for “${q}”.</div>` :
      html`<div class="qares">${res.map(r => html`<button class="qarow" style="width:100%;text-align:left" onClick=${r.go}><span class="peta" style="background:${r.color}">${r.initial}</span><div style="flex:1;text-align:left"><div style="font-weight:700;font-size:14px">${r.title}</div><div class="alsub">${r.sub}</div></div><span class="tag ${r.tagcls}">${r.tag}</span></button>`)}</div>`}`}
    <div class="qafoot"><span>Type to search</span><span>Tap a tile to start</span><span>esc to close</span></div>
  </div></div>`;
}

/* ---------------- shell ---------------- */
/* Reminders bell with a live count badge and a dropdown panel (B10). */
function RemindersBell() {
  const [open, setOpen] = useState(false);
  const r = useApi('reminders.all', {});
  useEvent('kiv-refresh', () => r.reload(), []);
  const d = r.data || {};
  const groups = [
    ['Appointments today', d.appointments_today, 'cal', (x) => `${x.pet_name || 'Pet'} · ${TYPE_LABEL(x.type)}`],
    ['Overdue vaccinations', d.vaccinations_overdue, 'syringe', (x) => `${x.pet_name} · ${x.vaccine_name}`],
    ['Vaccinations due', d.vaccinations_due, 'syringe', (x) => `${x.pet_name} · ${x.vaccine_name}`],
    ['Dewormings due', d.dewormings_due, 'drop', (x) => x.pet_name]
  ].filter(g => (g[1] || []).length);
  const count = groups.reduce((s, g) => s + g[1].length, 0);
  return html`<div style="position:relative">
    <button class="ibtn" aria-label=${`Reminders${count ? ' (' + count + ')' : ''}`} title="Reminders" onClick=${() => setOpen(o => !o)}>${Icon('bell')}${count > 0 ? html`<span class="bellbadge">${count > 9 ? '9+' : count}</span>` : ''}</button>
    ${open && html`<div class="bellscrim" onClick=${() => setOpen(false)}></div>
      <div class="rempanel" onClick=${e => e.stopPropagation()}>
        <div class="remhead">Reminders ${count ? `· ${count}` : ''}</div>
        ${r.loading && !r.data ? html`<div class="alsub" style="padding:14px">Loading…</div>` :
          count === 0 ? html`<div class="alsub" style="padding:16px">Nothing needs attention right now. 🎉</div>` :
          groups.map(g => html`<div class="remgroup"><div class="remglabel">${Icon(g[2], 13)} ${g[0]} · ${g[1].length}</div>
            ${g[1].slice(0, 6).map(x => html`<button class="remitem" onClick=${() => { setOpen(false); go(x.pet_id ? 'pet/' + x.pet_id : 'appointments'); }}>${g[3](x)}</button>`)}</div>`)}
      </div>`}
  </div>`;
}

function Shell({ route, children, onQuick }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const session = getSession() || {};
  const admin = isAdmin();
  const opsNav = NAV_OPS.filter(([id]) => admin || id !== 'settings');
  const allNav = NAV_MAIN.concat(opsNav);
  const active = route.name === 'pet' ? 'pets' : route.name;
  const navBtn = (id, label, ic) => html`<button class="navlink ${active === id ? 'on' : ''}" onClick=${() => { go(id); setMenuOpen(false); }}><span class="nico">${Icon(ic)}</span>${label}</button>`;
  return html`<div class="app">
    <aside class="sidebar">
      <div class="brand"><div class="logo">KV</div><div><div class="bname">${APP_NAME}</div><div class="btag">Clinic OS</div></div></div>
      <div class="navsec">Clinic</div>${NAV_MAIN.map(([id, l, ic]) => navBtn(id, l, ic))}
      <div class="navsec">Operations</div>${opsNav.map(([id, l, ic]) => navBtn(id, l, ic))}
      <div class="sidefoot"><button class="userchip" onClick=${logout}><div class="avatar" style="background:${colorFor(session.display_name || 'x')}">${initials(session.display_name || 'U')}</div><div style="text-align:left;line-height:1.2"><div style="font-weight:700;font-size:14px">${session.display_name || 'User'}</div><div class="btag" style="text-transform:capitalize;letter-spacing:0">${session.role || ''}</div></div><span class="nico" style="margin-left:auto">${Icon('logout')}</span></button></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="search" onClick=${onQuick}><span class="nico">${Icon('search')}</span><span>Search clients, pets, medicines…</span><span class="kbd">⌘K</span></button>
        <button class="qbtn" onClick=${onQuick}><span class="nico">${Icon('plus')}</span><span>Quick add</span></button>
        <${SyncDot}/>
        <${RemindersBell}/>
      </header>
      <div class="view"><${SyncBanner}/>${children}</div>
    </div>
    <nav class="mobilenav">
      ${MNAV.map(([id, l, ic]) => html`<button class="mnav ${active === id ? 'on' : ''}" onClick=${() => go(id)}><span class="nico">${Icon(ic)}</span>${l}</button>`)}
      <button class="mnav ${menuOpen ? 'on' : ''}" onClick=${() => setMenuOpen(true)}><span class="nico">${Icon('menu')}</span>More</button>
    </nav>
    <button class="mfab" onClick=${onQuick} aria-label="Quick add">${Icon('plus', 22)}</button>
    ${menuOpen && html`<div class="scrim sheetscrim" onClick=${() => setMenuOpen(false)}><div class="sheet" onClick=${e => e.stopPropagation()}>
      <div class="sheethead"><div class="sectttl">All sections</div><button class="pill" onClick=${() => setMenuOpen(false)}>Close</button></div>
      <div class="menugrid">${allNav.map(([id, l, ic]) => html`<button class="menutile ${active === id ? 'on' : ''}" onClick=${() => { go(id); setMenuOpen(false); }}><span class="nico">${Icon(ic, 23)}</span>${l}</button>`)}</div>
    </div></div>`}
  </div>`;
}
function logout() { clearSession(); location.hash = '#/today'; location.reload(); }

/* ---------------- Today dashboard ---------------- */
const KPI_DEFS = [
  ['todays_appointments', "Today's appointments", 'cal', 'var(--tealtint)', 'var(--teal)', 'appointments'],
  ['completed_appointments', 'Completed', 'check', 'var(--tealtint)', 'var(--teal2)', 'appointments'],
  ['pending_appointments', 'Pending', 'clock', 'var(--ambtint)', 'var(--amber)', 'appointments'],
  ['followups_today', 'Follow-ups today', 'stetho', 'var(--ambtint)', 'var(--amber)', 'appointments'],
  ['vaccinations_due', 'Vaccinations due', 'syringe', '#E2EEF6', '#3A6E96', 'vaccinations'],
  ['overdue_vaccinations', 'Overdue vaccinations', 'warn', 'var(--redtint)', 'var(--red)', 'vaccinations'],
  ['low_stock_medicines', 'Low stock', 'box', 'var(--ambtint)', 'var(--amber)', 'inventory'],
  ['expiring_medicines', 'Expiring soon', 'warn', 'var(--redtint)', 'var(--red)', 'inventory']
];
function Dashboard() {
  // One request for the whole Today screen (kpis + widgets + reminders), painted instantly from
  // SWR cache on every revisit. Compatibility shims keep the existing markup below unchanged.
  const s = useApi('dashboard.summary', {});
  useEvent('kiv-refresh', () => s.reload(), []);
  const k = { loading: s.loading, error: s.error, reload: s.reload, data: s.data && s.data.kpis };
  const w = { loading: s.loading, error: s.error, reload: s.reload, data: s.data && s.data.widgets };
  const reminders = s.data && s.data.reminders;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();
  const kpis = k.data || {};
  return html`<section data-screen-label="Today">
    <div class="hero"><div><div class="h-ey">${today} <${FreshnessLabel} at=${s.fetchedAt} stale=${s.stale} error=${s.refreshError}/></div><div class="herobig">${greeting}</div>
      <div class="herosub">${k.loading ? html`<${WaitHint} base="Loading your day"/>` : k.error ? 'Could not load your summary.' :
        html`You have <b>${kpis.todays_appointments || 0} appointment${kpis.todays_appointments === 1 ? '' : 's'}</b> today — <b>${kpis.followups_today || 0} follow-up${kpis.followups_today === 1 ? '' : 's'}</b> and <b>${kpis.vaccinations_due || 0} vaccination${kpis.vaccinations_due === 1 ? '' : 's'} due</b>.${kpis.completed_appointments ? ` ${kpis.completed_appointments} already wrapped up.` : ''}`}</div></div>
      <button class="btn pri" onClick=${() => dispatchEvent(new CustomEvent('kiv-quick'))}><span class="nico">${Icon('plus')}</span>Quick add</button></div>
    ${!k.loading && s.data && !kpis.current_inventory_value && !(kpis.todays_appointments || kpis.vaccinations_due || kpis.low_stock_medicines || kpis.expiring_medicines) && html`
      <div class="card pad" style="margin-bottom:18px"><div class="sectttl" style="margin-bottom:4px">Get started</div>
        <div class="alsub" style="margin-bottom:12px">Set up your clinic in a few steps.</div>
        <div class="qalist">
          <button class="qarow" onClick=${() => openForm('client')}><span class="peta" style="background:var(--teal)">1</span><div style="flex:1;text-align:left"><div style="font-weight:700;font-size:14px">Add your first client & pet</div><div class="alsub">Register an owner — you'll be prompted to add their pet next</div></div>${Icon('chevron')}</button>
          <button class="qarow" onClick=${() => openForm('medicine')}><span class="peta" style="background:var(--amber)">2</span><div style="flex:1;text-align:left"><div style="font-weight:700;font-size:14px">Stock a medicine</div><div class="alsub">Add an inventory batch with expiry & price</div></div>${Icon('chevron')}</button>
          ${isAdmin() && html`<button class="qarow" onClick=${() => go('settings')}><span class="peta" style="background:var(--violet)">3</span><div style="flex:1;text-align:left"><div style="font-weight:700;font-size:14px">Set clinic info & add staff</div><div class="alsub">Clinic name, contact, and manager accounts</div></div>${Icon('chevron')}</button>`}
        </div></div>`}
    ${k.loading ? SkeletonKpis(9) : k.error ? html`<${ErrorState} error=${k.error} onRetry=${k.reload}/>` : html`
      <div class="kpis">${KPI_DEFS.map(([key, label, ic, tint, color, view]) => html`<button class="kpi" onClick=${() => go(view)}><div class="kpitop"><span class="kdot" style="background:${tint};color:${color}">${Icon(ic, 17)}</span></div><div class="kpinum" style="color:${color}">${kpis[key] ?? 0}</div><div class="kpilbl">${label}</div></button>`)}
        <button class="kpi" onClick=${() => go('reports')}><div class="kpitop"><span class="kdot" style="background:var(--tealtint);color:var(--teal)">${Icon('chart', 17)}</span></div><div class="kpinum" style="color:var(--teal)">${inr(kpis.current_inventory_value)}</div><div class="kpilbl">Inventory value</div></button></div>`}
    <div class="dgrid">
      <div class="card pad">
        <div class="hdr" style="margin-bottom:8px"><div class="sectttl">Today's schedule</div><button class="lnk" onClick=${() => go('appointments')}>Open calendar →</button></div>
        ${w.loading ? SkeletonRows(3) : w.error ? html`<${ErrorState} error=${w.error} onRetry=${w.reload}/>` :
          (w.data.todays_appointments || []).length === 0 ? html`<${EmptyState} icon="cal" title="No appointments today" sub="Book one from Quick add."/>` :
          html`<div class="tl">${w.data.todays_appointments.map(a => { const [time, ap] = fmtTime(a.scheduled_at); const [sc, sl] = APPT_STAT[a.status] || ['wait', a.status];
            return html`<div class="tlrow"><div class="tltime">${time}<small>${ap}</small></div><div class="tlbar" style="background:${BAR[a.type] || 'var(--line)'}"></div>
              <div class="tlbody"><div class="tlpet"><span class="peta" style="background:${colorFor(a.pet_id)}">${initials(a.pet_name || 'P')}</span>${a.pet_name || 'Pet'}<span class="tag ${TYPE_CLS[a.type] || 'opd'}">${TYPE_LABEL(a.type)}</span></div><div class="tlmeta">${a.reason || '—'}${a.client_name ? ' · ' + a.client_name : ''}</div></div>
              <div class="row-actions"><span class="stat ${sc}">${sl}</span></div></div>`; })}</div>`}
      </div>
      <div class="stack">
        <div class="card pad"><div class="sectttl" style="margin-bottom:14px">Needs attention</div><${AttentionList} widgets=${w} reminders=${reminders}/></div>
        <div class="card pad"><div class="hdr" style="margin-bottom:10px"><div class="sectttl">Vaccinations due</div><button class="lnk" onClick=${() => go('vaccinations')}>All →</button></div>
          ${w.loading ? Loading('') : (w.data?.vaccination_due || []).length === 0 ? html`<${EmptyState} icon="syringe" title="Nothing due" sub="All up to date."/>` :
            w.data.vaccination_due.slice(0, 4).map(d => html`<button class="qarow" style="width:100%;text-align:left" onClick=${() => go('pet/' + d.pet_id)}><span class="peta" style="background:${colorFor(d.pet_id)}">${initials(d.pet_name || 'P')}</span><div style="flex:1"><div style="font-weight:700;font-size:14px">${d.pet_name} · ${d.vaccine_name}</div><div class="alsub">${d.overdue ? 'Overdue' : 'Due ' + fmtDate(d.due_date)}</div></div><span class="stat ${d.overdue ? 'cancel' : 'prog'}">${d.overdue ? 'Overdue' : 'Due'}</span></button>`)}
        </div>
      </div>
    </div>
  </section>`;
}
function AttentionList({ widgets: w, reminders }) {
  if (w.loading) return Loading('');
  const items = [];
  const low = (w.data?.inventory_alerts || []), exp = (w.data?.expiry_alerts || []);
  const ov = (reminders?.vaccinations_overdue || []), dw = (reminders?.dewormings_due || []);
  if (ov.length) items.push({ cls: 'red', icon: 'syringe', ttl: `${ov.length} overdue vaccination${ov.length > 1 ? 's' : ''}`, sub: ov.slice(0, 2).map(v => v.pet_name).join(', '), go: () => go('vaccinations') });
  if (exp.length) items.push({ cls: 'red', icon: 'warn', ttl: `${exp.length} medicine${exp.length > 1 ? 's' : ''} expiring`, sub: exp.slice(0, 2).map(m => m.name).join(', '), go: () => go('inventory') });
  if (low.length) items.push({ cls: 'amber', icon: 'box', ttl: `${low.length} low-stock medicine${low.length > 1 ? 's' : ''}`, sub: low.slice(0, 2).map(m => m.name).join(', '), go: () => go('inventory') });
  if (dw.length) items.push({ cls: 'amber', icon: 'drop', ttl: `${dw.length} deworming${dw.length > 1 ? 's' : ''} due`, sub: dw.slice(0, 2).map(d => d.pet_name).join(', '), go: () => go('vaccinations') });
  if (!items.length) return html`<${EmptyState} icon="check" title="All clear" sub="No risks need attention right now."/>`;
  return html`${items.map(al => html`<button class="alert ${al.cls}" style="width:100%;text-align:left" onClick=${al.go}><span class="alico">${Icon(al.icon, 18)}</span><span class="altxt"><span class="alttl">${al.ttl}</span><span class="alsub">${al.sub}</span></span><span class="nico fnt">${Icon('chevron')}</span></button>`)}`;
}

/* ---------------- root ---------------- */
function App() {
  // A session still flagged must_reset isn't fully authed — force it back through login → reset (F7).
  const _sess = getSession();
  const [authed, setAuthed] = useState(!!_sess && !_sess.must_reset);
  const [quick, setQuick] = useState(false);
  const route = useHashRoute();
  useEvent('kiv-quick', () => setQuick(true), []);
  // F8: the ⌘K / Ctrl-K badge now actually opens Quick Add.
  useEffect(() => { const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setQuick(true); } }; addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey); }, []);
  if (!authed) return html`<${Toasts}/><${Login} onAuthed=${() => setAuthed(true)}/>`;
  let screen;
  switch (route.name) {
    case 'today': screen = html`<${Dashboard}/>`; break;
    case 'clients': screen = html`<${Clients}/>`; break;
    case 'pets': screen = html`<${Pets}/>`; break;
    case 'pet': screen = html`<${PetTimeline} id=${route.param}/>`; break;
    case 'appointments': screen = html`<${Appointments}/>`; break;
    case 'consultations': screen = html`<${ConsultationsList}/>`; break;
    case 'consult': screen = html`<${Consultation} petId=${route.param}/>`; break;
    case 'vaccinations': screen = html`<${Vaccinations}/>`; break;
    case 'inventory': screen = html`<${Inventory}/>`; break;
    case 'reports': screen = html`<${Reports}/>`; break;
    case 'settings': screen = html`<${Settings}/>`; break;
    default: screen = html`<${Dashboard}/>`;
  }
  return html`<${Toasts}/><${FormHost}/>
    <${Shell} route=${route} onQuick=${() => setQuick(true)}>${screen}<//>
    ${quick && html`<${QuickAdd} close=${() => setQuick(false)}/>`}`;
}

warmUp();
render(html`<${App}/>`, document.getElementById('root'));
