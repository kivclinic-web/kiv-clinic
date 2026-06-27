/**
 * Schema.js — the schema registry. ONE place that defines every tab and its columns.
 * Code reads/writes by header name resolved against this registry (never by fixed index).
 * Must stay in sync with docs/DATA-MODEL.md. Changes = a numbered migration + schema_version bump.
 */

// Standard audit columns appended to every domain tab (unless softDelete:false).
var STD_COLS = ['created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted', 'deleted_at', 'deleted_by'];

function withStd_(cols, opts) {
  opts = opts || {};
  if (opts.softDelete === false) return cols.concat(['created_at', 'created_by', 'updated_at', 'updated_by']);
  return cols.concat(STD_COLS);
}

var SCHEMA = {
  _meta: { columns: ['key', 'value'], softDelete: false, audit: false },

  auth_users: {
    columns: withStd_(['id', 'identifier', 'identifier_type', 'display_name', 'role',
      'password_hash', 'password_salt', 'status', 'must_reset',
      'failed_attempts', 'locked_until', 'last_login_at']),
    unique: ['identifier']
  },

  revoked_tokens: { columns: ['jti', 'user_id', 'revoked_at', 'expires_at'], softDelete: false, audit: false },

  audit_log: {
    columns: ['id', 'ts', 'actor_id', 'actor_role', 'action', 'entity', 'entity_id', 'details'],
    softDelete: false, audit: false
  },

  clinic_info: {
    columns: withStd_(['id', 'clinic_name', 'address', 'phone', 'email', 'logo_file_id', 'storage_warn_pct'])
  },

  clients: {
    columns: withStd_(['id', 'name', 'mobile', 'address', 'email', 'notes']),
    unique: ['mobile']
  },

  pets: {
    columns: withStd_(['id', 'client_id', 'name', 'species', 'breed', 'sex',
      'date_of_birth', 'age_text', 'color', 'neutered']),
    fk: { client_id: 'clients' }
  },

  pet_weights: {
    columns: ['id', 'pet_id', 'weight_kg', 'recorded_at', 'recorded_by'],
    softDelete: false, fk: { pet_id: 'pets' }
  },

  appointments: {
    columns: withStd_(['id', 'pet_id', 'client_id', 'type', 'status', 'scheduled_at', 'reason',
      'is_followup', 'followup_of', 'followup_interval', 'rescheduled_from']),
    fk: { pet_id: 'pets', client_id: 'clients' }
  },

  consultations: {
    columns: withStd_(['id', 'pet_id', 'client_id', 'appointment_id', 'consult_date',
      'diagnosis', 'treatment', 'clinical_notes', 'follow_up_recommendation',
      'follow_up_interval', 'prescription_file_id']),
    fk: { pet_id: 'pets', client_id: 'clients' }
  },

  consultation_medicines: {
    columns: ['id', 'consultation_id', 'medicine_id', 'medicine_name', 'quantity',
      'dosage', 'instructions', 'deducted', 'created_at'],
    softDelete: false, fk: { consultation_id: 'consultations', medicine_id: 'medicines' }
  },

  vaccinations: {
    columns: withStd_(['id', 'pet_id', 'vaccine_type_id', 'vaccine_name', 'date_administered',
      'due_date', 'batch_number', 'administered_by', 'notes']),
    fk: { pet_id: 'pets', vaccine_type_id: 'vaccine_types' }
  },

  vaccine_types: {
    columns: ['id', 'name', 'default_interval_days', 'species', 'is_active'],
    softDelete: false
  },

  dewormings: {
    columns: withStd_(['id', 'pet_id', 'date_administered', 'next_due', 'product', 'administered_by']),
    fk: { pet_id: 'pets' }
  },

  medicines: {
    columns: withStd_(['id', 'name', 'name_normalized', 'batch_number', 'quantity', 'unit',
      'purchase_price', 'selling_price', 'supplier_id', 'expiry_date', 'reorder_threshold']),
    fk: { supplier_id: 'suppliers' }
  },

  suppliers: {
    columns: withStd_(['id', 'name', 'contact_person', 'mobile', 'email', 'address'])
  },

  medical_documents: {
    columns: withStd_(['id', 'pet_id', 'consultation_id', 'doc_type', 'title', 'drive_file_id',
      'file_url', 'file_name', 'mime_type', 'size_bytes', 'uploaded_by', 'uploaded_at']),
    fk: { pet_id: 'pets' }  // consultation_id optional → validated only when present
  }
};

// Seed data (idempotent): the 6 PRD vaccines. Intervals are sensible defaults — REVIEW with the clinic.
var SEED_VACCINE_TYPES = [
  { name: 'Anti Rabies', default_interval_days: 365, species: 'all', is_active: true },
  { name: 'DHPPIL (7-in-1)', default_interval_days: 365, species: 'dog', is_active: true },
  { name: 'DHPPIL (9-in-1)', default_interval_days: 365, species: 'dog', is_active: true },
  { name: 'KC', default_interval_days: 365, species: 'dog', is_active: true },
  { name: 'CCV', default_interval_days: 365, species: 'dog', is_active: true },
  { name: 'TRICAT', default_interval_days: 365, species: 'cat', is_active: true }
];

var ENUMS = {
  role: ['administrator', 'manager'],
  identifier_type: ['email', 'mobile'],
  user_status: ['active', 'disabled'],
  appointment_type: ['OPD', 'Surgery', 'Grooming', 'FollowUp'],
  appointment_status: ['scheduled', 'completed', 'cancelled', 'rescheduled', 'no_show'],
  sex: ['male', 'female', 'unknown'],
  species: ['dog', 'cat', 'other'],
  followup_interval: ['5d', '1w'],
  doc_type: ['Scanned Prescription', 'Lab Report', 'X-Ray', 'Diagnostic Report', 'Other']
};

/** All tab names in creation order. */
function allTabs_() { return Object.keys(SCHEMA); }
