/**
 * Audit.js — append-only audit trail. Every mutation/auth event should call writeAudit_.
 */
function writeAudit_(action, entity, entityId, details, actor) {
  try {
    var sh = getSheet_('audit_log');
    sh.appendRow([
      Utilities.getUuid(),
      new Date().toISOString(),
      actor ? actor.sub : 'system',
      actor ? actor.role : '',
      action,
      entity || '',
      entityId || '',
      details ? (typeof details === 'string' ? details : JSON.stringify(details)) : ''
    ]);
  } catch (e) {
    // Never let audit failure break the main operation; log it.
    console.error('audit_failed', action, e && e.message);
  }
}
