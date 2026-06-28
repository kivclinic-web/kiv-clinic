// screens-people.js — Clients, Pets, and the Pet medical timeline (signature interaction #3).
import {
  html, useState, useEffect, api, asList, isAdmin, go, Icon, toast, humanError, refreshAll, useEvent,
  useApi, useDebounce, useMutation, Modal, ConfirmDialog, EmptyState, ErrorState, Loading, SkeletonRows, FreshnessLabel,
  initials, colorFor, fmtDate, inr, ageText, openForm, openDocument
} from './core.js';

/* a hook that reloads when any write fires a refresh */
function useLiveApi(action, payload, deps = []) {
  const r = useApi(action, payload, deps);
  useEvent('kiv-refresh', () => r.reload(), deps);
  return r;
}

/* ============ Clients ============ */
export function Clients() {
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const clients = useLiveApi('clients.list', { search: dq, limit: 200 }, [dq]);
  const pets = useLiveApi('pets.list', { limit: 500 }, []);
  const [detail, setDetail] = useState(null);
  const byClient = {};
  asList(pets.data).forEach(p => { (byClient[p.client_id] = byClient[p.client_id] || []).push(p); });

  return html`<section data-screen-label="Clients">
    <div class="hdr"><div><div class="h-ey">Pet owners <${FreshnessLabel} at=${clients.fetchedAt} stale=${clients.stale} error=${clients.refreshError}/></div><div class="h-ttl">Clients</div></div>
      <button class="btn pri" onClick=${() => openForm('client')}><span class="nico">${Icon('plus')}</span>Add client</button></div>
    <div class="field" style="max-width:420px"><div class="search" style="max-width:none"><span class="nico">${Icon('search')}</span><input style="border:none;outline:none;background:none;flex:1;color:var(--ink)" placeholder="Search by name or mobile" value=${q} onInput=${e => setQ(e.target.value)}/></div></div>
    ${clients.loading ? SkeletonRows(4) : clients.error ? html`<${ErrorState} error=${clients.error} onRetry=${clients.reload}/>` :
      asList(clients.data).length === 0 ? html`<div class="card pad"><${EmptyState} icon="users" title=${q ? 'No matches' : 'No clients yet'} sub=${q ? 'Try a different name or number.' : 'Add your first pet owner.'} action=${html`<button class="btn pri" onClick=${() => openForm('client')}>Add client</button>`}/></div>` :
      html`<div class="cardlist">${asList(clients.data).map(c => { const ps = byClient[c.id] || []; return html`
        <button class="clientcard" onClick=${() => setDetail({ client: c, pets: ps })}>
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:13px"><span class="avatar" style="background:${colorFor(c.id)}">${initials(c.name)}</span>
            <div style="text-align:left"><div style="font-weight:700;font-size:16px">${c.name}</div><div class="alsub">${ps.length} ${ps.length === 1 ? 'pet' : 'pets'}</div></div></div>
          <div class="alsub" style="display:flex;align-items:center;gap:7px;margin-bottom:4px">${Icon('phone', 14)}${c.mobile}</div>
          <div class="alsub" style="margin-bottom:12px">${c.address || '—'}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${ps.map(p => html`<span class="petchip"><span class="minpet" style="background:${colorFor(p.id)}">${initials(p.name)}</span>${p.name}</span>`)}</div>
        </button>`; })}</div>`}
    ${detail && html`<${ClientDetail} client=${detail.client} pets=${detail.pets} close=${() => setDetail(null)}/>`}
  </section>`;
}

function ClientDetail({ client, pets, close }) {
  const [confirm, setConfirm] = useState(false);
  const del = useMutation('clients.delete', { successMsg: 'Client deleted', onSuccess: () => { refreshAll(); close(); } });
  return html`<${Modal} title=${client.name} onClose=${close}
    footer=${html`
      ${isAdmin() && html`<button class="btn gho" style="margin-right:auto;color:var(--red);border-color:var(--redtint)" onClick=${() => setConfirm(true)}>${Icon('trash', 16)} Delete</button>`}
      <button class="btn gho" onClick=${() => openForm('pet', { client_id: client.id })}>${Icon('plus', 16)} Add pet</button>
      <button class="btn pri" onClick=${() => openForm('client', { initial: client })}>${Icon('check', 16)} Edit</button>`}>
    <div class="vrow"><span>Mobile</span><b>${client.mobile}</b></div>
    <div class="vrow"><span>Address</span><b>${client.address || '—'}</b></div>
    ${client.email && html`<div class="vrow"><span>Email</span><b>${client.email}</b></div>`}
    <div class="sectttl" style="margin:16px 0 10px;font-size:15px">Pets</div>
    ${pets.length === 0 ? html`<${EmptyState} icon="paw" title="No pets linked" sub="Add this owner's first pet."/>` :
      pets.map(p => html`<button class="qarow" style="width:100%;text-align:left" onClick=${() => { go('pet/' + p.id); close(); }}><span class="peta" style="background:${colorFor(p.id)}">${initials(p.name)}</span><div style="flex:1"><div style="font-weight:700;font-size:14px">${p.name}</div><div class="alsub">${p.breed} · ${p.species}</div></div>${Icon('chevron')}</button>`)}
    ${confirm && html`<${ConfirmDialog} title="Delete client?" danger=${true} confirmLabel=${pets.length ? `Delete owner + ${pets.length} pet(s)` : 'Delete'} body=${pets.length ? `Delete ${client.name} and their ${pets.length} pet(s), including all consultations, vaccinations, appointments and documents? This can't be undone. (To keep a pet, reassign it to another owner first via the pet's record.)` : `Delete ${client.name}? This can't be undone.`} onConfirm=${() => del.run({ id: client.id, cascade: true })} onClose=${() => setConfirm(false)}/>`}
  <//>`;
}

/* ============ Pets ============ */
export function Pets() {
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const pets = useLiveApi('pets.list', { search: dq, limit: 300 }, [dq]);
  return html`<section data-screen-label="Pets">
    <div class="hdr"><div><div class="h-ey">Patients <${FreshnessLabel} at=${pets.fetchedAt} stale=${pets.stale} error=${pets.refreshError}/></div><div class="h-ttl">Pets</div></div>
      <button class="btn pri" onClick=${() => openForm('pet')}><span class="nico">${Icon('plus')}</span>Add pet</button></div>
    <div class="field" style="max-width:420px"><div class="search" style="max-width:none"><span class="nico">${Icon('search')}</span><input style="border:none;outline:none;background:none;flex:1;color:var(--ink)" placeholder="Search by name, breed or owner" value=${q} onInput=${e => setQ(e.target.value)}/></div></div>
    ${pets.loading ? SkeletonRows(4) : pets.error ? html`<${ErrorState} error=${pets.error} onRetry=${pets.reload}/>` :
      asList(pets.data).length === 0 ? html`<div class="card pad"><${EmptyState} icon="paw" title=${q ? 'No matches' : 'No pets yet'} sub=${q ? 'Try another search.' : 'Add your first patient.'} action=${!q && html`<button class="btn pri" onClick=${() => openForm('pet')}>Add pet</button>`}/></div>` :
      html`<div class="cardlist">${asList(pets.data).map(p => html`
        <button class="clientcard" onClick=${() => go('pet/' + p.id)}>
          <div style="display:flex;gap:12px;align-items:center"><span class="petav" style="background:${colorFor(p.id)};width:48px;height:48px;border-radius:14px;font-size:18px">${initials(p.name)}</span>
            <div style="text-align:left;flex:1"><div style="font-weight:700;font-size:16px">${p.name}</div><div class="alsub">${p.breed} · ${cap(p.sex)}</div></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:13px;padding-top:12px;border-top:1px solid var(--line)"><span class="alsub">${cap(p.species)} · ${ageText(p.age_months)}</span><span class="alsub" style="font-weight:600">${p.owner || ''}</span></div>
        </button>`)}</div>`}
  </section>`;
}
const cap = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** B4: open a clean, printable prescription / visit summary for a consultation. */
function printPrescription(c, pet, client) {
  const rows = (c.medicines || []).map(m => `<tr><td>${esc(m.medicine_name)}</td><td style="text-align:center">${esc(m.quantity)}</td><td>${esc(m.dosage || '')}</td></tr>`).join('');
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) { toast('Allow pop-ups to print the prescription', 'err'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Prescription — ${esc(pet.name)}</title>
    <style>body{font-family:system-ui,-apple-system,sans-serif;color:#1A2420;padding:34px;max-width:640px;margin:auto}
    h1{margin:0 0 2px;font-size:26px}.muted{color:#5E6B63}.row{display:flex;justify-content:space-between;margin:3px 0}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;padding:8px;border-bottom:1px solid #E6E0D4;font-size:14px}
    .hdr{border-bottom:2px solid #0E7C6E;padding-bottom:12px;margin-bottom:16px}.sec{margin-top:18px;font-weight:700}</style></head>
    <body><div class="hdr"><h1>KIV Clinic</h1><div class="muted">Prescription / Visit summary</div></div>
    <div class="row"><b>Patient</b><span>${esc(pet.name)} · ${esc(pet.breed || '')} ${esc(cap(pet.species || ''))}</span></div>
    <div class="row"><b>Owner</b><span>${esc(client ? client.name : '')} ${client && client.mobile ? '· ' + esc(client.mobile) : ''}</span></div>
    <div class="row"><b>Date</b><span>${esc(new Date(c.consult_date).toLocaleString('en-IN'))}</span></div>
    ${c.diagnosis ? `<div class="sec">Diagnosis</div><div>${esc(c.diagnosis)}</div>` : ''}
    ${c.treatment ? `<div class="sec">Treatment</div><div>${esc(c.treatment)}</div>` : ''}
    ${rows ? `<div class="sec">Prescription</div><table><thead><tr><th>Medicine</th><th style="text-align:center">Qty</th><th>Dosage / instructions</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    ${c.follow_up_recommendation ? `<div class="sec">Follow-up</div><div>${esc(c.follow_up_recommendation)}</div>` : ''}
    <div class="muted" style="margin-top:40px">_____________________________<br>Veterinarian signature</div></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) {} }, 350);
}

/* ============ Pet timeline ============ */
export function PetTimeline({ id }) {
  const rec = useLiveApi('pets.get', { id }, [id]);
  const cons = useLiveApi('consultations.byPet', { pet_id: id, all: true }, [id]);
  const [filter, setFilter] = useState('all');
  const [delDoc, setDelDoc] = useState(null);
  const [delPet, setDelPet] = useState(false);
  const [voidC, setVoidC] = useState(null);

  if (rec.loading) return Loading('Loading pet record…');
  if (rec.error) return html`<section><${ErrorState} error=${rec.error} onRetry=${rec.reload}/></section>`;
  const d = rec.data, pet = d.pet, client = d.client;

  // Build the unified timeline.
  const ev = [];
  asList(cons.data).forEach(c => ev.push({ type: 'consult', dot: '', date: c.consult_date, title: 'Consultation — ' + (c.diagnosis || 'Visit'), body: c.treatment || c.clinical_notes || '', meds: (c.medicines || []).map(m => [m.medicine_name, `${m.quantity}× ${m.dosage || ''}`.trim()]), consult: c }));
  (d.vaccination_history || []).forEach(v => ev.push({ type: 'vacc', dot: 'violet', date: v.date_administered, title: 'Vaccination — ' + v.vaccine_name, body: `Next due ${fmtDate(v.due_date)}${v.batch_number ? ' · Batch ' + v.batch_number : ''}` }));
  (d.weight_history || []).forEach(w => ev.push({ type: 'weight', dot: 'blue', date: w.recorded_at, title: 'Weight recorded', body: `${w.weight_kg} kg` }));
  (d.dewormings || []).forEach(x => ev.push({ type: 'deworm', dot: 'amber', date: x.date_administered, title: 'Deworming' + (x.product ? ' — ' + x.product : ''), body: `Next due ${fmtDate(x.next_due)}` }));
  (d.documents || []).forEach(doc => ev.push({ type: 'doc', dot: 'blue', date: doc.uploaded_at, title: 'Document — ' + doc.title, body: `${doc.doc_type} · ${(doc.size_bytes / 1024 / 1024).toFixed(1)} MB`, doc }));
  ev.sort((a, b) => new Date(b.date) - new Date(a.date));
  const shown = filter === 'all' ? ev : ev.filter(e => e.type === filter);

  const weights = (d.weight_history || []).slice().reverse();
  const maxW = Math.max(1, ...weights.map(w => Number(w.weight_kg) || 0));
  const filters = [['all', 'All'], ['consult', 'Consultations'], ['vacc', 'Vaccinations'], ['weight', 'Weight'], ['deworm', 'Deworming'], ['doc', 'Documents']];

  return html`<section data-screen-label="Pet record"><div class="petgrid">
    <div class="vitals">
      <div class="card pad">
        <div class="pethead"><span class="petav" style="background:${colorFor(pet.id)}">${initials(pet.name)}</span><div style="flex:1"><h2 style="font-size:24px">${pet.name}</h2><div class="alsub">${pet.breed} · ${cap(pet.species)} <${FreshnessLabel} at=${rec.fetchedAt} stale=${rec.stale} error=${rec.refreshError}/></div></div>
          <div style="display:flex;gap:6px"><button class="iconbtn" aria-label="Edit patient" title="Edit patient" onClick=${() => openForm('pet', { initial: pet })}>${Icon('check', 16)}</button>${isAdmin() && html`<button class="iconbtn" aria-label="Delete patient" title="Delete patient" style="color:var(--red)" onClick=${() => setDelPet(true)}>${Icon('trash', 16)}</button>`}</div></div>
        <div class="vrow"><span>Owner</span><b>${client ? client.name : '—'}</b></div>
        <div class="vrow"><span>Mobile</span><b>${client ? client.mobile : '—'}</b></div>
        <div class="vrow"><span>Age</span><b>${ageText(pet.age_months)}</b></div>
        <div class="vrow"><span>Sex</span><b>${cap(pet.sex)}</b></div>
        <div class="vrow"><span>Born</span><b>${pet.date_of_birth ? fmtDate(pet.date_of_birth) : '—'}</b></div>
        <div class="vrow"><span>Neutered</span><b>${pet.neutered ? 'Yes' : 'No'}</b></div>
        <div style="margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px"><span class="lab" style="margin:0">Weight trend</span><b style="font-size:18px;font-family:'Bricolage Grotesque'">${weights.length ? weights[weights.length - 1].weight_kg + ' kg' : '—'}</b></div>
          ${weights.length ? html`<div class="spark">${weights.slice(-10).map((w, i, arr) => html`<i class=${i === arr.length - 1 ? 'hi' : ''} style="height:${Math.max(12, (Number(w.weight_kg) / maxW) * 100)}%"></i>`)}</div>` : html`<div class="alsub">No weights recorded yet.</div>`}
          <button class="btn gho" style="width:100%;margin-top:10px" onClick=${() => openForm('weight', { pet_id: pet.id })}>${Icon('scale', 16)} Record weight</button></div>
        <button class="btn pri" style="width:100%;margin-top:12px" onClick=${() => go('consult/' + pet.id)}><span class="nico">${Icon('stetho')}</span>New consultation</button>
      </div>
      <div class="card pad" style="margin-top:18px"><div class="sectttl" style="margin-bottom:12px">Reminders</div>
        <${PetReminders} pet=${pet} vaccinations=${d.vaccination_history} deworming_due=${d.deworming_due}/>
      </div>
    </div>
    <div>
      <div class="hdr" style="margin-bottom:14px"><div class="sectttl">Medical timeline</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn gho" onClick=${() => openForm('vaccination', { pet_id: pet.id })}>${Icon('syringe', 16)} Vaccinate</button><button class="btn gho" onClick=${() => openForm('deworming', { pet_id: pet.id })}>${Icon('drop', 16)} Deworm</button><button class="btn gho" onClick=${() => openForm('document', { pet_id: pet.id })}><span class="nico">${Icon('file')}</span>Upload</button></div></div>
      <div class="evtfilters">${filters.map(([id2, l]) => html`<button class="pill ${filter === id2 ? 'on' : ''}" onClick=${() => setFilter(id2)}>${l}</button>`)}</div>
      ${cons.loading ? SkeletonRows(3) : shown.length === 0 ? html`<div class="card pad"><${EmptyState} icon="stetho" title="Nothing here yet" sub="Records will appear on this timeline as you add them."/></div>` :
        html`<div class="etl">${shown.map(e => html`<div class="evt"><span class="evdot ${e.dot}"></span><div class="evcard">
          <div class="evtop"><span class="evttl">${e.title}</span><span class="evdate">${fmtDate(e.date)}</span></div>
          <div class="mut" style="font-size:13.5px">${e.body}</div>
          ${e.meds && e.meds.length > 0 && html`<div style="margin-top:10px;background:var(--surface2);border-radius:11px;padding:10px 13px">${e.meds.map(m => html`<div class="medline"><span style="font-weight:600">${m[0]}</span><span class="mut">${m[1]}</span></div>`)}</div>`}
          ${e.doc && html`<div style="margin-top:9px;display:flex;gap:8px"><button class="lnk" onClick=${() => openDocument(e.doc.id)}>Open document →</button>${isAdmin() && html`<button class="lnk" style="color:var(--red)" onClick=${() => setDelDoc(e.doc)}>Delete</button>`}</div>`}
          ${e.type === 'consult' && html`<div style="margin-top:9px;display:flex;gap:10px"><button class="lnk" onClick=${() => printPrescription(e.consult, pet, client)}>${Icon('file', 13)} Print prescription</button>${isAdmin() && html`<button class="lnk" style="color:var(--red)" onClick=${() => setVoidC(e.consult)}>Void</button>`}</div>`}
        </div></div>`)}</div>`}
    </div>
  </div>
  ${delDoc && html`<${ConfirmDialog} title="Delete document permanently?" danger=${true} confirmLabel="Delete forever" body=${`"${delDoc.title}" will be permanently removed from Drive and cannot be recovered.`} onConfirm=${async () => { await api('documents.delete', { id: delDoc.id }, { mutating: true }); toast('Document deleted', 'ok'); setDelDoc(null); refreshAll(); }} onClose=${() => setDelDoc(null)}/>`}
  ${delPet && html`<${ConfirmDialog} title="Delete patient?" danger=${true} confirmLabel="Delete patient" body=${`Remove ${pet.name} and all their records (consultations, vaccinations, appointments, documents)? This can't be undone.`} onConfirm=${async () => { try { await api('pets.delete', { id: pet.id }, { mutating: true }); toast('Patient deleted', 'ok'); setDelPet(false); refreshAll(); go('pets'); } catch (e) { toast(humanError(e), 'err'); } }} onClose=${() => setDelPet(false)}/>`}
  ${voidC && html`<${ConfirmDialog} title="Void this consultation?" danger=${true} confirmLabel="Void & re-credit stock" body=${`Void the consultation from ${fmtDate(voidC.consult_date)}? Any stock it deducted is added back to inventory. This can't be undone.`} onConfirm=${async () => { try { const r = await api('consultations.delete', { id: voidC.id }, { mutating: true }); toast('Consultation voided' + (r && r.stock_recredited ? ' · stock re-credited' : ''), 'ok'); setVoidC(null); refreshAll(); } catch (e) { toast(humanError(e), 'err'); } }} onClose=${() => setVoidC(null)}/>`}
  </section>`;
}

function PetReminders({ pet, vaccinations, deworming_due }) {
  const items = [];
  const nextVacc = (vaccinations || []).slice().sort((a, b) => new Date(a.due_date) - new Date(b.due_date)).find(v => new Date(v.due_date) >= new Date());
  const overdueVacc = (vaccinations || []).find(v => new Date(v.due_date) < new Date());
  if (overdueVacc) items.push({ cls: 'red', icon: 'syringe', t: 'Vaccination overdue', s: `${overdueVacc.vaccine_name} — was due ${fmtDate(overdueVacc.due_date)}` });
  else if (nextVacc) items.push({ cls: 'teal', icon: 'syringe', t: 'Next vaccination', s: `${nextVacc.vaccine_name} · ${fmtDate(nextVacc.due_date)}` });
  if (deworming_due && deworming_due.due) items.push({ cls: 'amber', icon: 'drop', t: 'Deworming due', s: deworming_due.next_due ? 'Was due ' + fmtDate(deworming_due.next_due) : 'No deworming on record' });
  if (!items.length) return html`<div class="alsub">No reminders — everything is up to date.</div>`;
  return html`${items.map(r => html`<div class="remind ${r.cls}"><span class="alico">${Icon(r.icon, 18)}</span><div><div style="font-weight:700;font-size:13.5px">${r.t}</div><div class="alsub">${r.s}</div></div></div>`)}`;
}
