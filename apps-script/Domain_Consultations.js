/**
 * Domain_Consultations.js — consultations, prescriptions, and atomic stock deduction. See docs/PRD.md §8.
 * Prescribing deducts inventory FEFO (earliest expiry first), never below zero. Pet history shows latest 3.
 * Idempotency is enforced at the router (requestId); availability is pre-checked so a failed line aborts all.
 */

function consultationsCreate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['pet_id']);
  var pet = findById_('pets', p.pet_id);
  if (!pet) throw new ApiError(ERROR_CODES.FK_VIOLATION, 'Pet not found', { pet_id: 'invalid' });
  var lines = Array.isArray(p.medicines) ? p.medicines : [];
  var followInterval = p.follow_up_interval ? v_enum_(p.follow_up_interval, 'followup_interval') : '';

  return withLock_(function () {
    // 1) Pre-check stock availability for ALL prescribed medicines (aggregate per medicine name).
    var demand = {};   // name_normalized -> { needed, name, batches }
    lines.forEach(function (ln) {
      var qty = v_number_(ln.quantity, { required: true, integer: true, min: 1 });
      var med = findById_('medicines', ln.medicine_id);
      if (!med) throw new ApiError(ERROR_CODES.FK_VIOLATION, 'Medicine not found: ' + ln.medicine_id, { medicine_id: 'invalid' });
      var key = med.name_normalized || String(med.name).toLowerCase();
      if (!demand[key]) demand[key] = { needed: 0, name: med.name, sampleId: med.id };
      demand[key].needed += qty;
    });
    Object.keys(demand).forEach(function (key) {
      var batches = fefoBatches_(key);
      var available = batches.reduce(function (s, b) { return s + Number(b.quantity || 0); }, 0);
      if (available < demand[key].needed) {
        throw new ApiError(ERROR_CODES.OUT_OF_STOCK, 'Insufficient stock for ' + demand[key].name +
          ' (need ' + demand[key].needed + ', have ' + available + ')', { medicine: demand[key].name });
      }
    });

    // 2) Create the consultation.
    var consult = insert_('consultations', {
      pet_id: pet.id, client_id: pet.client_id, appointment_id: p.appointment_id || '',
      consult_date: (p.consult_date ? v_date_(p.consult_date, true) : new Date()).toISOString(),
      diagnosis: v_string_(p.diagnosis, 2000), treatment: v_string_(p.treatment, 2000),
      clinical_notes: v_string_(p.clinical_notes, 4000),
      follow_up_recommendation: v_string_(p.follow_up_recommendation, 1000),
      follow_up_interval: followInterval, prescription_file_id: ''
    }, actor);

    // 3) Deduct stock FEFO, then record the line as already-deducted (F11: drops the redundant
    //    second write per line that only flipped the `deducted` flag — shorter lock hold).
    var prescribed = [];
    lines.forEach(function (ln) {
      var med = findById_('medicines', ln.medicine_id);
      var qty = Number(ln.quantity);
      deductStockFEFO_(med.name_normalized || String(med.name).toLowerCase(), qty, actor, consult.id);
      var lineRec = insert_('consultation_medicines', {
        consultation_id: consult.id, medicine_id: med.id, medicine_name: med.name, quantity: qty,
        dosage: v_string_(ln.dosage, 200), instructions: v_string_(ln.instructions, 500), deducted: true
      }, actor);
      prescribed.push({ id: lineRec.id, medicine_id: med.id, medicine_name: med.name, quantity: qty });
    });

    // 4) Auto follow-up appointment.
    var followup = followInterval ? createFollowupAppointment_(consult, followInterval, actor) : null;

    writeAudit_('consultation.create', 'consultations', consult.id,
      { medicines: prescribed.length, followup: !!followup }, actor);
    return ok_({ consultation: publicConsultation_(consult), prescribed: prescribed,
      followup: followup ? publicAppt_(followup) : null });
  });
}

/** Non-deleted, non-expired batches of a medicine (by normalized name), earliest expiry first. */
function fefoBatches_(nameNormalized) {
  var now = new Date().getTime();
  return readAll_('medicines').filter(function (m) {
    return (m.name_normalized || String(m.name).toLowerCase()) === nameNormalized &&
      Number(m.quantity || 0) > 0 &&
      (!m.expiry_date || new Date(m.expiry_date).getTime() >= now);
  }).sort(function (a, b) {
    return new Date(a.expiry_date || '2999-01-01') - new Date(b.expiry_date || '2999-01-01');
  });
}

/** Deduct qty across batches FEFO. Caller must have pre-checked availability under the same lock. */
function deductStockFEFO_(nameNormalized, qty, actor, consultId) {
  var remaining = qty;
  var batches = fefoBatches_(nameNormalized);
  for (var i = 0; i < batches.length && remaining > 0; i++) {
    var b = batches[i];
    var take = Math.min(Number(b.quantity), remaining);
    update_('medicines', b.id, { quantity: Number(b.quantity) - take }, actor);
    writeAudit_('medicine.deduct', 'medicines', b.id,
      { batch: b.batch_number, taken: take, consultation_id: consultId }, actor);
    remaining -= take;
  }
  if (remaining > 0) throw new ApiError(ERROR_CODES.OUT_OF_STOCK, 'Stock changed during deduction; retry');
}

function consultationsByPet_(req) {
  requireAuth_(req);
  var p = req.payload || {};
  var rows = findBy_('consultations', 'pet_id', p.pet_id).sort(byDateDesc_('consult_date'));
  var limit = p.all ? rows.length : CONFIG.RECENT_CONSULTATIONS;
  return ok_(rows.slice(0, limit).map(function (c) {
    var o = publicConsultation_(c);
    o.medicines = findBy_('consultation_medicines', 'consultation_id', c.id).map(function (m) {
      return { medicine_name: m.medicine_name, quantity: m.quantity, dosage: m.dosage, instructions: m.instructions };
    });
    o.documents = findBy_('medical_documents', 'consultation_id', c.id).map(publicDoc_);
    return o;
  }));
}

function consultationsGet_(req) {
  requireAuth_(req);
  var c = findById_('consultations', req.payload.id);
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Consultation not found');
  var o = publicConsultation_(c);
  o.medicines = findBy_('consultation_medicines', 'consultation_id', c.id);
  o.documents = findBy_('medical_documents', 'consultation_id', c.id).map(publicDoc_);
  return ok_(o);
}

/** Recent consultations across ALL pets (B9 — the "Consultations" section as a real list). */
function consultationsList_(req) {
  requireAuth_(req);
  var p = req.payload || {};
  var limit = Math.min(p.limit || 50, 200);
  var petsById = {}; readAll_('pets').forEach(function (pt) { petsById[pt.id] = pt; });
  var rows = readAll_('consultations').sort(byDateDesc_('consult_date')).slice(0, limit).map(function (c) {
    var o = publicConsultation_(c);
    var pet = petsById[c.pet_id];
    o.pet_name = pet ? pet.name : null;
    o.medicines = findBy_('consultation_medicines', 'consultation_id', c.id).map(function (m) {
      return { medicine_name: m.medicine_name, quantity: m.quantity, dosage: m.dosage };
    });
    return o;
  });
  return ok_(rows, { total: rows.length });
}

/** Admin void (B3): soft-delete the consultation AND re-credit the FEFO-deducted stock to its exact
 *  batches, reconstructed from the deduction audit trail. Reverses an erroneous prescription cleanly. */
function consultationsDelete_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  var id = req.payload.id;
  var consult = findById_('consultations', id);
  if (!consult) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Consultation not found');
  var recredited = 0;
  readAll_('audit_log').forEach(function (a) {
    if (a.action !== 'medicine.deduct') return;
    var d; try { d = JSON.parse(a.details || '{}'); } catch (e) { return; }
    if (d.consultation_id !== id || !d.taken) return;
    var batch = findById_('medicines', a.entity_id);
    if (!batch) return;
    update_('medicines', batch.id, { quantity: Number(batch.quantity || 0) + Number(d.taken) }, actor);
    writeAudit_('medicine.recredit', 'medicines', batch.id, { taken_back: d.taken, consultation_id: id }, actor);
    recredited++;
  });
  softDelete_('consultations', id, actor);
  writeAudit_('consultation.delete', 'consultations', id, { stock_recredited: recredited }, actor);
  return ok_({ deleted: true, stock_recredited: recredited });
}

function publicConsultation_(c) {
  return { id: c.id, pet_id: c.pet_id, client_id: c.client_id, appointment_id: c.appointment_id,
    consult_date: c.consult_date, diagnosis: c.diagnosis, treatment: c.treatment,
    clinical_notes: c.clinical_notes, follow_up_recommendation: c.follow_up_recommendation,
    follow_up_interval: c.follow_up_interval, prescription_file_id: c.prescription_file_id };
}
