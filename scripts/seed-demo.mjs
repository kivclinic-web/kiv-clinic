/**
 * seed-demo.mjs — bootstraps the first admin, verifies the full API, and seeds a small demo dataset
 * so the Today dashboard renders richly. Run: `node scripts/seed-demo.mjs`
 * Idempotent-ish: safe to re-run (existing rows are reused where possible).
 *
 * NOTE: writes demo data to the PRODUCTION spreadsheet. A matching purge script can soft-delete it.
 */

// Secrets come from the environment (never hardcode — this file is public). See CREDENTIALS.local.md.
//   KIV_API_URL, KIV_BOOTSTRAP_TOKEN, KIV_ADMIN_PASSWORD  (KIV_ADMIN_EMAIL optional)
const API = process.env.KIV_API_URL || '';
const BOOTSTRAP_TOKEN = process.env.KIV_BOOTSTRAP_TOKEN || '';
const ADMIN = { identifier: process.env.KIV_ADMIN_EMAIL || 'admin@kivclinic.in', identifier_type: 'email', display_name: 'KIV Clinic Admin' };
const FINAL_PASSWORD = process.env.KIV_ADMIN_PASSWORD || '';
if (!API || !FINAL_PASSWORD) { console.error('Set KIV_API_URL and KIV_ADMIN_PASSWORD (and KIV_BOOTSTRAP_TOKEN for first run) in the environment.'); process.exit(1); }

const uuid = () => crypto.randomUUID();
let TOKEN = null;

async function api(action, payload = {}, { mutating = false } = {}) {
  const body = JSON.stringify({ action, token: TOKEN, requestId: mutating ? uuid() : undefined, payload });
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${action}: non-JSON response: ${text.slice(0, 200)}`); }
  return json;
}
async function must(action, payload, opts) {
  const r = await api(action, payload, opts);
  if (!r.ok) throw new Error(`${action} failed: ${JSON.stringify(r.error)}`);
  return r.data;
}

async function ensureAdminAndLogin() {
  // Try logging in with the final password (re-run case).
  let r = await api('auth.login', { identifier: ADMIN.identifier, identifier_type: 'email', password: FINAL_PASSWORD });
  if (r.ok) { TOKEN = r.data.token; console.log('• logged in (existing admin)'); return; }

  // Bootstrap the first admin → temp password.
  const boot = await api('auth.bootstrapAdmin', { bootstrap_token: BOOTSTRAP_TOKEN, ...ADMIN });
  if (!boot.ok && boot.error.code !== 'CONFLICT') throw new Error('bootstrap failed: ' + JSON.stringify(boot.error));
  if (boot.ok) {
    const temp = boot.data.password;
    const login = await must('auth.login', { identifier: ADMIN.identifier, identifier_type: 'email', password: temp });
    TOKEN = login.token;
    await must('auth.changePassword', { old: temp, new: FINAL_PASSWORD });
    const relog = await must('auth.login', { identifier: ADMIN.identifier, identifier_type: 'email', password: FINAL_PASSWORD });
    TOKEN = relog.token;
    console.log('• admin bootstrapped + password set');
  } else {
    throw new Error('Admin exists but FINAL_PASSWORD did not work — was it changed in-app? Update the script.');
  }
}

async function ensureClient(c) {
  const r = await api('clients.create', c, { mutating: true });
  if (r.ok) return r.data.id;
  if (r.error.code === 'CONFLICT') {
    const list = await must('clients.list', { search: c.mobile });
    const found = (list.items || list).find(x => String(x.mobile).includes(c.mobile.replace(/\D/g, '')));
    if (found) return found.id;
  }
  throw new Error('client seed failed: ' + JSON.stringify(r.error));
}

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const yearsAgoISO = (y, mo = 0) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); d.setMonth(d.getMonth() - mo); return d.toISOString().slice(0, 10); };

async function main() {
  console.log('Connecting to API…');
  await ensureAdminAndLogin();

  // --- suppliers ---
  console.log('Seeding suppliers…');
  const supA = await must('suppliers.create', { name: 'VetPharma Co.', contact_person: 'Anil Gupta', mobile: '9833011200' }, { mutating: true });
  const supB = await must('suppliers.create', { name: 'BioVet Labs', contact_person: 'Dr. K. Iyer', mobile: '9001177654' }, { mutating: true });

  // --- medicines (varied flags) ---
  console.log('Seeding medicines…');
  const soon = new Date(); soon.setMonth(soon.getMonth() + 3); const soonStr = soon.toISOString().slice(0, 10);   // <6mo → red
  const far = '2030-01-01';
  const meds = [];
  meds.push(await must('medicines.create', { name: 'Carprofen 75mg', batch_number: 'CPF-3120', quantity: 24, purchase_price: 11, selling_price: 20, supplier_id: supA.id, expiry_date: far }, { mutating: true }));
  meds.push(await must('medicines.create', { name: 'Amoxicillin 250mg', batch_number: 'AMX-2241', quantity: 2, purchase_price: 8, selling_price: 14, supplier_id: supA.id, expiry_date: far }, { mutating: true }));     // low stock
  meds.push(await must('medicines.create', { name: 'Meloxicam 1.5mg/ml', batch_number: 'MLX-0098', quantity: 1, purchase_price: 120, selling_price: 210, supplier_id: supB.id, expiry_date: soonStr }, { mutating: true })); // low + expiring

  // --- clients + pets ---
  console.log('Seeding clients + pets…');
  const aisha = await ensureClient({ name: 'Aisha Khan', mobile: '9820144521', address: '12 Marine Lines, Mumbai' });
  const rohan = await ensureClient({ name: 'Rohan Mehta', mobile: '9930071190', address: 'Flat 4B, Bandra West' });
  const priya = await ensureClient({ name: 'Priya Sharma', mobile: '9867730021', address: 'Andheri East, Mumbai' });

  const mochi = (await must('pets.create', { client_id: aisha, name: 'Mochi', species: 'dog', breed: 'Shiba Inu', sex: 'male', date_of_birth: yearsAgoISO(3, 2) }, { mutating: true })).id;
  const simba = (await must('pets.create', { client_id: rohan, name: 'Simba', species: 'cat', breed: 'Maine Coon', sex: 'male', date_of_birth: yearsAgoISO(2) }, { mutating: true })).id;
  const bruno = (await must('pets.create', { client_id: priya, name: 'Bruno', species: 'dog', breed: 'Labrador', sex: 'male', date_of_birth: yearsAgoISO(7) }, { mutating: true })).id;

  // --- today's appointments (varied types/status) ---
  console.log('Seeding today\'s appointments…');
  await must('appointments.create', { pet_id: mochi, type: 'OPD', scheduled_at: at(9, 0), reason: 'Skin allergy recheck' }, { mutating: true });
  await must('appointments.create', { pet_id: bruno, type: 'Grooming', scheduled_at: at(9, 30), reason: 'Full groom + nail trim' }, { mutating: true });
  await must('appointments.create', { pet_id: simba, type: 'OPD', scheduled_at: at(11, 0), reason: 'Annual vaccination + checkup' }, { mutating: true });
  await must('appointments.create', { pet_id: bruno, type: 'Surgery', scheduled_at: at(12, 0), reason: 'Neutering procedure' }, { mutating: true });

  // --- vaccinations (overdue / due-soon / upcoming) ---
  console.log('Seeding vaccinations…');
  const vtypes = await must('vaccineTypes.list', {});
  const vt = (name) => vtypes.find(v => v.name === name) || vtypes[0];
  await must('vaccinations.create', { pet_id: bruno, vaccine_type_id: vt('Anti Rabies').id, date_administered: daysAgo(400).slice(0, 10) }, { mutating: true }); // overdue
  await must('vaccinations.create', { pet_id: simba, vaccine_type_id: vt('TRICAT').id, date_administered: daysAgo(355).slice(0, 10) }, { mutating: true });     // due soon
  await must('vaccinations.create', { pet_id: mochi, vaccine_type_id: vt('DHPPIL (7-in-1)').id, date_administered: daysAgo(30).slice(0, 10) }, { mutating: true }); // upcoming

  // --- dewormings (one overdue) ---
  console.log('Seeding dewormings…');
  await must('dewormings.create', { pet_id: bruno, date_administered: daysAgo(120).slice(0, 10) }, { mutating: true }); // next_due passed → due

  // --- consultation that deducts stock (verify FEFO) ---
  console.log('Creating a consultation (verifies FEFO stock deduction)…');
  const before = (await must('medicines.list', { search: 'carprofen' })).items.find(m => m.name.startsWith('Carprofen'));
  await must('consultations.create', { pet_id: mochi, diagnosis: 'Allergic dermatitis — recheck',
    treatment: 'Continue antihistamine; medicated bath weekly.', follow_up_interval: '5d',
    medicines: [{ medicine_id: before.id, quantity: 7, dosage: '1 tab/day' }] }, { mutating: true });
  const after = (await must('medicines.list', { search: 'carprofen' })).items.find(m => m.name.startsWith('Carprofen'));
  console.log(`  Carprofen stock ${before.quantity} → ${after.quantity} (expected -7)`);

  // --- summary ---
  const kpis = await must('dashboard.kpis', {});
  console.log('\n=== DASHBOARD KPIS (live) ===');
  console.log(JSON.stringify(kpis, null, 2));
  console.log('\n=== ADMIN LOGIN ===');
  console.log('  identifier:', ADMIN.identifier, '(email)');
  console.log('  password  :', FINAL_PASSWORD);
  console.log('\nDone.');
}

main().catch(e => { console.error('SEED FAILED:', e.message); process.exit(1); });
