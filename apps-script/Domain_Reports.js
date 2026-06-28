/**
 * Domain_Reports.js — dashboard KPIs/widgets, daily report, reminders, clinic settings.
 * All metrics are DERIVED (no stored aggregates). See docs/PRD.md §4, §11, §12.
 */

/**
 * dashboardSummary_ (P2+P3) — the Today screen in ONE request. Reads each needed table exactly
 * once, builds in-memory lookup maps, and derives kpis + widgets + reminders together. Replaces the
 * old 3-endpoint fan-out (dashboard.kpis + dashboard.widgets + reminders.all), each of which
 * independently re-read the same tables and did per-row findById_ lookups (N+1). The legacy
 * endpoints below are kept for compatibility.
 */
function dashboardSummary_(req) {
  requireAuth_(req);
  var now = new Date().getTime();
  var startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  var endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);

  // --- single read per table (memoized by P1, but we read explicitly to be obvious) ---
  var appts = readAll_('appointments');
  var pets = readAll_('pets');
  var clients = readAll_('clients');
  var vaccinations = readAll_('vaccinations');
  var medicines = readAll_('medicines');
  var dewormings = readAll_('dewormings');

  // --- lookup maps (replace the per-row findById_ N+1) ---
  var petsById = {}; pets.forEach(function (p) { petsById[p.id] = p; });
  var clientsById = {}; clients.forEach(function (c) { clientsById[c.id] = c; });
  var dewormByPet = {}; dewormings.forEach(function (d) { (dewormByPet[d.pet_id] = dewormByPet[d.pet_id] || []).push(d); });

  function enrich(a) {
    var pet = petsById[a.pet_id];
    var client = a.client_id ? clientsById[a.client_id] : null;
    var o = publicAppt_(a);
    o.pet_name = pet ? pet.name : null;
    o.client_name = client ? client.name : null;
    o.client_mobile = client ? client.mobile : null;
    return o;
  }

  // --- today's appointments ---
  var today = appts.filter(function (a) {
    var t = new Date(a.scheduled_at).getTime();
    return t >= startOfDay.getTime() && t <= endOfDay.getTime() && a.status !== 'cancelled';
  });
  var todayEnriched = today.map(enrich);
  var completed = today.filter(function (a) { return a.status === 'completed'; }).length;
  var pending = today.filter(function (a) { return a.status === 'scheduled' || a.status === 'rescheduled'; }).length;
  var followToday = today.filter(function (a) { return a.type === 'FollowUp' || v_bool_(a.is_followup); });

  // --- vaccination due/overdue: latest record per (pet, vaccine_type) ---
  var latest = {};
  vaccinations.forEach(function (vac) {
    var k = vac.pet_id + '|' + vac.vaccine_type_id;
    if (!latest[k] || new Date(vac.date_administered) > new Date(latest[k].date_administered)) latest[k] = vac;
  });
  var horizon = now + 30 * 86400000;
  var vaccDue = [], vaccOverdue = [];
  Object.keys(latest).forEach(function (k) {
    var vac = latest[k];
    var dueT = new Date(vac.due_date).getTime();
    var isOverdue = dueT < now;
    var isDueSoon = dueT >= now && dueT <= horizon;
    if (isOverdue || isDueSoon) {
      var pet = petsById[vac.pet_id];
      var item = { pet_id: vac.pet_id, pet_name: pet ? pet.name : null, vaccine_name: vac.vaccine_name,
        due_date: vac.due_date, overdue: isOverdue };
      vaccDue.push(item);
      if (isOverdue) vaccOverdue.push(item);
    }
  });
  var byDue = function (a, b) { return new Date(a.due_date) - new Date(b.due_date); };
  vaccDue.sort(byDue); vaccOverdue.sort(byDue);

  // --- dewormings due (pets > 6 months, never dewormed or next_due passed) ---
  var dewormDue = [];
  pets.forEach(function (pet) {
    var months = ageMonths_(pet.date_of_birth);
    if (months === null || months < CONFIG.DEWORM_MIN_AGE_MONTHS) return;
    var recs = (dewormByPet[pet.id] || []).slice().sort(byDateDesc_('date_administered'));
    if (!recs.length) { dewormDue.push({ pet_id: pet.id, pet_name: pet.name, reason: 'never_dewormed', next_due: null }); return; }
    if (new Date(recs[0].next_due).getTime() <= now) {
      dewormDue.push({ pet_id: pet.id, pet_name: pet.name, reason: 'due', next_due: recs[0].next_due });
    }
  });

  // --- medicine flags + inventory value in one pass ---
  var lowStock = [], expiring = [], invValue = 0;
  medicines.forEach(function (m) {
    var pm = publicMedicine_(m);
    invValue += pm.quantity * pm.purchase_price;
    if (pm.stock_flag === 'yellow') lowStock.push(pm);
    if (pm.expiry_flag === 'red') expiring.push(pm);
  });
  invValue = Math.round(invValue * 100) / 100;

  return ok_({
    kpis: {
      todays_appointments: today.length, completed_appointments: completed, pending_appointments: pending,
      followups_today: followToday.length, vaccinations_due: vaccDue.length, overdue_vaccinations: vaccOverdue.length,
      low_stock_medicines: lowStock.length, expiring_medicines: expiring.length, current_inventory_value: invValue
    },
    widgets: {
      todays_appointments: todayEnriched,
      upcoming_followups: followToday.map(enrich),
      vaccination_due: vaccDue,
      inventory_alerts: lowStock,
      expiry_alerts: expiring
    },
    reminders: {
      appointments_today: todayEnriched,
      followups: followToday.map(enrich),
      vaccinations_due: vaccDue,
      vaccinations_overdue: vaccOverdue,
      dewormings_due: dewormDue
    }
  });
}

function dashboardKpis_(req) {
  requireAuth_(req);
  var today = todaysAppointments_();
  var completed = today.filter(function (a) { return a.status === 'completed'; }).length;
  var pending = today.filter(function (a) { return a.status === 'scheduled' || a.status === 'rescheduled'; }).length;
  var followToday = today.filter(function (a) { return a.type === 'FollowUp' || v_bool_(a.is_followup); }).length;
  var vaccDue = unwrap_(vaccinationsDueList_(req)).length;
  var vaccOverdue = unwrap_(vaccinationsOverdueList_(req)).length;
  var low = unwrap_(medicinesLowStock_(req)).length;
  var expiring = unwrap_(medicinesExpiring_(req)).length;
  var value = unwrap_(inventoryValue_(req)).inventory_value;
  return ok_({
    todays_appointments: today.length, completed_appointments: completed, pending_appointments: pending,
    followups_today: followToday, vaccinations_due: vaccDue, overdue_vaccinations: vaccOverdue,
    low_stock_medicines: low, expiring_medicines: expiring, current_inventory_value: value
  });
}

function dashboardWidgets_(req) {
  requireAuth_(req);
  return ok_({
    todays_appointments: todaysAppointments_().map(enrichAppt_),
    upcoming_followups: unwrap_(followupsToday_(req)),
    vaccination_due: unwrap_(vaccinationsDueList_(req)),
    inventory_alerts: unwrap_(medicinesLowStock_(req)),
    expiry_alerts: unwrap_(medicinesExpiring_(req))
  });
}

function reportsDaily_(req) {
  requireAuth_(req);
  var today = todaysAppointments_();
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var distinctPets = {};
  today.forEach(function (a) { distinctPets[a.pet_id] = true; });
  var vaccToday = readAll_('vaccinations').filter(function (v) {
    return new Date(v.date_administered).getTime() >= start.getTime();
  }).length;
  return ok_({
    date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    total_patients: Object.keys(distinctPets).length,
    opd_cases: today.filter(function (a) { return a.type === 'OPD'; }).length,
    surgery_cases: today.filter(function (a) { return a.type === 'Surgery'; }).length,
    grooming_cases: today.filter(function (a) { return a.type === 'Grooming'; }).length,
    vaccinations_administered: vaccToday,
    followup_appointments: today.filter(function (a) { return a.type === 'FollowUp'; }).length,
    low_stock_medicines: unwrap_(medicinesLowStock_(req)).length,
    expiring_medicines: unwrap_(medicinesExpiring_(req)).length,
    inventory_value: unwrap_(inventoryValue_(req)).inventory_value
  });
}

/** Unified reminder feed (derived). WhatsApp/SMS are out of free infra → in-app first. */
function remindersAll_(req) {
  requireAuth_(req);
  return ok_({
    appointments_today: todaysAppointments_().map(enrichAppt_),
    followups: unwrap_(followupsToday_(req)),
    vaccinations_due: unwrap_(vaccinationsDueList_(req)),
    vaccinations_overdue: unwrap_(vaccinationsOverdueList_(req)),
    dewormings_due: unwrap_(dewormingsDueList_(req))
  });
}

// ---------- settings ----------
function settingsGet_(req) {
  requireAuth_(req);
  var info = clinicInfoRow_();
  if (!info) return ok_(null);
  return ok_({ id: info.id, clinic_name: info.clinic_name, address: info.address, phone: info.phone,
    email: info.email, logo_file_id: info.logo_file_id, storage_warn_pct: info.storage_warn_pct });
}

function settingsUpdate_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  var info = clinicInfoRow_();
  if (!info) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Clinic info not initialized');
  var p = req.payload || {};
  var patch = {};
  ['clinic_name', 'address', 'phone'].forEach(function (f) { if (p[f] !== undefined) patch[f] = v_string_(p[f], 300); });
  if (p.email !== undefined) patch.email = v_email_(p.email);
  if (p.logo_file_id !== undefined) patch.logo_file_id = v_string_(p.logo_file_id, 120);
  if (p.storage_warn_pct !== undefined) patch.storage_warn_pct = v_number_(p.storage_warn_pct, { integer: true, min: 1 });
  var rec = update_('clinic_info', info.id, patch, actor);
  writeAudit_('settings.update', 'clinic_info', info.id, patch, actor);
  return ok_(rec);
}

/** Unwrap a handler's ok_ envelope to its data (for composing derived metrics). */
function unwrap_(envelope) { return envelope && envelope.data; }
