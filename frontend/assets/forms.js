// forms.js — create/edit modals. Every form uses useMutation → visible pending state + success toast
// + inline field errors (e.g. duplicate mobile). FormHost renders the right form for `openForm(entity)`.
import {
  html, useState, useEffect, api, asList, isAdmin, toast, refreshAll, go, Icon, copyText, openForm,
  useApi, useMutation, useEvent, Modal, ConfirmDialog, Field, Input, Textarea, Select, Seg, SaveButton, Spinner, FauxProgress
} from './core.js';

/** Admin-only delete control + confirm for an edit modal (M3). */
function useDeleteControl(action, label, id, body, close) {
  const [open, setOpen] = useState(false);
  const del = useMutation(action, { successMsg: label + ' deleted', onSuccess: () => { refreshAll(); close(); } });
  return {
    button: html`<button type="button" class="btn gho" style="margin-right:auto;color:var(--red)" onClick=${() => setOpen(true)}>${Icon('trash', 16)} Delete</button>`,
    dialog: open && html`<${ConfirmDialog} title=${'Delete ' + label.toLowerCase() + '?'} danger=${true} confirmLabel="Delete" body=${body} onConfirm=${() => del.run({ id })} onClose=${() => setOpen(false)}/>`
  };
}

const ferr = (errs, key) => errs && errs[key];

/* ---------- Client ---------- */
export function ClientForm({ props, close }) {
  const init = props.initial || {};
  const [f, setF] = useState({ name: init.name || '', mobile: init.mobile || '', address: init.address || '', email: init.email || '' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const edit = !!init.id;
  // B8: after creating a NEW owner, chain straight into adding their pet (the #1 front-desk flow).
  const m = useMutation(edit ? 'clients.update' : 'clients.create', { successMsg: edit ? 'Client updated' : 'Client added', onSuccess: (data) => { refreshAll(); close(); if (!edit && data && data.id) setTimeout(() => openForm('pet', { client_id: data.id }), 0); } });
  const submit = (e) => { e.preventDefault(); m.run(edit ? { id: init.id, ...f } : f).catch(() => {}); };
  return html`<${Modal} title=${edit ? 'Edit client' : 'Add client'} onClose=${close}
    footer=${html`<button class="btn gho" onClick=${close}>Cancel</button><${SaveButton} busy=${m.busy} label=${edit ? 'Save changes' : 'Add client'} onClick=${submit}/>`}>
    <form onSubmit=${submit}>
      <${Field} label="Client name" error=${ferr(m.fieldErrors, 'name')}><${Input} value=${f.name} onInput=${set('name')} autofocus=${true}/><//>
      <${Field} label="Mobile number" error=${ferr(m.fieldErrors, 'mobile') && 'This mobile already belongs to another client.'}><${Input} value=${f.mobile} onInput=${set('mobile')} placeholder="98xxxxxxxx"/><//>
      <${Field} label="Address" error=${ferr(m.fieldErrors, 'address')}><${Input} value=${f.address} onInput=${set('address')}/><//>
      <${Field} label="Email (optional)" error=${ferr(m.fieldErrors, 'email')}><${Input} value=${f.email} onInput=${set('email')} type="email"/><//>
      <button type="submit" style="display:none"></button>
    </form>
  <//>`;
}

/* ---------- Pet ---------- */
export function PetForm({ props, close }) {
  const init = props.initial || {};
  const clients = useApi('clients.list', { limit: 500 }, []);
  const [f, setF] = useState({ client_id: props.client_id || init.client_id || '', name: init.name || '', species: init.species || 'dog', breed: init.breed || '', sex: init.sex || 'male', date_of_birth: (init.date_of_birth || '').slice(0, 10), neutered: !!init.neutered });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const edit = !!init.id;
  const m = useMutation(edit ? 'pets.update' : 'pets.create', { successMsg: edit ? 'Pet updated' : 'Pet added', onSuccess: () => { refreshAll(); close(); } });
  const submit = (e) => { e.preventDefault(); m.run(edit ? { id: init.id, ...f } : f).catch(() => {}); };
  const clientOpts = [['', '— Select owner —'], ...asList(clients.data).map(c => [c.id, `${c.name} · ${c.mobile}`])];
  const ownerLoading = !props.client_id && clients.loading && !clients.data;
  return html`<${Modal} title=${edit ? 'Edit pet' : 'Add pet'} onClose=${close}
    footer=${html`<button class="btn gho" onClick=${close}>Cancel</button><${SaveButton} busy=${m.busy} disabled=${ownerLoading} label=${edit ? 'Save changes' : 'Add pet'} onClick=${submit}/>`}>
    <form onSubmit=${submit}>
      ${!props.client_id && html`<${Field} label="Owner" error=${(ferr(m.fieldErrors, 'client_id') && 'Choose a valid owner.') || (clients.error && !clients.data && 'Couldn’t load owners — retry.')} hint=${html`Owner not listed? <button type="button" class="lnk" onClick=${() => { close(); setTimeout(() => openForm('client'), 0); }}>＋ Add new owner</button>`}><${Select} value=${f.client_id} onInput=${set('client_id')} options=${clientOpts} loading=${ownerLoading}/><//>`}
      <${Field} label="Pet name" error=${ferr(m.fieldErrors, 'name')}><${Input} value=${f.name} onInput=${set('name')} autofocus=${true}/><//>
      <div class="formgrid">
        <${Field} label="Species"><${Select} value=${f.species} onInput=${set('species')} options=${[['dog', 'Dog'], ['cat', 'Cat'], ['other', 'Other']]}/><//>
        <${Field} label="Sex"><${Select} value=${f.sex} onInput=${set('sex')} options=${[['male', 'Male'], ['female', 'Female'], ['unknown', 'Unknown']]}/><//>
      </div>
      <div class="formgrid">
        <${Field} label="Breed" error=${ferr(m.fieldErrors, 'breed')}><${Input} value=${f.breed} onInput=${set('breed')}/><//>
        <${Field} label="Date of birth" hint="Used to compute age & deworming"><${Input} type="date" value=${f.date_of_birth} onInput=${set('date_of_birth')}/><//>
      </div>
      <label style="display:flex;gap:9px;align-items:center;font-weight:600;font-size:14px"><input type="checkbox" checked=${f.neutered} onChange=${e => set('neutered')(e.target.checked)}/> Neutered / spayed</label>
      <button type="submit" style="display:none"></button>
    </form>
  <//>`;
}

/* ---------- Supplier ---------- */
export function SupplierForm({ props, close }) {
  const init = props.initial || {};
  const [f, setF] = useState({ name: init.name || '', contact_person: init.contact_person || '', mobile: init.mobile || '', email: init.email || '', address: init.address || '' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const edit = !!init.id;
  const m = useMutation(edit ? 'suppliers.update' : 'suppliers.create', { successMsg: edit ? 'Supplier updated' : 'Supplier added', onSuccess: () => { refreshAll(); close(); } });
  const submit = (e) => { e.preventDefault(); m.run(edit ? { id: init.id, ...f } : f).catch(() => {}); };
  const delCtl = useDeleteControl('suppliers.delete', 'Supplier', init.id, `Remove supplier "${init.name || ''}"? Medicines keep their record.`, close);
  return html`<${Modal} title=${edit ? 'Edit supplier' : 'Add supplier'} onClose=${close}
    footer=${html`${edit && isAdmin() && delCtl.button}<button class="btn gho" onClick=${close}>Cancel</button><${SaveButton} busy=${m.busy} label="Save" onClick=${submit}/>${delCtl.dialog}`}>
    <form onSubmit=${submit}>
      <${Field} label="Supplier name" error=${ferr(m.fieldErrors, 'name')}><${Input} value=${f.name} onInput=${set('name')} autofocus=${true}/><//>
      <div class="formgrid">
        <${Field} label="Contact person"><${Input} value=${f.contact_person} onInput=${set('contact_person')}/><//>
        <${Field} label="Mobile"><${Input} value=${f.mobile} onInput=${set('mobile')}/><//>
      </div>
      <${Field} label="Email (optional)"><${Input} value=${f.email} onInput=${set('email')} type="email"/><//>
      <${Field} label="Address"><${Input} value=${f.address} onInput=${set('address')}/><//>
      <button type="submit" style="display:none"></button>
    </form>
  <//>`;
}

/* ---------- Medicine ---------- */
export function MedicineForm({ props, close }) {
  const init = props.initial || {};
  const suppliers = useApi('suppliers.list', {}, []);
  const [f, setF] = useState({ name: init.name || '', batch_number: init.batch_number || '', quantity: init.quantity ?? '', unit: init.unit || '', purchase_price: init.purchase_price ?? '', selling_price: init.selling_price ?? '', supplier_id: init.supplier_id || '', expiry_date: (init.expiry_date || '').slice(0, 10), reorder_threshold: init.reorder_threshold ?? 3 });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const edit = !!init.id;
  const m = useMutation(edit ? 'medicines.update' : 'medicines.create', { successMsg: edit ? 'Medicine updated' : 'Medicine added', onSuccess: () => { refreshAll(); close(); } });
  const submit = (e) => { e.preventDefault(); m.run(edit ? { id: init.id, ...f } : f).catch(() => {}); };
  const supOpts = [['', '— Supplier —'], ...asList(suppliers.data).map(s => [s.id, s.name])];
  const delCtl = useDeleteControl('medicines.delete', 'Medicine', init.id, `Remove "${init.name || 'this medicine'}" from inventory? Past prescriptions keep their record.`, close);
  return html`<${Modal} title=${edit ? 'Edit medicine' : 'Add medicine'} onClose=${close}
    footer=${html`${edit && isAdmin() && delCtl.button}<button class="btn gho" onClick=${close}>Cancel</button><${SaveButton} busy=${m.busy} label="Save" onClick=${submit}/>${delCtl.dialog}`}>
    <form onSubmit=${submit}>
      <${Field} label="Medicine name" error=${ferr(m.fieldErrors, 'name')}><${Input} value=${f.name} onInput=${set('name')} autofocus=${true}/><//>
      <div class="formgrid">
        <${Field} label="Batch number"><${Input} value=${f.batch_number} onInput=${set('batch_number')}/><//>
        <${Field} label="Expiry date" error=${ferr(m.fieldErrors, 'expiry_date')}><${Input} type="date" value=${f.expiry_date} onInput=${set('expiry_date')}/><//>
      </div>
      <div class="formgrid">
        <${Field} label="Quantity" error=${ferr(m.fieldErrors, 'quantity')}><${Input} type="number" value=${f.quantity} onInput=${set('quantity')}/><//>
        <${Field} label="Unit"><${Input} value=${f.unit} onInput=${set('unit')} placeholder="tablet / vial"/><//>
      </div>
      <div class="formgrid">
        <${Field} label="Purchase price (₹)" error=${ferr(m.fieldErrors, 'purchase_price')}><${Input} type="number" value=${f.purchase_price} onInput=${set('purchase_price')}/><//>
        <${Field} label="Selling price (₹)"><${Input} type="number" value=${f.selling_price} onInput=${set('selling_price')}/><//>
      </div>
      <${Field} label="Supplier"><${Select} value=${f.supplier_id} onInput=${set('supplier_id')} options=${supOpts} loading=${suppliers.loading && !suppliers.data}/><//>
      <button type="submit" style="display:none"></button>
    </form>
  <//>`;
}

/* ---------- Appointment ---------- */
export function AppointmentForm({ props, close }) {
  const pets = useApi('pets.list', { limit: 500 }, []);
  const [f, setF] = useState({ pet_id: props.pet_id || '', type: 'OPD', scheduled_at: defaultSlot(), reason: '' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const m = useMutation('appointments.create', { successMsg: 'Appointment booked', onSuccess: () => { refreshAll(); close(); } });
  const submit = (e) => { e.preventDefault(); m.run({ ...f, scheduled_at: new Date(f.scheduled_at).toISOString() }).catch(() => {}); };
  const petOpts = [['', '— Select pet —'], ...asList(pets.data).map(p => [p.id, `${p.name} · ${p.owner || ''}`])];
  const refLoading = !props.pet_id && pets.loading && !pets.data;
  return html`<${Modal} title="Book appointment" onClose=${close}
    footer=${html`<button class="btn gho" onClick=${close}>Cancel</button><${SaveButton} busy=${m.busy} disabled=${refLoading} label="Book" icon="cal" onClick=${submit}/>`}>
    <form onSubmit=${submit}>
      ${!props.pet_id && html`<${Field} label="Pet" error=${(ferr(m.fieldErrors, 'pet_id') && 'Choose a pet.') || (pets.error && !pets.data && 'Couldn’t load pets — retry.')}><${Select} value=${f.pet_id} onInput=${set('pet_id')} options=${petOpts} loading=${refLoading}/><//>`}
      <${Field} label="Type"><${Seg} value=${f.type} onInput=${set('type')} options=${[['OPD', 'OPD'], ['Surgery', 'Surgery'], ['Grooming', 'Grooming']]}/><//>
      <${Field} label="Date & time"><${Input} type="datetime-local" value=${f.scheduled_at} onInput=${set('scheduled_at')}/><//>
      <${Field} label="Reason"><${Textarea} value=${f.reason} onInput=${set('reason')} placeholder="Presenting complaint / purpose"/><//>
      <button type="submit" style="display:none"></button>
    </form>
  <//>`;
}
function defaultSlot() { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); const off = d.getTimezoneOffset(); const local = new Date(d.getTime() - off * 60000); return local.toISOString().slice(0, 16); }

/* ---------- Vaccination ---------- */
export function VaccinationForm({ props, close }) {
  const pets = useApi('pets.list', { limit: 500 }, []);
  const vtypes = useApi('vaccineTypes.list', {}, []);
  const [f, setF] = useState({ pet_id: props.pet_id || '', vaccine_type_id: '', date_administered: new Date().toISOString().slice(0, 10), batch_number: '' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const m = useMutation('vaccinations.create', { successMsg: 'Vaccination recorded', onSuccess: () => { refreshAll(); close(); } });
  const submit = (e) => { e.preventDefault(); m.run(f).catch(() => {}); };
  const petOpts = [['', '— Select pet —'], ...asList(pets.data).map(p => [p.id, `${p.name} · ${p.owner || ''}`])];
  const vtOpts = [['', '— Vaccine —'], ...asList(vtypes.data).map(v => [v.id, v.name])];
  const petLoading = !props.pet_id && pets.loading && !pets.data;
  const vtLoading = vtypes.loading && !vtypes.data;
  return html`<${Modal} title="Record vaccination" onClose=${close}
    footer=${html`<button class="btn gho" onClick=${close}>Cancel</button><${SaveButton} busy=${m.busy} disabled=${petLoading || vtLoading} label="Record" icon="syringe" onClick=${submit}/>`}>
    <form onSubmit=${submit}>
      ${!props.pet_id && html`<${Field} label="Pet" error=${ferr(m.fieldErrors, 'pet_id') && 'Choose a pet.'}><${Select} value=${f.pet_id} onInput=${set('pet_id')} options=${petOpts} loading=${petLoading}/><//>`}
      <${Field} label="Vaccine" error=${ferr(m.fieldErrors, 'vaccine_type_id') && 'Choose a vaccine.'}><${Select} value=${f.vaccine_type_id} onInput=${set('vaccine_type_id')} options=${vtOpts} loading=${vtLoading}/><//>
      <div class="formgrid">
        <${Field} label="Date administered"><${Input} type="date" value=${f.date_administered} onInput=${set('date_administered')}/><//>
        <${Field} label="Batch (optional)"><${Input} value=${f.batch_number} onInput=${set('batch_number')}/><//>
      </div>
      <p class="alsub">Next due date is calculated automatically from the vaccine schedule.</p>
      <button type="submit" style="display:none"></button>
    </form>
  <//>`;
}

/* ---------- Deworming ---------- */
export function DewormingForm({ props, close }) {
  const pets = useApi('pets.list', { limit: 500 }, []);
  const [f, setF] = useState({ pet_id: props.pet_id || '', date_administered: new Date().toISOString().slice(0, 10), product: '' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const m = useMutation('dewormings.create', { successMsg: 'Deworming recorded', onSuccess: () => { refreshAll(); close(); } });
  const submit = (e) => { e.preventDefault(); m.run(f).catch(() => {}); };
  const petOpts = [['', '— Select pet —'], ...asList(pets.data).map(p => [p.id, `${p.name} · ${p.owner || ''}`])];
  const petLoading = !props.pet_id && pets.loading && !pets.data;
  return html`<${Modal} title="Record deworming" onClose=${close}
    footer=${html`<button class="btn gho" onClick=${close}>Cancel</button><${SaveButton} busy=${m.busy} disabled=${petLoading} label="Record" icon="drop" onClick=${submit}/>`}>
    <form onSubmit=${submit}>
      ${!props.pet_id && html`<${Field} label="Pet"><${Select} value=${f.pet_id} onInput=${set('pet_id')} options=${petOpts} loading=${petLoading}/><//>`}
      <div class="formgrid">
        <${Field} label="Date administered"><${Input} type="date" value=${f.date_administered} onInput=${set('date_administered')}/><//>
        <${Field} label="Product (optional)"><${Input} value=${f.product} onInput=${set('product')}/><//>
      </div>
      <p class="alsub">Next due in 3 months (pets older than 6 months).</p>
      <button type="submit" style="display:none"></button>
    </form>
  <//>`;
}

/* ---------- Weight ---------- */
export function WeightForm({ props, close }) {
  const [v, setV] = useState('');
  const m = useMutation('petWeights.add', { successMsg: 'Weight recorded', onSuccess: () => { refreshAll(); close(); } });
  const submit = (e) => { e.preventDefault(); m.run({ pet_id: props.pet_id, weight_kg: v }).catch(() => {}); };
  return html`<${Modal} title="Record weight" onClose=${close}
    footer=${html`<button class="btn gho" onClick=${close}>Cancel</button><${SaveButton} busy=${m.busy} label="Record" icon="scale" onClick=${submit}/>`}>
    <form onSubmit=${submit}><${Field} label="Weight today (kg)"><${Input} type="number" value=${v} onInput=${setV} autofocus=${true}/><//><button type="submit" style="display:none"></button></form>
  <//>`;
}

/* ---------- User (admin) — shows generated password ONCE ---------- */
export function UserForm({ props, close }) {
  const [f, setF] = useState({ identifier: '', identifier_type: 'email', display_name: '', role: 'manager' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const [created, setCreated] = useState(null);
  const m = useMutation('users.create', { successMsg: 'User created', onSuccess: (d) => { setCreated(d); refreshAll(); } });
  const submit = (e) => { e.preventDefault(); m.run(f).catch(() => {}); };
  if (created) return html`<${Modal} title="User created" onClose=${close} footer=${html`<button class="btn pri" onClick=${close}>Done</button>`}>
    <p class="mut" style="margin-top:0">Share this one-time password securely with <b>${created.identifier}</b>. It won't be shown again.</p>
    <div class="copybox"><span>${created.password}</span><button class="iconbtn" onClick=${() => copyText(created.password)}>${Icon('copy', 17)}</button></div>
    <p class="alsub" style="margin-top:10px">They'll be asked to set their own password on first sign-in.</p>
  <//>`;
  return html`<${Modal} title="Add user" onClose=${close}
    footer=${html`<button class="btn gho" onClick=${close}>Cancel</button><${SaveButton} busy=${m.busy} label="Create user" icon="users" onClick=${submit}/>`}>
    <form onSubmit=${submit}>
      <${Field} label="Display name" error=${ferr(m.fieldErrors, 'display_name')}><${Input} value=${f.display_name} onInput=${set('display_name')} autofocus=${true}/><//>
      <div class="formgrid">
        <${Field} label="Identifier type"><${Select} value=${f.identifier_type} onInput=${set('identifier_type')} options=${[['email', 'Email'], ['mobile', 'Mobile']]}/><//>
        <${Field} label="Role"><${Select} value=${f.role} onInput=${set('role')} options=${[['manager', 'Manager'], ['administrator', 'Administrator']]}/><//>
      </div>
      <${Field} label=${f.identifier_type === 'email' ? 'Email' : 'Mobile'} error=${ferr(m.fieldErrors, 'identifier') && 'Already in use or invalid.'}><${Input} value=${f.identifier} onInput=${set('identifier')}/><//>
      <button type="submit" style="display:none"></button>
    </form>
  <//>`;
}

/* ---------- Document upload (base64 → Drive) ---------- */
const MAX_UPLOAD_MB = 10;
const fmtSize = (b) => b < 1024 * 1024 ? (b / 1024).toFixed(0) + ' KB' : (b / 1024 / 1024).toFixed(1) + ' MB';
export function DocumentForm({ props, close }) {
  const [f, setF] = useState({ doc_type: 'Lab Report', title: '', file: null });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const m = useMutation('documents.upload', { successMsg: 'Document uploaded', onSuccess: () => { refreshAll(); close(); } });
  function onFile(e) {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) { // F10: reject upfront, not after a 30s round trip
      toast(`That file is ${fmtSize(file.size)} — the limit is ${MAX_UPLOAD_MB} MB. Compress or split it first.`, 'err');
      e.target.value = ''; return;
    }
    const r = new FileReader();
    r.onload = () => set('file')({ name: file.name, mime: file.type, b64: String(r.result).split(',')[1], size: file.size });
    r.readAsDataURL(file); if (!f.title) set('title')(file.name);
  }
  function submit(e) { e.preventDefault(); if (!f.file) return toast('Choose a file first', 'err'); m.run({ pet_id: props.pet_id, consultation_id: props.consultation_id || '', doc_type: f.doc_type, title: f.title, file_name: f.file.name, mime_type: f.file.mime, file_base64: f.file.b64 }).catch(() => {}); }
  return html`<${Modal} title="Upload document" onClose=${close}
    footer=${html`<button class="btn gho" onClick=${close} disabled=${m.busy}>Cancel</button><${SaveButton} busy=${m.busy} disabled=${!f.file} label="Upload" icon="file" onClick=${submit}/>`}>
    <form onSubmit=${submit}>
      <${Field} label="Type"><${Select} value=${f.doc_type} onInput=${set('doc_type')} options=${['Scanned Prescription', 'Lab Report', 'X-Ray', 'Diagnostic Report', 'Other']}/><//>
      <${Field} label="Title"><${Input} value=${f.title} onInput=${set('title')}/><//>
      <${Field} label="File" hint=${`Images or PDF, up to ${MAX_UPLOAD_MB} MB`}><input class="inp" type="file" onChange=${onFile} accept="image/*,.pdf" disabled=${m.busy}/><//>
      ${f.file && !m.busy && html`<div class="alsub">${f.file.name} · ${fmtSize(f.file.size)}</div>`}
      ${m.busy && html`<${FauxProgress} messages=${['Uploading ' + (f.file ? fmtSize(f.file.size) : 'file'), 'Still uploading', 'Large files take longer over the link — keep this open']}/>`}
      <button type="submit" style="display:none"></button>
    </form>
  <//>`;
}

/* ---------- registry + host ---------- */
const REGISTRY = { client: ClientForm, pet: PetForm, supplier: SupplierForm, medicine: MedicineForm, appointment: AppointmentForm, vaccination: VaccinationForm, deworming: DewormingForm, weight: WeightForm, user: UserForm, document: DocumentForm };
export function FormHost() {
  const [open, setOpen] = useState(null);
  useEvent('kiv-form', (d) => setOpen(d), []);
  if (!open) return null;
  const Cmp = REGISTRY[open.entity];
  if (!Cmp) return null;
  return html`<${Cmp} props=${open.props || {}} close=${() => setOpen(null)}/>`;
}
