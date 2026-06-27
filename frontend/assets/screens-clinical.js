// screens-clinical.js — Consultation composer (atomic FEFO), Appointments, Vaccinations/Deworming.
import {
  html, useState, useEffect, api, asList, isAdmin, go, Icon, toast, humanError, refreshAll, useEvent,
  useApi, useMutation, Modal, ConfirmDialog, EmptyState, ErrorState, Loading, SkeletonRows, Spinner,
  initials, colorFor, fmtDate, fmtTime, inr, ageText, openForm, Field, Input, Textarea, Seg, Select, SaveButton,
  TYPE_CLS, TYPE_LABEL, BAR, APPT_STAT
} from './core.js';

function useLiveApi(action, payload, deps = []) { const r = useApi(action, payload, deps); useEvent('kiv-refresh', () => r.reload(), deps); return r; }

/* ============ Consultation composer ============ */
export function Consultation({ petId }) {
  const pets = useApi('pets.list', { limit: 500 }, []);
  const medsApi = useApi('medicines.list', { limit: 500 }, []);
  const [pid, setPid] = useState(petId || '');
  const [f, setF] = useState({ diagnosis: '', treatment: '', clinical_notes: '', follow_up_interval: '', weight: '' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const [rx, setRx] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (petId) setPid(petId); }, [petId]);

  // Aggregate stock by medicine name (backend deducts FEFO across batches of the same name).
  const agg = {};
  asList(medsApi.data).forEach(m => { const k = (m.name || '').toLowerCase(); if (!agg[k]) agg[k] = { id: m.id, name: m.name, available: 0 }; agg[k].available += Number(m.quantity || 0); });
  const medList = Object.values(agg).sort((a, b) => a.name.localeCompare(b.name));
  const medOpts = [['', '— Select medicine —'], ...medList.map(m => [m.id, `${m.name} (${m.available} in stock)`])];
  const availOf = (id) => { const m = medList.find(x => x.id === id); return m ? m.available : 0; };

  const addRx = () => setRx(r => [...r, { medicine_id: '', quantity: 1, dosage: '' }]);
  const setRxLine = (i, k, v) => setRx(r => r.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const rmRx = (i) => setRx(r => r.filter((_, j) => j !== i));
  const overStock = rx.some(l => l.medicine_id && Number(l.quantity) > availOf(l.medicine_id));

  const pet = asList(pets.data).find(p => p.id === pid);

  async function save(e) {
    e && e.preventDefault();
    if (!pid) return toast('Choose a pet first', 'err');
    if (overStock) return toast('A prescribed quantity exceeds available stock', 'err');
    setBusy(true);
    try {
      const meds = rx.filter(l => l.medicine_id && Number(l.quantity) > 0).map(l => ({ medicine_id: l.medicine_id, quantity: Number(l.quantity), dosage: l.dosage }));
      await api('consultations.create', { pet_id: pid, diagnosis: f.diagnosis, treatment: f.treatment, clinical_notes: f.clinical_notes, follow_up_interval: f.follow_up_interval || undefined, medicines: meds }, { mutating: true });
      if (f.weight) { try { await api('petWeights.add', { pet_id: pid, weight_kg: f.weight }, { mutating: true }); } catch {} }
      toast('Consultation saved' + (meds.length ? ' · stock updated' : ''), 'ok');
      refreshAll();
      go('pet/' + pid);
    } catch (err) { toast(humanError(err), 'err'); setBusy(false); }
  }

  const petOpts = [['', '— Select pet —'], ...asList(pets.data).map(p => [p.id, `${p.name} · ${p.owner || ''}`])];
  return html`<section data-screen-label="Consultation">
    <div class="hdr"><div><div class="h-ey">New record</div><div class="h-ttl">Consultation</div></div>
      <div style="display:flex;gap:10px"><button class="btn gho" onClick=${() => history.back()}>Cancel</button>
        <button class="btn pri" disabled=${busy || overStock} onClick=${save}>${busy ? html`${Spinner(16)} Saving…` : html`${Icon('check', 17)}Save & prescribe`}</button></div></div>
    <div class="dgrid">
      <div class="card pad">
        ${pet ? html`<div style="display:flex;gap:12px;align-items:center;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--line)"><span class="petav" style="background:${colorFor(pet.id)};width:48px;height:48px;border-radius:14px;font-size:18px">${initials(pet.name)}</span><div><div style="font-weight:700;font-size:17px">${pet.name}</div><div class="alsub">${pet.breed} · ${ageText(pet.age_months)} · ${pet.owner || ''}</div></div></div>`
          : html`<${Field} label="Pet"><${Select} value=${pid} onInput=${setPid} options=${petOpts}/><//>`}
        <${Field} label="Diagnosis"><${Input} value=${f.diagnosis} onInput=${set('diagnosis')} placeholder="Primary diagnosis"/><//>
        <${Field} label="Treatment"><${Textarea} value=${f.treatment} onInput=${set('treatment')} placeholder="Plan, dosage, advice…"/><//>
        <${Field} label="Clinical notes"><${Textarea} value=${f.clinical_notes} onInput=${set('clinical_notes')} placeholder="Observations, vitals…"/><//>
        <div class="formgrid">
          <${Field} label="Follow-up recommendation"><${Seg} value=${f.follow_up_interval} onInput=${set('follow_up_interval')} options=${[['', 'None'], ['5d', '5 days'], ['1w', '1 week']]}/><//>
          <${Field} label="Weight today (kg)"><${Input} type="number" value=${f.weight} onInput=${set('weight')}/><//>
        </div>
      </div>
      <div class="stack">
        <div class="card pad">
          <div class="sectttl" style="margin-bottom:6px">Prescription</div>
          <div class="alsub" style="margin-bottom:14px">Stock is deducted automatically (FEFO) when you save.</div>
          ${rx.length === 0 && html`<div class="alsub" style="margin-bottom:10px">No medicines added.</div>`}
          ${rx.map((l, i) => { const avail = availOf(l.medicine_id); const over = l.medicine_id && Number(l.quantity) > avail; const pct = avail ? Math.min(100, (Number(l.quantity) / avail) * 100) : 0; return html`
            <div style="border:1px solid ${over ? 'var(--red)' : 'var(--line)'};border-radius:13px;padding:12px;margin-bottom:10px">
              <div style="display:flex;gap:8px;margin-bottom:8px"><div style="flex:1"><${Select} value=${l.medicine_id} onInput=${v => setRxLine(i, 'medicine_id', v)} options=${medOpts}/></div>
                <input class="inp" type="number" style="width:74px" value=${l.quantity} onInput=${e => setRxLine(i, 'quantity', e.target.value)}/>
                <button class="iconbtn" onClick=${() => rmRx(i)}>${Icon('x', 16)}</button></div>
              <input class="inp" placeholder="Dosage / instructions" value=${l.dosage} onInput=${e => setRxLine(i, 'dosage', e.target.value)}/>
              ${l.medicine_id && html`<div class="alsub" style="margin-top:6px">${over ? html`<span style="color:var(--red);font-weight:700">Only ${avail} in stock</span>` : `${l.quantity} of ${avail} in stock`}</div><div class="stockbar"><i style="width:${pct}%;background:${over ? 'var(--red)' : 'var(--teal)'}"></i></div>`}
            </div>`; })}
          <button class="btn gho" style="width:100%;margin-top:4px" onClick=${addRx}><span class="nico">${Icon('plus')}</span>Add medicine</button>
        </div>
        <div class="card pad"><div class="sectttl" style="margin-bottom:10px">Attach documents</div>
          <button style="width:100%;border:2px dashed var(--line);border-radius:14px;padding:22px;text-align:center;color:var(--faint);background:none" onClick=${() => pid ? openForm('document', { pet_id: pid }) : toast('Choose a pet first', 'err')}>
            <div style="display:flex;justify-content:center;margin-bottom:8px">${Icon('file', 22)}</div><div style="font-weight:600;font-size:13.5px">Upload X-ray, lab or Rx</div></button>
        </div>
      </div>
    </div>
  </section>`;
}

/* ============ Appointments ============ */
export function Appointments() {
  const [archived, setArchived] = useState(false);
  const [type, setType] = useState('All');
  const list = useLiveApi('appointments.list', { archived, limit: 200 }, [archived]);
  const [actions, setActions] = useState(null);
  const days = lastSevenDays();
  let rows = asList(list.data);
  if (type !== 'All') rows = rows.filter(a => type === 'Follow-up' ? a.type === 'FollowUp' : a.type === type);

  return html`<section data-screen-label="Appointments">
    <div class="hdr"><div><div class="h-ey">Schedule · ${archived ? 'archived' : 'last 7 days active'}</div><div class="h-ttl">Appointments</div></div>
      <button class="btn pri" onClick=${() => openForm('appointment')}><span class="nico">${Icon('plus')}</span>Book appointment</button></div>
    <div style="display:flex;gap:8px;margin-bottom:18px;overflow:auto">${days.map(d => html`<div class="kpi" style="min-width:78px;align-items:center;text-align:center;gap:2px;${d.today ? 'border-color:var(--teal)' : ''}"><span class="alsub" style="font-weight:700">${d.day}</span><span class="kpinum" style="font-size:22px">${d.date}</span></div>`)}</div>
    <div class="evtfilters" style="justify-content:space-between"><div style="display:flex;gap:8px;flex-wrap:wrap">${['All', 'OPD', 'Surgery', 'Grooming', 'Follow-up'].map(t => html`<button class="pill ${type === t ? 'on' : ''}" onClick=${() => setType(t)}>${t}</button>`)}</div>
      <button class="pill ${archived ? 'on' : ''}" onClick=${() => setArchived(a => !a)}>${Icon('clock', 15)} ${archived ? 'Showing archived' : 'Show archived'}</button></div>
    <div class="card pad">
      ${list.loading ? SkeletonRows(5) : list.error ? html`<${ErrorState} error=${list.error} onRetry=${list.reload}/>` :
        rows.length === 0 ? html`<${EmptyState} icon="cal" title="No appointments" sub=${archived ? 'No archived appointments in this filter.' : 'Book one to get started.'}/>` :
        html`<div class="tl">${rows.map(a => { const [time, ap] = fmtTime(a.scheduled_at); const [sc, sl] = APPT_STAT[a.status] || ['wait', a.status]; return html`
          <div class="tlrow"><div class="tltime">${time}<small>${ap}</small></div><div class="tlbar" style="background:${BAR[a.type] || 'var(--line)'}"></div>
            <div class="tlbody"><div class="tlpet"><span class="peta" style="background:${colorFor(a.pet_id)}">${initials(a.pet_name || 'P')}</span>${a.pet_name || 'Pet'}<span class="tag ${TYPE_CLS[a.type] || 'opd'}">${TYPE_LABEL(a.type)}</span></div><div class="tlmeta">${a.reason || '—'}${a.client_name ? ' · ' + a.client_name : ''} · ${fmtDate(a.scheduled_at)}</div></div>
            <div class="row-actions"><span class="stat ${sc}">${sl}</span><button class="iconbtn" onClick=${() => setActions(a)}>${Icon('chevron')}</button></div></div>`; })}</div>`}
    </div>
    ${actions && html`<${ApptActions} appt=${actions} close=${() => setActions(null)}/>`}
  </section>`;
}

function ApptActions({ appt, close }) {
  const [when, setWhen] = useState(toLocal(appt.scheduled_at));
  const [busy, setBusy] = useState('');
  async function run(kind) {
    setBusy(kind);
    try {
      if (kind === 'reschedule') await api('appointments.reschedule', { id: appt.id, scheduled_at: new Date(when).toISOString() }, { mutating: true });
      if (kind === 'complete') await api('appointments.update', { id: appt.id, status: 'completed' }, { mutating: true });
      if (kind === 'cancel') await api('appointments.cancel', { id: appt.id }, { mutating: true });
      toast(kind === 'cancel' ? 'Appointment cancelled' : kind === 'complete' ? 'Marked completed' : 'Rescheduled', 'ok');
      refreshAll(); close();
    } catch (e) { toast(humanError(e), 'err'); setBusy(''); }
  }
  return html`<${Modal} title=${`${appt.pet_name} · ${TYPE_LABEL(appt.type)}`} onClose=${close}
    footer=${html`<button class="btn gho" style="margin-right:auto;color:var(--red)" disabled=${busy} onClick=${() => run('cancel')}>${busy === 'cancel' ? Spinner(16) : 'Cancel visit'}</button>
      <button class="btn gho" disabled=${busy} onClick=${() => run('complete')}>${busy === 'complete' ? Spinner(16) : 'Mark completed'}</button>
      <button class="btn pri" disabled=${busy} onClick=${() => run('reschedule')}>${busy === 'reschedule' ? html`${Spinner(16)} Saving…` : 'Reschedule'}</button>`}>
    <div class="alsub" style="margin-bottom:12px">${appt.reason || '—'}</div>
    <${Field} label="New date & time"><${Input} type="datetime-local" value=${when} onInput=${setWhen}/><//>
  <//>`;
}
const toLocal = (iso) => { const d = new Date(iso); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16); };

/* ============ Vaccinations + Deworming ============ */
export function Vaccinations() {
  const due = useLiveApi('vaccinations.dueList', { days: 60 }, []);
  const deworm = useLiveApi('dewormings.dueList', {}, []);
  return html`<section data-screen-label="Vaccinations">
    <div class="hdr"><div><div class="h-ey">Immunization & deworming</div><div class="h-ttl">Vaccinations</div></div>
      <div style="display:flex;gap:10px"><button class="btn gho" onClick=${() => openForm('deworming')}>${Icon('drop', 16)} Deworming</button><button class="btn pri" onClick=${() => openForm('vaccination')}><span class="nico">${Icon('plus')}</span>Record vaccination</button></div></div>

    <div class="card pad" style="margin-bottom:18px">
      <div class="sectttl" style="margin-bottom:6px">Vaccinations due</div>
      <div class="alsub" style="margin-bottom:8px">Auto due dates from the vaccine schedule · overdue flagged in red.</div>
      ${due.loading ? SkeletonRows(3) : due.error ? html`<${ErrorState} error=${due.error} onRetry=${due.reload}/>` :
        asList(due.data).length === 0 ? html`<${EmptyState} icon="syringe" title="Nothing due" sub="All vaccinations are up to date."/>` :
        html`<div style="overflow:auto"><table class="tbl"><thead><tr><th>Pet</th><th class="hidesm">Vaccine</th><th>Due date</th><th>Status</th></tr></thead><tbody>
          ${asList(due.data).map(x => html`<tr class="trow" style="cursor:pointer" onClick=${() => go('pet/' + x.pet_id)}>
            <td><div style="display:flex;align-items:center;gap:9px"><span class="peta" style="background:${colorFor(x.pet_id)}">${initials(x.pet_name || 'P')}</span><b>${x.pet_name}</b></div></td>
            <td class="hidesm">${x.vaccine_name}</td><td>${fmtDate(x.due_date)}</td>
            <td><span class="stat ${x.overdue ? 'cancel' : 'prog'}">${x.overdue ? 'Overdue' : 'Due'}</span></td></tr>`)}
        </tbody></table></div>`}
    </div>

    <div class="card pad">
      <div class="sectttl" style="margin-bottom:6px">Deworming reminders</div>
      <div class="alsub" style="margin-bottom:8px">Every 3 months for pets older than 6 months.</div>
      ${deworm.loading ? SkeletonRows(2) : asList(deworm.data).length === 0 ? html`<${EmptyState} icon="drop" title="Nothing due" sub="No dewormings are due."/>` :
        html`<div style="overflow:auto"><table class="tbl"><thead><tr><th>Pet</th><th>Next due</th><th>Status</th></tr></thead><tbody>
          ${asList(deworm.data).map(x => html`<tr class="trow" style="cursor:pointer" onClick=${() => go('pet/' + x.pet_id)}>
            <td><div style="display:flex;align-items:center;gap:9px"><span class="peta" style="background:${colorFor(x.pet_id)}">${initials(x.pet_name || 'P')}</span><b>${x.pet_name}</b></div></td>
            <td>${x.next_due ? fmtDate(x.next_due) : '—'}</td><td><span class="stat cancel">${x.reason === 'never_dewormed' ? 'Never dewormed' : 'Due'}</span></td></tr>`)}
        </tbody></table></div>`}
    </div>
  </section>`;
}
function lastSevenDays() { const out = []; const t = new Date(); for (let i = 6; i >= 0; i--) { const d = new Date(t); d.setDate(t.getDate() - i); out.push({ day: d.toLocaleDateString('en-IN', { weekday: 'short' }), date: d.getDate(), today: i === 0 }); } return out; }
