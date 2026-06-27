/**
 * Tests.js — server-side test harness. Run `runAllTests()` from the Apps Script editor after `setup()`.
 * Exercises the verification flows in docs/ARCHITECTURE.md. Creates test records in the live DB
 * (safe on a fresh/dev spreadsheet). Returns a pass/fail report and logs it.
 */

function runAllTests() {
  var results = [];
  function test(name, fn) {
    try { fn(); results.push({ name: name, pass: true }); }
    catch (e) { results.push({ name: name, pass: false, error: (e && e.message) || String(e) }); }
  }
  function assert(cond, msg) { if (!cond) throw new Error('assert failed: ' + msg); }
  function call(action, token, payload, requestId) {
    return route_({ action: action, token: token, payload: payload || {}, requestId: requestId });
  }
  function must(res, ctx) { if (!res.ok) throw new Error((ctx || '') + ' -> ' + JSON.stringify(res.error)); return res.data; }

  var ctx = {};

  test('setup is idempotent', function () { var r = setup(); assert(r.tabs.clients, 'clients tab created'); });

  test('bootstrap admin + login', function () {
    var bt = prop_(CONFIG.PROP.BOOTSTRAP_ADMIN_TOKEN, true);
    var admins = readAll_('auth_users').filter(function (u) { return u.role === 'administrator'; });
    if (!admins.length) {
      var b = call('auth.bootstrapAdmin', null, { bootstrap_token: bt, identifier: 'admin@kivclinic.test',
        identifier_type: 'email', display_name: 'Test Admin' });
      ctx.adminPass = must(b, 'bootstrap').password;
      ctx.adminId = b.data.id;
      var login = must(call('auth.login', null, { identifier: 'admin@kivclinic.test', password: ctx.adminPass }), 'login');
      ctx.token = login.token;
    } else {
      // Re-bootstrap blocked; create a throwaway admin via existing? skip — require fresh DB for full auth test.
      throw new Error('admin already exists; run on a fresh spreadsheet for the full auth path');
    }
    assert(ctx.token, 'token issued');
  });

  test('client create + duplicate mobile conflict', function () {
    var c = must(call('clients.create', ctx.token, { name: 'Test Owner', mobile: '9990001111', address: 'X' }, 'req-c1'), 'client');
    ctx.clientId = c.id;
    var dup = call('clients.create', ctx.token, { name: 'Dup', mobile: '9990001111', address: 'Y' });
    assert(!dup.ok && dup.error.code === 'CONFLICT', 'duplicate mobile rejected');
  });

  test('pet create with FK', function () {
    var p = must(call('pets.create', ctx.token, { client_id: ctx.clientId, name: 'Rex', breed: 'Lab',
      sex: 'male', species: 'dog', date_of_birth: '2020-01-01' }, 'req-p1'), 'pet');
    ctx.petId = p.id;
    var bad = call('pets.create', ctx.token, { client_id: 'nope', name: 'Bad', breed: 'x', sex: 'male' });
    assert(!bad.ok && bad.error.code === 'FK_VIOLATION', 'bad client_id rejected');
  });

  test('supplier + medicine create', function () {
    var s = must(call('suppliers.create', ctx.token, { name: 'Acme Vet Supplies', mobile: '8001112222' }), 'supplier');
    ctx.supplierId = s.id;
    var m = must(call('medicines.create', ctx.token, { name: 'Amoxicillin', batch_number: 'B1', quantity: 10,
      purchase_price: 5, selling_price: 8, supplier_id: s.id, expiry_date: '2030-01-01' }, 'req-m1'), 'medicine');
    ctx.medicineId = m.id;
    assert(m.quantity === 10, 'stock 10');
  });

  test('consultation deducts stock + idempotent retry', function () {
    var payload = { pet_id: ctx.petId, diagnosis: 'Infection', treatment: 'Antibiotics',
      medicines: [{ medicine_id: ctx.medicineId, quantity: 3, dosage: '1/day' }] };
    var first = must(call('consultations.create', ctx.token, payload, 'req-consult-1'), 'consult');
    var afterFirst = findById_('medicines', ctx.medicineId);
    assert(Number(afterFirst.quantity) === 7, 'stock 10-3=7, got ' + afterFirst.quantity);
    // Same requestId → idempotent, no second deduction.
    call('consultations.create', ctx.token, payload, 'req-consult-1');
    var afterRetry = findById_('medicines', ctx.medicineId);
    assert(Number(afterRetry.quantity) === 7, 'idempotent retry kept stock at 7, got ' + afterRetry.quantity);
  });

  test('out of stock rejected', function () {
    var res = call('consultations.create', ctx.token, { pet_id: ctx.petId,
      medicines: [{ medicine_id: ctx.medicineId, quantity: 9999 }] }, 'req-consult-oos');
    assert(!res.ok && res.error.code === 'OUT_OF_STOCK', 'out of stock rejected');
    assert(Number(findById_('medicines', ctx.medicineId).quantity) === 7, 'stock unchanged after failed Rx');
  });

  test('vaccination auto due date', function () {
    var vt = readAll_('vaccine_types')[0];
    var v = must(call('vaccinations.create', ctx.token, { pet_id: ctx.petId, vaccine_type_id: vt.id,
      date_administered: '2025-01-01' }, 'req-v1'), 'vaccination');
    assert(v.due_date && new Date(v.due_date) > new Date(v.date_administered), 'due date computed');
  });

  test('document upload + admin hard delete', function () {
    var b64 = Utilities.base64Encode('hello world test document');
    var up = must(call('documents.upload', ctx.token, { pet_id: ctx.petId, doc_type: 'Lab Report',
      file_base64: b64, file_name: 'test.txt', mime_type: 'text/plain', title: 'T' }), 'upload');
    ctx.docId = up.id;
    assert(up.drive_file_id, 'drive file created');
    var del = must(call('documents.delete', ctx.token, { id: ctx.docId }), 'delete');
    assert(del.deleted, 'document deleted');
  });

  test('dashboard kpis derive', function () {
    var k = must(call('dashboard.kpis', ctx.token, {}), 'kpis');
    assert(typeof k.current_inventory_value === 'number', 'inventory value numeric');
  });

  var passed = results.filter(function (r) { return r.pass; }).length;
  var report = { passed: passed, total: results.length, results: results };
  console.log(JSON.stringify(report, null, 2));
  return report;
}
