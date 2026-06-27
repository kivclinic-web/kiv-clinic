/**
 * Domain_Vaccinations.js — vaccinations (auto due date) + dewormings (q3m for pets >6 months).
 * See docs/PRD.md §6, §9.
 */

// ---------- vaccinations ----------
function vaccinationsCreate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['pet_id', 'vaccine_type_id', 'date_administered']);
  var pet = findById_('pets', p.pet_id);
  if (!pet) throw new ApiError(ERROR_CODES.FK_VIOLATION, 'Pet not found', { pet_id: 'invalid' });
  var vt = findById_('vaccine_types', p.vaccine_type_id);
  if (!vt) throw new ApiError(ERROR_CODES.FK_VIOLATION, 'Vaccine type not found', { vaccine_type_id: 'invalid' });
  var administered = v_date_(p.date_administered, true);
  var due = new Date(administered.getTime());
  due.setDate(due.getDate() + Number(vt.default_interval_days || 365));
  var rec = insert_('vaccinations', {
    pet_id: pet.id, vaccine_type_id: vt.id, vaccine_name: vt.name,
    date_administered: administered.toISOString(), due_date: due.toISOString(),
    batch_number: v_string_(p.batch_number, 80), administered_by: actor.sub, notes: v_string_(p.notes, 500)
  }, actor);
  writeAudit_('vaccination.create', 'vaccinations', rec.id, { vaccine: vt.name }, actor);
  return ok_(publicVaccination_(rec));
}

function vaccinationsByPet_(req) {
  requireAuth_(req);
  return ok_(findBy_('vaccinations', 'pet_id', req.payload.pet_id)
    .sort(byDateDesc_('date_administered')).map(publicVaccination_));
}

function vaccinationsDelete_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  softDelete_('vaccinations', req.payload.id, actor);
  writeAudit_('vaccination.delete', 'vaccinations', req.payload.id, null, actor);
  return ok_({ deleted: true });
}

/** Latest due_date per pet+vaccine; "due" within `days` (default 30), "overdue" if past. */
function vaccinationStatusList_(req, overdueOnly) {
  requireAuth_(req);
  var days = (req.payload && req.payload.days) || 30;
  var horizon = new Date().getTime() + days * 86400000;
  var now = new Date().getTime();
  // Keep only the latest record per (pet, vaccine_type) to compute current due state.
  var latest = {};
  readAll_('vaccinations').forEach(function (vac) {
    var key = vac.pet_id + '|' + vac.vaccine_type_id;
    if (!latest[key] || new Date(vac.date_administered) > new Date(latest[key].date_administered)) latest[key] = vac;
  });
  var out = [];
  Object.keys(latest).forEach(function (k) {
    var vac = latest[k];
    var dueT = new Date(vac.due_date).getTime();
    var isOverdue = dueT < now;
    var isDueSoon = dueT >= now && dueT <= horizon;
    if (overdueOnly ? isOverdue : (isOverdue || isDueSoon)) {
      var pet = findById_('pets', vac.pet_id);
      out.push({ pet_id: vac.pet_id, pet_name: pet ? pet.name : null, vaccine_name: vac.vaccine_name,
        due_date: vac.due_date, overdue: isOverdue });
    }
  });
  out.sort(function (a, b) { return new Date(a.due_date) - new Date(b.due_date); });
  return ok_(out);
}

function vaccinationsDueList_(req) { return vaccinationStatusList_(req, false); }
function vaccinationsOverdueList_(req) { return vaccinationStatusList_(req, true); }

function vaccineTypesList_(req) {
  requireAuth_(req);
  return ok_(readAll_('vaccine_types').filter(function (v) { return v_bool_(v.is_active) !== false; }));
}

function publicVaccination_(v) {
  return { id: v.id, pet_id: v.pet_id, vaccine_type_id: v.vaccine_type_id, vaccine_name: v.vaccine_name,
    date_administered: v.date_administered, due_date: v.due_date, batch_number: v.batch_number, notes: v.notes };
}

// ---------- dewormings ----------
function dewormingsCreate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['pet_id', 'date_administered']);
  if (!findById_('pets', p.pet_id)) throw new ApiError(ERROR_CODES.FK_VIOLATION, 'Pet not found', { pet_id: 'invalid' });
  var administered = v_date_(p.date_administered, true);
  var due = new Date(administered.getTime());
  due.setMonth(due.getMonth() + CONFIG.DEWORM_INTERVAL_MONTHS);
  var rec = insert_('dewormings', { pet_id: p.pet_id, date_administered: administered.toISOString(),
    next_due: due.toISOString(), product: v_string_(p.product, 120), administered_by: actor.sub }, actor);
  writeAudit_('deworming.create', 'dewormings', rec.id, null, actor);
  return ok_(rec);
}

function dewormingsByPet_(req) {
  requireAuth_(req);
  return ok_(findBy_('dewormings', 'pet_id', req.payload.pet_id).sort(byDateDesc_('date_administered')));
}

/** Deworming due if pet older than 6 months and (no record OR last next_due passed). */
function dewormingDueForPet_(pet) {
  var months = ageMonths_(pet.date_of_birth);
  if (months === null || months < CONFIG.DEWORM_MIN_AGE_MONTHS) return { due: false, reason: 'under_age_or_unknown_dob' };
  var records = findBy_('dewormings', 'pet_id', pet.id).sort(byDateDesc_('date_administered'));
  if (!records.length) return { due: true, reason: 'never_dewormed' };
  var nextDue = new Date(records[0].next_due).getTime();
  return { due: nextDue <= new Date().getTime(), next_due: records[0].next_due };
}

function dewormingsDueList_(req) {
  requireAuth_(req);
  var out = [];
  readAll_('pets').forEach(function (pet) {
    var d = dewormingDueForPet_(pet);
    if (d.due) out.push({ pet_id: pet.id, pet_name: pet.name, reason: d.reason || 'due', next_due: d.next_due || null });
  });
  return ok_(out);
}
