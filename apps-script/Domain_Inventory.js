/**
 * Domain_Inventory.js — medicines (per-batch stock) + suppliers. See docs/PRD.md §10.
 * Flags computed: expiry < 6 months ⇒ Red; quantity < threshold (3) ⇒ Yellow. Value = qty × purchase_price.
 */

// ---------- medicines ----------
function medicinesCreate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['name', 'quantity', 'purchase_price', 'expiry_date']);
  if (p.supplier_id) checkForeignKeys_('medicines', { supplier_id: p.supplier_id });
  var name = v_string_(p.name, 160);
  var rec = insert_('medicines', {
    name: name, name_normalized: name.toLowerCase(), batch_number: v_string_(p.batch_number, 80),
    quantity: v_number_(p.quantity, { required: true, integer: true, min: 0 }), unit: v_string_(p.unit, 30),
    purchase_price: v_number_(p.purchase_price, { required: true, min: 0 }),
    selling_price: v_number_(p.selling_price, { min: 0 }) || 0, supplier_id: p.supplier_id || '',
    expiry_date: v_date_(p.expiry_date, true).toISOString(),
    reorder_threshold: v_number_(p.reorder_threshold, { integer: true, min: 0 }) || CONFIG.LOW_STOCK_THRESHOLD
  }, actor);
  writeAudit_('medicine.create', 'medicines', rec.id, { name: name }, actor);
  return ok_(publicMedicine_(rec));
}

function medicinesUpdate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['id']);
  var patch = {};
  if (p.name !== undefined) { patch.name = v_string_(p.name, 160); patch.name_normalized = patch.name.toLowerCase(); }
  if (p.batch_number !== undefined) patch.batch_number = v_string_(p.batch_number, 80);
  if (p.quantity !== undefined) patch.quantity = v_number_(p.quantity, { integer: true, min: 0 });
  if (p.unit !== undefined) patch.unit = v_string_(p.unit, 30);
  if (p.purchase_price !== undefined) patch.purchase_price = v_number_(p.purchase_price, { min: 0 });
  if (p.selling_price !== undefined) patch.selling_price = v_number_(p.selling_price, { min: 0 });
  if (p.expiry_date !== undefined) patch.expiry_date = v_date_(p.expiry_date, true).toISOString();
  if (p.reorder_threshold !== undefined) patch.reorder_threshold = v_number_(p.reorder_threshold, { integer: true, min: 0 });
  if (p.supplier_id !== undefined) { if (p.supplier_id) checkForeignKeys_('medicines', { supplier_id: p.supplier_id }); patch.supplier_id = p.supplier_id; }
  var rec = update_('medicines', p.id, patch, actor);
  writeAudit_('medicine.update', 'medicines', p.id, patch, actor);
  return ok_(publicMedicine_(rec));
}

function medicinesList_(req) {
  requireAuth_(req);
  var p = req.payload || {};
  var rows = readAll_('medicines');
  if (p.search) { var q = String(p.search).toLowerCase(); rows = rows.filter(function (m) { return String(m.name_normalized || m.name).indexOf(q) !== -1; }); }
  rows.sort(function (a, b) { return String(a.name_normalized || a.name).localeCompare(String(b.name_normalized || b.name)); });
  var page = paginate_(rows, p);
  return ok_(page.items.map(publicMedicine_), { total: page.total, limit: page.limit, offset: page.offset });
}

function medicinesDelete_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  softDelete_('medicines', req.payload.id, actor);
  writeAudit_('medicine.delete', 'medicines', req.payload.id, null, actor);
  return ok_({ deleted: true });
}

function medicinesLowStock_(req) {
  requireAuth_(req);
  return ok_(readAll_('medicines').filter(function (m) {
    return Number(m.quantity || 0) < Number(m.reorder_threshold || CONFIG.LOW_STOCK_THRESHOLD);
  }).map(publicMedicine_));
}

function medicinesExpiring_(req) {
  requireAuth_(req);
  return ok_(readAll_('medicines').filter(function (m) { return publicMedicine_(m).expiry_flag === 'red'; }).map(publicMedicine_));
}

function inventoryValue_(req) {
  requireAuth_(req);
  var total = readAll_('medicines').reduce(function (s, m) {
    return s + Number(m.quantity || 0) * Number(m.purchase_price || 0);
  }, 0);
  return ok_({ inventory_value: Math.round(total * 100) / 100 });
}

function publicMedicine_(m) {
  var qty = Number(m.quantity || 0);
  var threshold = Number(m.reorder_threshold || CONFIG.LOW_STOCK_THRESHOLD);
  var expT = m.expiry_date ? new Date(m.expiry_date).getTime() : null;
  var warnT = new Date(); warnT.setMonth(warnT.getMonth() + CONFIG.EXPIRY_WARN_MONTHS);
  var expiryFlag = (expT !== null && expT <= warnT.getTime()) ? 'red' : 'none';
  var stockFlag = (qty < threshold) ? 'yellow' : 'none';
  return { id: m.id, name: m.name, batch_number: m.batch_number, quantity: qty, unit: m.unit,
    purchase_price: Number(m.purchase_price || 0), selling_price: Number(m.selling_price || 0),
    supplier_id: m.supplier_id, expiry_date: m.expiry_date, reorder_threshold: threshold,
    expiry_flag: expiryFlag, stock_flag: stockFlag,
    line_value: Math.round(qty * Number(m.purchase_price || 0) * 100) / 100 };
}

// ---------- suppliers ----------
function suppliersCreate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['name']);
  var rec = insert_('suppliers', { name: v_string_(p.name, 160), contact_person: v_string_(p.contact_person, 120),
    mobile: normalizeMobile_(p.mobile), email: v_email_(p.email), address: v_string_(p.address, 300) }, actor);
  writeAudit_('supplier.create', 'suppliers', rec.id, null, actor);
  return ok_(publicSupplier_(rec));
}

function suppliersUpdate_(req) {
  var actor = requireAuth_(req);
  var p = req.payload || {};
  v_required_(p, ['id']);
  var patch = {};
  if (p.name !== undefined) patch.name = v_string_(p.name, 160);
  if (p.contact_person !== undefined) patch.contact_person = v_string_(p.contact_person, 120);
  if (p.mobile !== undefined) patch.mobile = normalizeMobile_(p.mobile);
  if (p.email !== undefined) patch.email = v_email_(p.email);
  if (p.address !== undefined) patch.address = v_string_(p.address, 300);
  var rec = update_('suppliers', p.id, patch, actor);
  writeAudit_('supplier.update', 'suppliers', p.id, patch, actor);
  return ok_(publicSupplier_(rec));
}

function suppliersList_(req) {
  requireAuth_(req);
  var rows = readAll_('suppliers').sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  return ok_(rows.map(publicSupplier_));
}

function suppliersDelete_(req) {
  var actor = requireAdmin_(requireAuth_(req));
  softDelete_('suppliers', req.payload.id, actor);
  writeAudit_('supplier.delete', 'suppliers', req.payload.id, null, actor);
  return ok_({ deleted: true });
}

function publicSupplier_(s) {
  return { id: s.id, name: s.name, contact_person: s.contact_person, mobile: s.mobile, email: s.email, address: s.address };
}
