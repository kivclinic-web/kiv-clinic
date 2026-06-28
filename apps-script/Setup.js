/**
 * Setup.js — one-time provisioning + migrations (infrastructure-as-code).
 * Run `setup()` once from the Apps Script editor (authorize when prompted). Idempotent: safe to re-run.
 * Creates the Spreadsheet, Drive folders, all tabs+headers, seeds, and secrets in Script Properties.
 */

function setup() {
  var report = {};
  report.properties = ensureSecrets_();
  report.spreadsheet = ensureSpreadsheet_();
  report.folders = ensureFolders_();
  report.tabs = ensureTabs_();
  report.seed = seedReferenceData_();
  setProp_(CONFIG.PROP.SCHEMA_VERSION, String(CONFIG.SCHEMA_VERSION));
  ensureTriggers_();
  report.bootstrap_admin_token = prop_(CONFIG.PROP.BOOTSTRAP_ADMIN_TOKEN, true);
  report.web_app_next_steps = 'Deploy → New deployment → Web app (Execute as: Me, Access: Anyone). ' +
    'Then POST auth.bootstrapAdmin with this bootstrap_admin_token to create the first administrator.';
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function ensureSecrets_() {
  var created = [];
  if (!prop_(CONFIG.PROP.TOKEN_SECRET)) {
    setProp_(CONFIG.PROP.TOKEN_SECRET, bytesToHex_(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + new Date().getTime())));
    created.push('TOKEN_SECRET');
  }
  if (!prop_(CONFIG.PROP.BOOTSTRAP_ADMIN_TOKEN)) {
    setProp_(CONFIG.PROP.BOOTSTRAP_ADMIN_TOKEN, Utilities.getUuid() + '-' + Utilities.getUuid());
    created.push('BOOTSTRAP_ADMIN_TOKEN');
  }
  return { created: created };
}

function ensureSpreadsheet_() {
  var existing = prop_(CONFIG.PROP.SPREADSHEET_ID);
  if (existing) { try { SpreadsheetApp.openById(existing); return { id: existing, reused: true }; } catch (e) {} }
  var ss = SpreadsheetApp.create('KIV Clinic DB');
  setProp_(CONFIG.PROP.SPREADSHEET_ID, ss.getId());
  __ssCache = null;
  return { id: ss.getId(), reused: false };
}

function ensureFolders_() {
  var root = getOrCreateFolder_(null, 'KIV Clinic', CONFIG.PROP.DRIVE_ROOT_FOLDER_ID);
  var docs = getOrCreateFolder_(root, 'Medical Documents', CONFIG.PROP.DOCS_FOLDER_ID);
  var presc = getOrCreateFolder_(root, 'Prescriptions', CONFIG.PROP.PRESCRIPTIONS_FOLDER_ID);
  var backups = getOrCreateFolder_(root, 'Backups', CONFIG.PROP.BACKUPS_FOLDER_ID);
  getOrCreateFolder_(root, 'Clinic Assets', null);
  return { root: root.getId(), docs: docs.getId(), prescriptions: presc.getId(), backups: backups.getId() };
}

function getOrCreateFolder_(parent, name, propKey) {
  if (propKey) { var pid = prop_(propKey); if (pid) { try { return DriveApp.getFolderById(pid); } catch (e) {} } }
  var folder;
  if (parent) { var it = parent.getFoldersByName(name); folder = it.hasNext() ? it.next() : parent.createFolder(name); }
  else { var rit = DriveApp.getFoldersByName(name); folder = rit.hasNext() ? rit.next() : DriveApp.createFolder(name); }
  if (propKey) setProp_(propKey, folder.getId());
  return folder;
}

function ensureTabs_() {
  var ss = getSpreadsheet_();
  var result = {};
  allTabs_().forEach(function (tab) {
    var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
    var headers = SCHEMA[tab].columns;
    var current = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (current.join('') !== headers.join('')) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
    result[tab] = headers.length;
  });
  // Remove the default 'Sheet1' if present and empty.
  var def = ss.getSheetByName('Sheet1');
  if (def && allTabs_().indexOf('Sheet1') === -1 && def.getLastRow() <= 1 && ss.getSheets().length > 1) ss.deleteSheet(def);
  return result;
}

function seedReferenceData_() {
  var seeded = { vaccine_types: 0, clinic_info: 0, schema_version: 0 };
  // vaccine_types
  var existing = readAll_('vaccine_types').map(function (v) { return v.name; });
  SEED_VACCINE_TYPES.forEach(function (vt) {
    if (existing.indexOf(vt.name) === -1) {
      insert_('vaccine_types', { name: vt.name, default_interval_days: vt.default_interval_days,
        species: vt.species, is_active: vt.is_active }, null);
      seeded.vaccine_types++;
    }
  });
  // clinic_info singleton
  if (readAll_('clinic_info').length === 0) {
    insert_('clinic_info', { clinic_name: 'KIV Clinic', address: '', phone: '', email: '',
      logo_file_id: '', storage_warn_pct: CONFIG.DEFAULT_STORAGE_WARN_PCT }, null);
    seeded.clinic_info++;
  }
  // _meta schema_version
  var meta = findBy_('_meta', 'key', 'schema_version');
  if (!meta.length) { getSheet_('_meta').appendRow(['schema_version', String(CONFIG.SCHEMA_VERSION)]); seeded.schema_version++; }
  return seeded;
}

function clinicInfoRow_() { var r = readCachedTable_('clinic_info', 1800); return r.length ? r[0] : null; }

/** Upsert a key/value into the _meta tab (no `id` column, so handled directly). */
function setMeta_(key, value) {
  var sh = getSheet_('_meta');
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === key) { sh.getRange(r + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}

function getMeta_(key) {
  var rows = findBy_('_meta', 'key', key);
  return rows.length ? rows[0].value : null;
}

// ---------- triggers: daily backup + storage monitor ----------
function ensureTriggers_() {
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('dailyBackup_') === -1) {
    ScriptApp.newTrigger('dailyBackup_').timeBased().everyDays(1).atHour(2).create();
  }
}

function dailyBackup_() {
  try {
    var ss = getSpreadsheet_();
    var backups = DriveApp.getFolderById(prop_(CONFIG.PROP.BACKUPS_FOLDER_ID, true));
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var copy = DriveApp.getFileById(ss.getId()).makeCopy('KIV Clinic DB backup ' + stamp, backups);
    // Retain only the latest 14 backups.
    var files = [];
    var it = backups.getFiles();
    while (it.hasNext()) files.push(it.next());
    files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
    for (var i = 14; i < files.length; i++) files[i].setTrashed(true);
    setMeta_('last_backup_at', new Date().toISOString());
    console.log('backup_done', copy.getId());
  } catch (e) { console.error('backup_failed', e && e.message); }
}
