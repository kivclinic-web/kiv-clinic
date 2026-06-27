/**
 * Domain_Clients.js — clients, pets, weight history. See docs/PRD.md §5–6.
 */

// ---------- clients ----------
function clientsCreate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['name', 'mobile', 'address']);
  var mobile = v_mobile_(p.mobile, true);
  return withLock_(function () {
    checkUnique_('clients', 'mobile', mobile);
    var rec = insert_('clients', { name: v_string_(p.name, 120), mobile: mobile,
      address: v_string_(p.address, 300), email: v_email_(p.email), notes: v_string_(p.notes, 500) }, actor);
    writeAudit_('client.create', 'clients', rec.id, null, actor);
    return ok_(publicClient_(rec));
  });
}

function clientsUpdate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['id']);
  return withLock_(function () {
    var patch = {};
    if (p.name !== undefined) patch.name = v_string_(p.name, 120);
    if (p.address !== undefined) patch.address = v_string_(p.address, 300);
    if (p.email !== undefined) patch.email = v_email_(p.email);
    if (p.notes !== undefined) patch.notes = v_string_(p.notes, 500);
    if (p.mobile !== undefined) {
      var mob = v_mobile_(p.mobile, true);
      checkUnique_('clients', 'mobile', mob, p.id);
      patch.mobile = mob;
    }
    var rec = update_('clients', p.id, patch, actor);
    writeAudit_('client.update', 'clients', p.id, patch, actor);
    return ok_(publicClient_(rec));
  });
}

function clientsList_(req) {
  requireAuth_(req);
  var p = req.payload || {};
  var rows = readAll_('clients');
  if (p.search) {
    var q = String(p.search).toLowerCase();
    var qDigits = normalizeMobile_(p.search);
    rows = rows.filter(function (c) {
      return String(c.name).toLowerCase().indexOf(q) !== -1 ||
        (qDigits && String(c.mobile).indexOf(qDigits) !== -1);
    });
  }
  rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  var page = paginate_(rows, p);
  return ok_(page.items.map(publicClient_), { total: page.total, limit: page.limit, offset: page.offset });
}

function clientsGet_(req) {
  requireAuth_(req);
  var client = findById_('clients', req.payload.id);
  if (!client) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Client not found');
  var pets = findBy_('pets', 'client_id', client.id).map(publicPet_);
  return ok_({ client: publicClient_(client), pets: pets });
}

function clientsDelete_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  return withLock_(function () {
    var pets = findBy_('pets', 'client_id', req.payload.id);
    if (pets.length) throw new ApiError(ERROR_CODES.CONFLICT, 'Delete or reassign the client\'s pets first');
    softDelete_('clients', req.payload.id, actor);
    writeAudit_('client.delete', 'clients', req.payload.id, null, actor);
    return ok_({ deleted: true });
  });
}

function publicClient_(c) {
  return { id: c.id, name: c.name, mobile: c.mobile, address: c.address, email: c.email,
    notes: c.notes, created_at: c.created_at };
}

// ---------- pets ----------
function petsCreate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['client_id', 'name', 'breed', 'sex']);
  checkForeignKeys_('pets', { client_id: p.client_id });
  v_enum_(p.sex, 'sex');
  if (p.species) v_enum_(p.species, 'species');
  var rec = insert_('pets', { client_id: p.client_id, name: v_string_(p.name, 120),
    species: p.species || 'other', breed: v_string_(p.breed, 120), sex: p.sex,
    date_of_birth: dateOrEmpty_(v_date_(p.date_of_birth)), age_text: v_string_(p.age_text, 60),
    color: v_string_(p.color, 60), neutered: v_bool_(p.neutered) }, actor);
  writeAudit_('pet.create', 'pets', rec.id, null, actor);
  return ok_(publicPet_(rec));
}

function petsUpdate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['id']);
  var patch = {};
  ['name', 'breed', 'color', 'age_text'].forEach(function (f) { if (p[f] !== undefined) patch[f] = v_string_(p[f], 120); });
  if (p.sex !== undefined) patch.sex = v_enum_(p.sex, 'sex');
  if (p.species !== undefined) patch.species = v_enum_(p.species, 'species');
  if (p.date_of_birth !== undefined) patch.date_of_birth = dateOrEmpty_(v_date_(p.date_of_birth));
  if (p.neutered !== undefined) patch.neutered = v_bool_(p.neutered);
  var rec = update_('pets', p.id, patch, actor);
  writeAudit_('pet.update', 'pets', p.id, patch, actor);
  return ok_(publicPet_(rec));
}

function petsByClient_(req) {
  requireAuth_(req);
  return ok_(findBy_('pets', 'client_id', req.payload.client_id).map(publicPet_));
}

/** Global pet list with search (name/breed/owner) + pagination; includes owner name. */
function petsList_(req) {
  requireAuth_(req);
  var p = req.payload || {};
  var clientsById = {};
  readAll_('clients').forEach(function (c) { clientsById[c.id] = c; });
  var rows = readAll_('pets').map(function (pet) {
    var o = publicPet_(pet);
    var owner = clientsById[pet.client_id];
    o.owner = owner ? owner.name : '';
    o.owner_mobile = owner ? owner.mobile : '';
    return o;
  });
  if (p.search) {
    var q = String(p.search).toLowerCase();
    rows = rows.filter(function (r) {
      return String(r.name).toLowerCase().indexOf(q) !== -1 ||
        String(r.breed).toLowerCase().indexOf(q) !== -1 ||
        String(r.owner).toLowerCase().indexOf(q) !== -1;
    });
  }
  rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  var page = paginate_(rows, p);
  return ok_(page.items, { total: page.total, limit: page.limit, offset: page.offset });
}

/** Full medical record: pet + weights + vaccinations + last 3 consultations + dewormings + documents. */
function petsGet_(req) {
  requireAuth_(req);
  var pet = findById_('pets', req.payload.id);
  if (!pet) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Pet not found');
  var consults = findBy_('consultations', 'pet_id', pet.id)
    .sort(function (a, b) { return new Date(b.consult_date) - new Date(a.consult_date); })
    .slice(0, CONFIG.RECENT_CONSULTATIONS);
  return ok_({
    pet: publicPet_(pet),
    client: pet.client_id ? (findById_('clients', pet.client_id) ? publicClient_(findById_('clients', pet.client_id)) : null) : null,
    weight_history: findBy_('pet_weights', 'pet_id', pet.id).sort(byDateDesc_('recorded_at')),
    vaccination_history: findBy_('vaccinations', 'pet_id', pet.id).sort(byDateDesc_('date_administered')),
    recent_consultations: consults.map(publicConsultation_),
    dewormings: findBy_('dewormings', 'pet_id', pet.id).sort(byDateDesc_('date_administered')),
    documents: findBy_('medical_documents', 'pet_id', pet.id).map(publicDoc_),
    deworming_due: dewormingDueForPet_(pet)
  });
}

function petsDelete_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  softDelete_('pets', req.payload.id, actor);
  writeAudit_('pet.delete', 'pets', req.payload.id, null, actor);
  return ok_({ deleted: true });
}

function publicPet_(p) {
  return { id: p.id, client_id: p.client_id, name: p.name, species: p.species, breed: p.breed,
    sex: p.sex, date_of_birth: p.date_of_birth, age_text: p.age_text, age_months: ageMonths_(p.date_of_birth),
    color: p.color, neutered: v_bool_(p.neutered), created_at: p.created_at };
}

// ---------- weights ----------
function petWeightsAdd_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['pet_id', 'weight_kg']);
  checkForeignKeys_('pet_weights', { pet_id: p.pet_id });
  var rec = insert_('pet_weights', { pet_id: p.pet_id, weight_kg: v_number_(p.weight_kg, { required: true, min: 0 }),
    recorded_at: new Date().toISOString(), recorded_by: actor.sub }, actor);
  writeAudit_('petWeight.add', 'pet_weights', rec.id, { pet_id: p.pet_id }, actor);
  return ok_(rec);
}

function petWeightsList_(req) {
  requireAuth_(req);
  return ok_(findBy_('pet_weights', 'pet_id', req.payload.pet_id).sort(byDateDesc_('recorded_at')));
}

// ---------- shared helpers ----------
function dateOrEmpty_(d) { return d ? d.toISOString() : ''; }
function byDateDesc_(field) { return function (a, b) { return new Date(b[field]) - new Date(a[field]); }; }

function ageMonths_(dob) {
  if (!dob) return null;
  var d = new Date(dob); if (isNaN(d.getTime())) return null;
  var now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}
