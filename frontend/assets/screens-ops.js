// screens-ops.js — Inventory (+suppliers), Reports, Settings/Users/Storage.
import {
  html, useState, useEffect, api, asList, isAdmin, go, Icon, toast, humanError, refreshAll, useEvent,
  useApi, useMutation, Modal, ConfirmDialog, EmptyState, ErrorState, Loading, SkeletonRows, SkeletonKpis, Spinner,
  FreshnessLabel, initials, colorFor, fmtDate, inr, openForm, Field, Input, SaveButton
} from './core.js';

function useLiveApi(action, payload, deps = []) { const r = useApi(action, payload, deps); useEvent('kiv-refresh', () => r.reload(), deps); return r; }

/* ============ Inventory ============ */
const INV_TABS = [['medicines', 'Medicines'], ['low', 'Low stock'], ['expiring', 'Expiry alerts'], ['suppliers', 'Suppliers']];
export function Inventory() {
  const [tab, setTab] = useState('medicines');
  const value = useLiveApi('medicines.inventoryValue', {}, []);
  return html`<section data-screen-label="Inventory">
    <div class="hdr"><div><div class="h-ey">Stock · ${value.data ? inr(value.data.inventory_value) : '—'} total value <${FreshnessLabel} at=${value.fetchedAt} stale=${value.stale} error=${value.refreshError}/></div><div class="h-ttl">Inventory</div></div>
      <button class="btn pri" onClick=${() => openForm(tab === 'suppliers' ? 'supplier' : 'medicine')}><span class="nico">${Icon('plus')}</span>${tab === 'suppliers' ? 'Add supplier' : 'Add medicine'}</button></div>
    <div class="subtabs">${INV_TABS.map(([id, l]) => html`<button class="subtab ${tab === id ? 'on' : ''}" onClick=${() => setTab(id)}>${l}</button>`)}</div>
    ${tab === 'suppliers' ? html`<${Suppliers}/>` : html`<${MedTable} mode=${tab}/>`}
  </section>`;
}

function MedTable({ mode }) {
  const action = mode === 'low' ? 'medicines.lowStock' : mode === 'expiring' ? 'medicines.expiring' : 'medicines.list';
  const meds = useLiveApi(action, { limit: 500 }, [mode]);
  const suppliers = useLiveApi('suppliers.list', {}, []);
  const supName = {}; asList(suppliers.data).forEach(s => supName[s.id] = s.name);
  const rows = asList(meds.data);
  const flagCls = (m) => m.expiry_flag === 'red' ? 'red' : m.stock_flag === 'yellow' ? 'amber' : '';
  return html`<div class="card pad">
    ${meds.loading ? SkeletonRows(5) : meds.error ? html`<${ErrorState} error=${meds.error} onRetry=${meds.reload}/>` :
      rows.length === 0 ? html`<${EmptyState} icon="box" title=${mode === 'low' ? 'No low-stock items' : mode === 'expiring' ? 'Nothing expiring soon' : 'No medicines yet'} sub=${mode === 'medicines' ? 'Add your first medicine batch.' : 'All good here.'}/>` :
      html`<div style="overflow:auto"><table class="tbl"><thead><tr><th>Medicine</th><th class="hidesm">Batch</th><th>Stock</th><th class="hidesm">Expiry</th><th class="hidesm">Supplier</th><th>Value</th></tr></thead><tbody>
        ${rows.map(m => html`<tr class="trow" style="cursor:pointer" onClick=${() => openForm('medicine', { initial: m })}>
          <td><div class="flagdot ${flagCls(m)}"><b>${m.name}</b></div></td>
          <td class="hidesm mut tnum">${m.batch_number || '—'}</td>
          <td class="tnum">${m.quantity}${m.unit ? ' ' + m.unit : ''}</td>
          <td class="hidesm">${m.expiry_date ? fmtDate(m.expiry_date) : '—'}</td>
          <td class="hidesm mut">${supName[m.supplier_id] || '—'}</td>
          <td class="tnum">${inr(m.line_value)}</td></tr>`)}
      </tbody></table></div>`}
  </div>`;
}

function Suppliers() {
  const s = useLiveApi('suppliers.list', {}, []);
  return s.loading ? SkeletonRows(3) : s.error ? html`<${ErrorState} error=${s.error} onRetry=${s.reload}/>` :
    asList(s.data).length === 0 ? html`<div class="card pad"><${EmptyState} icon="users" title="No suppliers" sub="Add a medicine supplier." action=${html`<button class="btn pri" onClick=${() => openForm('supplier')}>Add supplier</button>`}/></div>` :
    html`<div class="cardlist">${asList(s.data).map(sp => html`<button class="clientcard" onClick=${() => openForm('supplier', { initial: sp })}>
      <div style="font-weight:700;font-size:16px;margin-bottom:4px">${sp.name}</div>
      <div class="alsub" style="margin-bottom:10px">${sp.contact_person || '—'}</div>
      <div class="alsub" style="display:flex;align-items:center;gap:7px">${Icon('phone', 14)}${sp.mobile || '—'}</div></button>`)}</div>`;
}

/* ============ Reports ============ */
const REP = [
  ['total_patients', 'Patients seen', 'paw'], ['opd_cases', 'OPD cases', 'stetho'], ['surgery_cases', 'Surgeries', 'syringe'],
  ['grooming_cases', 'Grooming', 'paw'], ['vaccinations_administered', 'Vaccinations', 'syringe'], ['followup_appointments', 'Follow-ups', 'cal'],
  ['low_stock_medicines', 'Low stock', 'box'], ['expiring_medicines', 'Expiring', 'warn']
];
export function Reports() {
  const r = useLiveApi('reports.daily', {}, []);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const d = r.data || {};
  return html`<section data-screen-label="Reports">
    <div class="hdr"><div><div class="h-ey">${today}</div><div class="h-ttl">Daily report</div></div>
      <button class="btn gho" onClick=${() => window.print()}><span class="nico">${Icon('file')}</span>Export PDF</button></div>
    ${r.loading ? SkeletonKpis(8) : r.error ? html`<${ErrorState} error=${r.error} onRetry=${r.reload}/>` : html`
      <div class="kpis">${REP.map(([k, l, ic]) => html`<div class="kpi"><div class="kpitop"><span class="kdot" style="background:var(--tealtint);color:var(--teal)">${Icon(ic, 17)}</span></div><div class="kpinum">${d[k] ?? 0}</div><div class="kpilbl">${l}</div></div>`)}</div>
      <div class="card pad" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px"><div><div class="sectttl">Current inventory value</div><div class="alsub">Stock on hand × purchase price</div></div><div class="kpinum" style="color:var(--teal)">${inr(d.inventory_value)}</div></div>`}
  </section>`;
}

/* ============ Settings (admin) ============ */
export function Settings() {
  if (!isAdmin()) return html`<section><div class="card pad"><${EmptyState} icon="gear" title="Administrators only" sub="Settings and user management are restricted to administrators."/></div></section>`;
  return html`<section data-screen-label="Settings">
    <div class="hdr"><div><div class="h-ey">Administration</div><div class="h-ttl">Settings</div></div></div>
    <div class="dgrid"><${ClinicInfo}/><div class="stack"><${Users}/><${Storage}/></div></div>
  </section>`;
}

function ClinicInfo() {
  const info = useLiveApi('settings.get', {}, []);
  const [f, setF] = useState(null);
  useEffect(() => { if (info.data) setF({ clinic_name: info.data.clinic_name || '', phone: info.data.phone || '', email: info.data.email || '', address: info.data.address || '' }); }, [info.data]);
  const m = useMutation('settings.update', { successMsg: 'Clinic info saved', onSuccess: () => refreshAll() });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  if (info.loading || !f) return html`<div class="card pad">${SkeletonRows(4)}</div>`;
  return html`<div class="card pad"><div class="sectttl" style="margin-bottom:14px">Clinic information</div>
    <${Field} label="Clinic name"><${Input} value=${f.clinic_name} onInput=${set('clinic_name')}/><//>
    <div class="formgrid"><${Field} label="Phone"><${Input} value=${f.phone} onInput=${set('phone')}/><//><${Field} label="Email"><${Input} value=${f.email} onInput=${set('email')} type="email"/><//></div>
    <${Field} label="Address"><${Input} value=${f.address} onInput=${set('address')}/><//>
    <${SaveButton} busy=${m.busy} label="Save changes" onClick=${() => m.run(f).catch(() => {})}/>
  </div>`;
}

function Users() {
  const u = useLiveApi('users.list', {}, []);
  const [confirm, setConfirm] = useState(null);
  async function toggle(user) { try { await api('users.update', { id: user.id, status: user.status === 'active' ? 'disabled' : 'active' }, { mutating: true }); toast('User updated', 'ok'); refreshAll(); } catch (e) { toast(humanError(e), 'err'); } }
  return html`<div class="card pad"><div class="hdr" style="margin-bottom:10px"><div class="sectttl">Users</div><button class="lnk" onClick=${() => openForm('user')}>Add user →</button></div>
    ${u.loading ? SkeletonRows(2) : asList(u.data).map(user => html`<div class="qarow"><span class="avatar" style="background:${colorFor(user.id)}">${initials(user.display_name)}</span>
      <div style="flex:1"><div style="font-weight:700;font-size:14px">${user.display_name} ${user.status === 'disabled' ? html`<span class="alsub">· disabled</span>` : ''}</div><div class="alsub">${user.identifier}</div></div>
      <span class="tag ${user.role === 'administrator' ? 'surgery' : 'opd'}">${user.role}</span>
      <button class="lnk" style="margin-left:8px" onClick=${() => toggle(user)}>${user.status === 'active' ? 'Disable' : 'Enable'}</button></div>`)}
  </div>`;
}

function Storage() {
  const s = useLiveApi('storage.usage', {}, []);
  const d = s.data;
  return html`<div class="card pad"><div class="sectttl" style="margin-bottom:6px">Document storage</div>
    ${s.loading ? SkeletonRows(1) : s.error ? html`<${ErrorState} error=${s.error} onRetry=${s.reload}/>` : html`
      <div class="alsub" style="margin-bottom:10px">Google Drive · ${(d.used_bytes / 1024 / 1024).toFixed(1)} MB used${d.nearing_capacity ? ' · nearing capacity' : ''}</div>
      <div class="stockbar" style="height:9px"><i style="width:${Math.min(100, d.used_pct)}%;background:${d.nearing_capacity ? 'var(--red)' : 'var(--teal)'}"></i></div>
      <div class="alsub" style="margin-top:8px">${d.used_pct}% of 15 GB · warn at ${d.warn_pct}%</div>`}
  </div>`;
}
