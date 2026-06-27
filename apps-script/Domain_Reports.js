/**
 * Domain_Reports.js — dashboard KPIs/widgets, daily report, reminders, clinic settings.
 * All metrics are DERIVED (no stored aggregates). See docs/PRD.md §4, §11, §12.
 */

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
