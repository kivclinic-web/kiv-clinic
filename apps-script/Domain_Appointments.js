/**
 * Domain_Appointments.js — appointments + automatic follow-ups. See docs/PRD.md §7.
 * Active schedule = rolling last 7 days (older is archived/derived). Follow-up interval ∈ {5d,1w}.
 */

function appointmentsCreate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['pet_id', 'type', 'scheduled_at']);
  v_enum_(p.type, 'appointment_type');
  var pet = findById_('pets', p.pet_id);
  if (!pet) throw new ApiError(ERROR_CODES.FK_VIOLATION, 'Pet not found', { pet_id: 'invalid' });
  var rec = insert_('appointments', {
    pet_id: pet.id, client_id: pet.client_id, type: p.type, status: 'scheduled',
    scheduled_at: v_date_(p.scheduled_at, true).toISOString(), reason: v_string_(p.reason, 300),
    is_followup: false, followup_of: '', followup_interval: '', rescheduled_from: ''
  }, actor);
  writeAudit_('appointment.create', 'appointments', rec.id, { type: p.type }, actor);
  return ok_(publicAppt_(rec));
}

function appointmentsUpdate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['id']);
  var patch = {};
  if (p.type !== undefined) patch.type = v_enum_(p.type, 'appointment_type');
  if (p.reason !== undefined) patch.reason = v_string_(p.reason, 300);
  if (p.scheduled_at !== undefined) patch.scheduled_at = v_date_(p.scheduled_at, true).toISOString();
  if (p.status !== undefined) patch.status = v_enum_(p.status, 'appointment_status');
  var rec = update_('appointments', p.id, patch, actor);
  writeAudit_('appointment.update', 'appointments', p.id, patch, actor);
  return ok_(publicAppt_(rec));
}

function appointmentsReschedule_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['id', 'scheduled_at']);
  var prev = findById_('appointments', p.id);
  if (!prev) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Appointment not found');
  var rec = update_('appointments', p.id, { scheduled_at: v_date_(p.scheduled_at, true).toISOString(),
    status: 'rescheduled' }, actor);
  writeAudit_('appointment.reschedule', 'appointments', p.id, { from: prev.scheduled_at, to: rec.scheduled_at }, actor);
  return ok_(publicAppt_(rec));
}

function appointmentsCancel_(req) {
  var actor = requireAuth_(req);
  var rec = update_('appointments', req.payload.id, { status: 'cancelled' }, actor);
  writeAudit_('appointment.cancel', 'appointments', req.payload.id, null, actor);
  return ok_(publicAppt_(rec));
}

function appointmentsDelete_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  softDelete_('appointments', req.payload.id, actor);
  writeAudit_('appointment.delete', 'appointments', req.payload.id, null, actor);
  return ok_({ deleted: true });
}

/** Active schedule = scheduled_at within the last ACTIVE_APPT_WINDOW_DAYS or in the future. */
function appointmentsList_(req) {
  requireAuth_(req);
  var p = req.payload || {};
  var cutoff = new Date().getTime() - CONFIG.ACTIVE_APPT_WINDOW_DAYS * 86400000;
  var rows = readAll_('appointments').filter(function (a) {
    var t = new Date(a.scheduled_at).getTime();
    var inWindow = t >= cutoff;
    return p.archived ? !inWindow : inWindow;
  });
  if (p.type) rows = rows.filter(function (a) { return a.type === p.type; });
  if (p.status) rows = rows.filter(function (a) { return a.status === p.status; });
  rows.sort(function (a, b) { return new Date(a.scheduled_at) - new Date(b.scheduled_at); });
  var page = paginate_(rows, p);
  return ok_(page.items.map(enrichAppt_), { total: page.total, limit: page.limit, offset: page.offset });
}

function appointmentsToday_(req) {
  requireAuth_(req);
  return ok_(todaysAppointments_().map(enrichAppt_));
}

function followupsToday_(req) {
  requireAuth_(req);
  var rows = todaysAppointments_().filter(function (a) { return a.type === 'FollowUp' || v_bool_(a.is_followup); });
  return ok_(rows.map(enrichAppt_));
}

// ---------- helpers ----------
function todaysAppointments_() {
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var end = new Date(); end.setHours(23, 59, 59, 999);
  return readAll_('appointments').filter(function (a) {
    var t = new Date(a.scheduled_at).getTime();
    return t >= start.getTime() && t <= end.getTime() && a.status !== 'cancelled';
  });
}

/** Create an automatic follow-up appointment from a consultation. interval ∈ {'5d','1w'}. */
function createFollowupAppointment_(consultation, interval, actor) {
  var days = CONFIG.FOLLOWUP_INTERVALS[interval];
  if (!days) return null;
  var when = new Date(); when.setDate(when.getDate() + days);
  var rec = insert_('appointments', {
    pet_id: consultation.pet_id, client_id: consultation.client_id, type: 'FollowUp', status: 'scheduled',
    scheduled_at: when.toISOString(), reason: 'Auto follow-up', is_followup: true,
    followup_of: consultation.id, followup_interval: interval, rescheduled_from: ''
  }, actor);
  writeAudit_('appointment.followup_auto', 'appointments', rec.id, { consultation_id: consultation.id, interval: interval }, actor);
  return rec;
}

function publicAppt_(a) {
  return { id: a.id, pet_id: a.pet_id, client_id: a.client_id, type: a.type, status: a.status,
    scheduled_at: a.scheduled_at, reason: a.reason, is_followup: v_bool_(a.is_followup),
    followup_of: a.followup_of, followup_interval: a.followup_interval };
}

function enrichAppt_(a) {
  var pet = findById_('pets', a.pet_id);
  var client = a.client_id ? findById_('clients', a.client_id) : null;
  var o = publicAppt_(a);
  o.pet_name = pet ? pet.name : null;
  o.client_name = client ? client.name : null;
  o.client_mobile = client ? client.mobile : null;
  return o;
}
