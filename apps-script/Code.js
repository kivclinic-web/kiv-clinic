/**
 * Code.js — Web App entry points and the action router.
 * GET = health check only. POST = JSON envelope (see docs/API-CONTRACT.md).
 * Mutating actions with a requestId are idempotent (cached briefly), so client retries never double-apply.
 */

var ROUTES = {
  // auth
  'auth.bootstrapAdmin': { fn: bootstrapAdmin_, mutating: true, idempotent: false },
  'auth.login':          { fn: login_,          mutating: false },
  'auth.logout':         { fn: logout_,         mutating: false },
  'auth.changePassword': { fn: changePassword_, mutating: false },
  // users (admin)
  'users.create':        { fn: createUser_,     mutating: true, idempotent: false },
  'users.list':          { fn: listUsers_,      mutating: false },
  'users.update':        { fn: updateUser_,     mutating: true },
  // clients
  'clients.create':      { fn: clientsCreate_,  mutating: true },
  'clients.update':      { fn: clientsUpdate_,  mutating: true },
  'clients.list':        { fn: clientsList_,    mutating: false },
  'clients.get':         { fn: clientsGet_,     mutating: false },
  'clients.delete':      { fn: clientsDelete_,  mutating: true },
  // pets
  'pets.create':         { fn: petsCreate_,     mutating: true },
  'pets.update':         { fn: petsUpdate_,     mutating: true },
  'pets.byClient':       { fn: petsByClient_,   mutating: false },
  'pets.list':           { fn: petsList_,       mutating: false },
  'pets.get':            { fn: petsGet_,        mutating: false },
  'pets.delete':         { fn: petsDelete_,     mutating: true },
  // weights
  'petWeights.add':      { fn: petWeightsAdd_,  mutating: true },
  'petWeights.list':     { fn: petWeightsList_, mutating: false },
  // appointments
  'appointments.create':         { fn: appointmentsCreate_,     mutating: true },
  'appointments.update':         { fn: appointmentsUpdate_,     mutating: true },
  'appointments.reschedule':     { fn: appointmentsReschedule_, mutating: true },
  'appointments.cancel':         { fn: appointmentsCancel_,     mutating: true },
  'appointments.delete':         { fn: appointmentsDelete_,     mutating: true },
  'appointments.list':           { fn: appointmentsList_,       mutating: false },
  'appointments.today':          { fn: appointmentsToday_,      mutating: false },
  'appointments.followupsToday': { fn: followupsToday_,         mutating: false },
  // consultations
  'consultations.create': { fn: consultationsCreate_, mutating: true },
  'consultations.byPet':  { fn: consultationsByPet_,  mutating: false },
  'consultations.get':    { fn: consultationsGet_,    mutating: false },
  'consultations.delete': { fn: consultationsDelete_, mutating: true },
  // vaccinations & dewormings
  'vaccinations.create':      { fn: vaccinationsCreate_,      mutating: true },
  'vaccinations.byPet':       { fn: vaccinationsByPet_,       mutating: false },
  'vaccinations.dueList':     { fn: vaccinationsDueList_,     mutating: false },
  'vaccinations.overdueList': { fn: vaccinationsOverdueList_, mutating: false },
  'vaccinations.delete':      { fn: vaccinationsDelete_,      mutating: true },
  'vaccineTypes.list':        { fn: vaccineTypesList_,        mutating: false },
  'dewormings.create':        { fn: dewormingsCreate_,        mutating: true },
  'dewormings.byPet':         { fn: dewormingsByPet_,         mutating: false },
  'dewormings.dueList':       { fn: dewormingsDueList_,       mutating: false },
  // inventory
  'medicines.create':       { fn: medicinesCreate_,   mutating: true },
  'medicines.update':       { fn: medicinesUpdate_,   mutating: true },
  'medicines.list':         { fn: medicinesList_,     mutating: false },
  'medicines.delete':       { fn: medicinesDelete_,   mutating: true },
  'medicines.lowStock':     { fn: medicinesLowStock_, mutating: false },
  'medicines.expiring':     { fn: medicinesExpiring_, mutating: false },
  'medicines.inventoryValue': { fn: inventoryValue_,  mutating: false },
  'suppliers.create':       { fn: suppliersCreate_,   mutating: true },
  'suppliers.update':       { fn: suppliersUpdate_,   mutating: true },
  'suppliers.list':         { fn: suppliersList_,     mutating: false },
  'suppliers.delete':       { fn: suppliersDelete_,   mutating: true },
  // documents
  'documents.upload':         { fn: uploadDocument_,          mutating: true, idempotent: false },
  'documents.byPet':          { fn: documentsByPet_,          mutating: false },
  'documents.byConsultation': { fn: documentsByConsultation_, mutating: false },
  'documents.delete':         { fn: deleteDocument_,          mutating: true },
  'storage.usage':            { fn: storageUsage_,            mutating: false },
  // dashboard / reports / reminders / settings
  'dashboard.kpis':    { fn: dashboardKpis_,    mutating: false },
  'dashboard.widgets': { fn: dashboardWidgets_, mutating: false },
  'reports.daily':     { fn: reportsDaily_,     mutating: false },
  'reminders.all':     { fn: remindersAll_,     mutating: false },
  'settings.get':      { fn: settingsGet_,      mutating: false },
  'settings.update':   { fn: settingsUpdate_,   mutating: true }
};

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'ping' || !action) {
    return jsonOut_(ok_({ pong: true, service: 'kiv-clinic-api' }));
  }
  return jsonOut_(err_(ERROR_CODES.NOT_IMPLEMENTED, 'Use POST for ' + action));
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (parseErr) {
    return jsonOut_(err_(ERROR_CODES.VALIDATION_ERROR, 'Malformed JSON body'));
  }
  return jsonOut_(route_(req));
}

/** Core router: idempotency + dispatch + uniform error handling. */
function route_(req) {
  var action = req && req.action;
  var route = ROUTES[action];
  if (!route) return err_(ERROR_CODES.NOT_IMPLEMENTED, 'Unknown action: ' + action);

  var useIdemp = route.mutating && route.idempotent !== false && req.requestId;
  var cacheKey = useIdemp ? ('idemp:' + action + ':' + req.requestId) : null;
  if (cacheKey) {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  }

  try {
    var result = route.fn(req);
    if (result && result.ok === undefined) result = ok_(result); // tolerate handlers returning raw data
    if (cacheKey && result.ok) CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 600);
    return result;
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === ERROR_CODES.INTERNAL) console.error('api_internal', action, e.message);
      return err_(e.code, e.message, e.fields);
    }
    console.error('unhandled', action, e && e.stack ? e.stack : e);
    return err_(ERROR_CODES.INTERNAL, 'Unexpected server error');
  }
}
