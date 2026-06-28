/**
 * Files.js — Google Drive document service. Files live in private Drive; metadata in `medical_documents`.
 * Admin hard-delete removes the Drive blob (PRD: unrecoverable). See docs/DATA-MODEL.md (Drive structure).
 */

/** Get or create the per-pet subfolder under the Medical Documents root. */
function petDocsFolder_(pet) {
  var docsRoot = DriveApp.getFolderById(prop_(CONFIG.PROP.DOCS_FOLDER_ID, true));
  var name = pet.id + '__' + String(pet.name || 'pet').replace(/[^A-Za-z0-9_-]/g, '_');
  var it = docsRoot.getFoldersByName(name);
  return it.hasNext() ? it.next() : docsRoot.createFolder(name);
}

/** Approx. used bytes = sum of stored document sizes (account is dedicated to the clinic). */
function storageUsedBytes_() {
  var docs = readAll_('medical_documents');
  return docs.reduce(function (sum, d) { return sum + Number(d.size_bytes || 0); }, 0);
}

function storageUsage_(req) {
  requireAdmin_(requireAuth_(req));
  var used = storageUsedBytes_();
  var total = CONFIG.DRIVE_TOTAL_BYTES;
  var pct = Math.round((used / total) * 1000) / 10;
  var info = clinicInfoRow_();
  var threshold = Number(info && info.storage_warn_pct ? info.storage_warn_pct : CONFIG.DEFAULT_STORAGE_WARN_PCT);
  return ok_({ used_bytes: used, total_bytes: total, used_pct: pct, warn_pct: threshold, nearing_capacity: pct >= threshold });
}

function uploadDocument_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['pet_id', 'doc_type', 'file_base64', 'file_name']);
  v_enum_(p.doc_type, 'doc_type');
  var pet = findById_('pets', p.pet_id);
  if (!pet) throw new ApiError(ERROR_CODES.FK_VIOLATION, 'Pet not found', { pet_id: 'invalid' });
  if (p.consultation_id && !findById_('consultations', p.consultation_id)) {
    throw new ApiError(ERROR_CODES.FK_VIOLATION, 'Consultation not found', { consultation_id: 'invalid' });
  }

  var bytes = Utilities.base64Decode(p.file_base64);
  var sizeBytes = bytes.length;
  var mime = p.mime_type || 'application/octet-stream';
  var blob = Utilities.newBlob(bytes, mime, p.file_name);

  return withLock_(function () {
    // F9: quota check INSIDE the lock so two concurrent uploads can't both slip past the 15GB cap.
    if (storageUsedBytes_() + sizeBytes > CONFIG.DRIVE_TOTAL_BYTES) {
      throw new ApiError(ERROR_CODES.STORAGE_FULL, 'Storage quota exceeded — free space before uploading');
    }
    var folder = petDocsFolder_(pet);
    var file = folder.createFile(blob);
    file.setDescription('KIV Clinic medical document — pet ' + pet.id);
    // Drive blob stays PRIVATE to the clinic account (never link-shared). Access is only ever via the
    // RBAC-gated documents.serve proxy below (F10). We store the id, not a shareable URL.
    var rec = insert_('medical_documents', {
      pet_id: pet.id, consultation_id: p.consultation_id || '', doc_type: p.doc_type,
      title: v_string_(p.title || p.file_name, 200), drive_file_id: file.getId(),
      file_url: '', file_name: p.file_name, mime_type: mime, size_bytes: sizeBytes,
      uploaded_by: actor.sub, uploaded_at: new Date().toISOString()
    }, actor);
    writeAudit_('document.upload', 'medical_documents', rec.id, { pet_id: pet.id, size: sizeBytes }, actor);
    return ok_({ id: rec.id, size_bytes: sizeBytes });
  });
}

/** F10: RBAC-gated document fetch. Streams the private Drive blob through the API as base64 so staff
 *  (who never touch Google directly) can view it, with an access audit. Drive is never link-shared. */
function serveDocument_(req) {
  var actor = requireAuth_(req);
  var doc = findById_('medical_documents', req.payload.id);
  if (!doc || !doc.drive_file_id) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Document not found');
  var blob;
  try { blob = DriveApp.getFileById(doc.drive_file_id).getBlob(); }
  catch (e) { throw new ApiError(ERROR_CODES.NOT_FOUND, 'Document file is unavailable'); }
  writeAudit_('document.view', 'medical_documents', doc.id, { pet_id: doc.pet_id }, actor);
  return ok_({ id: doc.id, file_name: doc.file_name, mime_type: doc.mime_type, size_bytes: doc.size_bytes,
    base64: Utilities.base64Encode(blob.getBytes()) });
}

function documentsByPet_(req) {
  requireAuth_(req);
  var docs = findBy_('medical_documents', 'pet_id', req.payload.pet_id)
    .map(publicDoc_);
  return ok_(docs);
}

function documentsByConsultation_(req) {
  requireAuth_(req);
  var docs = findBy_('medical_documents', 'consultation_id', req.payload.consultation_id).map(publicDoc_);
  return ok_(docs);
}

function publicDoc_(d) {
  // F10: never expose the raw Drive URL to clients — viewing goes through documents.serve (RBAC + audit).
  return { id: d.id, pet_id: d.pet_id, consultation_id: d.consultation_id, doc_type: d.doc_type,
    title: d.title, file_name: d.file_name, mime_type: d.mime_type,
    size_bytes: d.size_bytes, uploaded_at: d.uploaded_at };
}

/** Admin-only PERMANENT delete: remove Drive blob + tombstone row. Unrecoverable. */
function deleteDocument_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  var id = req.payload.id;
  return withLock_(function () {
    var doc = findById_('medical_documents', id);
    if (!doc) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Document not found');
    if (doc.drive_file_id) {
      try { DriveApp.getFileById(doc.drive_file_id).setTrashed(true); }
      catch (e) { console.warn('drive_delete_failed', doc.drive_file_id, e && e.message); }
    }
    update_('medical_documents', id, { is_deleted: true, deleted_at: new Date().toISOString(),
      deleted_by: actor.sub, drive_file_id: '', file_url: '' }, actor);
    writeAudit_('document.delete', 'medical_documents', id, { pet_id: doc.pet_id }, actor);
    return ok_({ deleted: true });
  });
}
