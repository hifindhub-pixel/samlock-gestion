// Stocks de serrurerie (cylindres, serrures, blindage, consommables…) : quantités, mouvements, alertes, réapprovisionnement.
// Le stock vit dans le catalogue (même article = même référence, même prix d'achat) : une ligne de devis ou de facture
// qui cite un article suivi en stock le fait sortir automatiquement à l'émission de la facture.
import { db, round2 } from './db.js';
import { AFDB_PURCHASES } from './afdb-data.js';
import { TIIME_SALES, TIIME_SALE_PRICES } from './tiime-data.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => Number(String(v ?? '').replace(',', '.'));

export const MOVE_KINDS = { entree: 'Entrée', sortie: 'Sortie', perte: 'Casse / perte', retour: 'Retour client', inventaire: 'Inventaire' };

const FAMILIES = [[/^(demi-)?cylindre|^jeu de cylindre|^bloc cylindre|^mécanisme|cylindre pour/i, 'CYL', 'Cylindres'], [/^serrure|^crémone|^coffre|^verrou/i, 'SER', 'Serrures'], [/^poignée|^ensemble sur plaque|^demi-ensemble|^kit béquille|^plaque|^protecteur|^barre|^butoir/i, 'ACC', 'Accessoires'], [/^ferme-porte/i, 'FPO', 'Accessoires'], [/^fraise|^disque|^scie|^coffret|^boîte|^sac|^silicone|^clé plate|^batteuse/i, 'OUT', 'Consommables']];
const BRANDS = ['HERACLES', 'VACHETTE', 'BRICARD', 'FICHET', 'FERCO', 'STREMLER', 'HANGER', 'BOSCH', 'RONIS', 'HOPPE', 'MADELIN', 'ISEO', 'KABA', 'WINKHAUS', 'SECURY', 'THIRARD'];

/** Reprend l'historique des achats AFDB : crée les pièces absentes (réf. FAMILLE-MARQUE-chrono) et enregistre une entrée par référence. Idempotent. */
export function importAfdbHistory() {
  const sup = db.prepare("SELECT id FROM contacts WHERE kind='fournisseur' AND name LIKE 'AFDB%'").get();
  const out = { created: 0, entries: 0, skipped: 0 };
  for (const [chrono, qty, cost, label] of AFDB_PURCHASES) {
    let it = db.prepare('SELECT * FROM catalog_items WHERE supplier_ref=?').get(chrono);
    if (!it) {
      const fam = FAMILIES.find(([re]) => re.test(label)) || [null, 'DIV', 'Divers'];
      const brand = BRANDS.find((b) => label.toUpperCase().includes(b));
      const ref = `${fam[1]}-${(brand || 'GEN').slice(0, 3)}-${chrono}`;
      const r = db.prepare('INSERT INTO catalog_items(ref,label,unit,category,supplier_id,cost_material,labor_hours,labor_rate,cost_sub,price_ht,vat,brand,track_stock,stock_qty,supplier_ref) VALUES(?,?,?,?,?,?,0,60,0,0,20,?,1,0,?)')
        .run(ref, label, 'u', fam[2], sup?.id || null, cost, brand ? brand[0] + brand.slice(1).toLowerCase() : null, chrono);
      it = db.prepare('SELECT * FROM catalog_items WHERE id=?').get(r.lastInsertRowid); out.created++;
    }
    if (db.prepare("SELECT 1 FROM stock_moves WHERE ref_type='afdb_histo' AND ref_id=? AND item_id=?").get(Number(chrono), it.id)) { out.skipped++; continue; }
    applyMove({ item_id: it.id, kind: 'entree', qty, unit_cost: cost, supplier_id: sup?.id || null, ref_type: 'afdb_histo', ref_id: Number(chrono), note: 'Reprise historique des achats AFDB (06/2025 – 11/2026)' });
    out.entries++;
  }
  return out;
}

/** Reprend les ventes passées (factures Tiime 1 à 433) : sorties de pièces datées + dernier prix de vente HT facturé. Idempotent. */
export function importTiimeHistory() {
  const out = { sorties: 0, retours: 0, skipped: 0, prices: 0, unknown: 0 };
  for (const [no, date, chrono, qty] of TIIME_SALES) {
    const it = db.prepare('SELECT id FROM catalog_items WHERE supplier_ref=?').get(chrono);
    if (!it) { out.unknown++; continue; }
    if (db.prepare("SELECT 1 FROM stock_moves WHERE ref_type='tiime_histo' AND ref_id=? AND item_id=?").get(no, it.id)) { out.skipped++; continue; }
    const neg = qty < 0;
    applyMove({ item_id: it.id, kind: neg ? 'retour' : 'sortie', qty: Math.abs(qty), ref_type: 'tiime_histo', ref_id: no, note: `Facture Tiime n° ${Math.abs(no)}${neg ? ' (avoir)' : ''}`, date });
    neg ? out.retours++ : out.sorties++;
  }
  for (const [chrono, price] of Object.entries(TIIME_SALE_PRICES)) {
    const r = db.prepare("UPDATE catalog_items SET price_ht=?, updated_at=datetime('now') WHERE supplier_ref=? AND track_stock=1 AND (price_ht IS NULL OR price_ht=0)").run(price, chrono);
    out.prices += r.changes;
  }
  return out;
}

/** Quantités engagées par des devis signés dont l'intervention n'est pas encore facturée. */
export function reservedByItem() {
  const rows = db.prepare(`SELECT l.item_id, SUM(l.qty) q FROM lines l JOIN quotes q ON q.id=l.quote_id
    WHERE q.status='signe' AND l.item_id IS NOT NULL AND l.to_price=0
      AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.project_id=q.project_id AND i.kind IN ('facture','solde') AND i.status<>'brouillon' AND i.credit_of IS NULL)
    GROUP BY l.item_id`).all();
  const res = {};
  for (const r of rows) for (const [id, q] of consumption(r.item_id, r.q)) res[id] = round2((res[id] || 0) + q);
  return res;
}

export function stockStatus(i, reserved = 0) {
  const available = round2(i.stock_qty - reserved);
  const status = i.stock_qty <= 0 ? 'rupture' : (i.stock_min > 0 && available <= i.stock_min) ? 'bas' : 'ok';
  return { available, status };
}

/** Enregistre un mouvement et met à jour la quantité (et le coût moyen pondéré sur une entrée valorisée). */
export function applyMove({ item_id, kind, qty, unit_cost = null, supplier_id = null, ref_type = null, ref_id = null, note = null, date = null }) {
  const it = db.prepare('SELECT * FROM catalog_items WHERE id=?').get(item_id);
  if (!it) throw fail(404, 'Article introuvable.');
  if (!MOVE_KINDS[kind]) throw fail(400, 'Type de mouvement inconnu.');
  let q = num(qty);
  if (!Number.isFinite(q)) throw fail(400, 'Quantité invalide.');
  let delta;
  if (kind === 'inventaire') { if (q < 0) throw fail(400, 'La quantité comptée ne peut pas être négative.'); delta = round2(q - it.stock_qty); }
  else { if (q <= 0) throw fail(400, 'Indiquez une quantité positive.'); delta = kind === 'entree' || kind === 'retour' ? q : -q; }
  const after = round2(it.stock_qty + delta);
  const cost = unit_cost === null || unit_cost === '' ? null : num(unit_cost);
  const tx = db.transaction(() => {
    const mid = db.prepare('INSERT INTO stock_moves(item_id,qty,kind,unit_cost,supplier_id,ref_type,ref_id,note,stock_after) VALUES(?,?,?,?,?,?,?,?,?)').run(item_id, delta, kind, cost, supplier_id || null, ref_type, ref_id, note, after).lastInsertRowid;
    if (date) db.prepare('UPDATE stock_moves SET created_at=? WHERE id=?').run(`${date} 12:00:00`, mid);
    db.prepare("UPDATE catalog_items SET stock_qty=?, track_stock=1, updated_at=datetime('now') WHERE id=?").run(after, item_id);
    // Coût moyen pondéré : le prix d'achat du catalogue suit les réceptions (la marge des futurs devis en tient compte).
    if (kind === 'entree' && cost > 0) {
      const base = Math.max(0, it.stock_qty);
      const pmp = base + q > 0 ? round2((base * (it.cost_material || 0) + q * cost) / (base + q)) : cost;
      if (pmp !== it.cost_material) {
        db.prepare('UPDATE catalog_items SET cost_material=? WHERE id=?').run(pmp, item_id);
        syncPartCosts(item_id);
        const total = pmp + (it.labor_hours || 0) * (it.labor_rate || 0) + (it.cost_sub || 0);
        db.prepare('INSERT INTO catalog_history(item_id,price_ht,cost_total,note) VALUES(?,?,?,?)').run(item_id, it.price_ht, round2(total), `Réception de ${q} à ${cost} € (coût moyen)`);
      }
    }
  });
  tx();
  return { item_id, delta, stock_qty: after };
}

/** Pièces à sortir pour une ligne : l'article lui-même s'il est suivi, plus les pièces de sa composition de stock. */
export function consumption(itemId, qty) {
  const out = new Map(); const add = (id, q) => out.set(id, round2((out.get(id) || 0) + q));
  const it = db.prepare('SELECT track_stock FROM catalog_items WHERE id=?').get(itemId);
  if (it?.track_stock) add(itemId, qty);
  for (const p of db.prepare('SELECT p.part_id, p.qty, ci.track_stock FROM item_parts p JOIN catalog_items ci ON ci.id=p.part_id WHERE p.item_id=?').all(itemId)) if (p.track_stock) add(p.part_id, qty * p.qty);
  return out;
}

/** Sortie automatique à l'émission d'une facture : une seule fois par facture et par pièce. */
export function consumeForInvoice(invoiceId) {
  const total = new Map();
  for (const l of db.prepare('SELECT item_id, SUM(qty) q FROM invoice_lines WHERE invoice_id=? AND item_id IS NOT NULL AND qty>0 GROUP BY item_id').all(invoiceId))
    for (const [id, q] of consumption(l.item_id, l.q)) total.set(id, round2((total.get(id) || 0) + q));
  const inv = db.prepare('SELECT number FROM invoices WHERE id=?').get(invoiceId);
  const done = [];
  for (const [item_id, q] of total) {
    if (db.prepare("SELECT 1 FROM stock_moves WHERE ref_type='invoice' AND ref_id=? AND item_id=? AND kind='sortie'").get(invoiceId, item_id)) continue;
    done.push(applyMove({ item_id, kind: 'sortie', qty: q, ref_type: 'invoice', ref_id: invoiceId, note: `Facture ${inv?.number || ''}`.trim() }));
  }
  return done;
}

/** Avoir total émis : les pièces sorties avec la facture d'origine reviennent en stock (retour client). Un avoir partiel ne touche pas au stock. */
export function returnForCredit(creditId) {
  const cr = db.prepare("SELECT * FROM invoices WHERE id=? AND kind='avoir' AND credit_of IS NOT NULL").get(creditId); if (!cr) return [];
  const src = db.prepare('SELECT * FROM invoices WHERE id=?').get(cr.credit_of); if (!src) return [];
  const credited = db.prepare("SELECT COALESCE(SUM(-total_ttc),0) t FROM invoices WHERE credit_of=? AND kind='avoir' AND (status<>'brouillon' OR id=?)").get(src.id, creditId).t;
  if (credited + 0.01 < src.total_ttc) return [];
  const done = [];
  for (const m of db.prepare("SELECT item_id, -qty AS q FROM stock_moves WHERE ref_type='invoice' AND ref_id=? AND kind='sortie'").all(src.id)) {
    if (db.prepare("SELECT 1 FROM stock_moves WHERE ref_type='invoice' AND ref_id=? AND item_id=? AND kind='retour'").get(creditId, m.item_id)) continue;
    done.push(applyMove({ item_id: m.item_id, kind: 'retour', qty: m.q, ref_type: 'invoice', ref_id: creditId, note: `Avoir sur ${src.number || ''}`.trim() }));
  }
  return done;
}

/** Le coût d'un article vendu suit le coût moyen de ses pièces. */
export function syncPartCosts(partId) {
  for (const p of db.prepare('SELECT DISTINCT item_id FROM item_parts WHERE part_id=?').all(partId)) {
    const cost = db.prepare('SELECT SUM(p.qty*ci.cost_material) c FROM item_parts p JOIN catalog_items ci ON ci.id=p.part_id WHERE p.item_id=?').get(p.item_id).c || 0;
    db.prepare("UPDATE catalog_items SET cost_material=?, updated_at=datetime('now') WHERE id=?").run(round2(cost), p.item_id);
  }
}

export function mountStock(app, { log, outbox }) {
  const list = (all) => {
    const reserved = reservedByItem();
    const rows = db.prepare(`SELECT ci.*, c.name AS supplier_name, c.email AS supplier_email FROM catalog_items ci LEFT JOIN contacts c ON c.id=ci.supplier_id
      WHERE ci.archived=0 ${all ? '' : 'AND ci.track_stock=1'} ORDER BY ci.category, ci.label`).all();
    return rows.map((i) => ({ ...i, reserved: round2(reserved[i.id] || 0), ...stockStatus(i, reserved[i.id] || 0), value: round2(Math.max(0, i.stock_qty) * (i.cost_material || 0)) }));
  };

  app.get('/api/stock', (req, res) => {
    const rows = list(req.query.all === '1');
    const tracked = rows.filter((r) => r.track_stock);
    res.json({
      rows, kinds: MOVE_KINDS,
      totals: { items: tracked.length, valuation: round2(tracked.reduce((a, r) => a + r.value, 0)), low: tracked.filter((r) => r.status === 'bas').length, out: tracked.filter((r) => r.status === 'rupture').length, reserved: round2(tracked.reduce((a, r) => a + r.reserved, 0)) },
      locations: db.prepare("SELECT DISTINCT stock_location l FROM catalog_items WHERE stock_location IS NOT NULL AND stock_location<>'' ORDER BY 1").all().map((r) => r.l),
    });
  });

  app.get('/api/stock/export.xlsx', async (_req, res) => {
    const { default: ExcelJS } = await import('exceljs');
    const rows = list(false);
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Stock');
    ws.columns = [['Catégorie', 18, 'category'], ['Réf. fournisseur', 16, 'supplier_ref'], ['Désignation', 46, 'label'], ['Marque', 14, 'brand'], ['Emplacement', 14, 'stock_location'], ['Unité', 8, 'unit'], ['Quantité', 10, 'stock_qty'], ['Réservé', 10, 'reserved'], ['Seuil mini', 10, 'stock_min'], ['Cible', 10, 'stock_target'], ['Prix d’achat HT', 14, 'cost_material'], ['Valeur', 12, null], ['État', 10, 'status'], ['Fournisseur', 22, 'supplier_name']].map(([header, width, key]) => ({ header, width, key: key || undefined }));
    rows.forEach((r, i) => { const row = ws.addRow({ ...r }); row.getCell(12).value = { formula: `MAX(0,G${i + 2})*K${i + 2}`, result: r.value }; });
    const n = rows.length + 1;
    ws.addRow({}); const tot = ws.addRow({ label: 'TOTAL' }); tot.getCell(12).value = { formula: `SUM(L2:L${n})` }; tot.font = { bold: true };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6D1A' } };
    ws.getColumn(11).numFmt = '#,##0.00 €'; ws.getColumn(12).numFmt = '#,##0.00 €'; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: `N${n}` };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="stock-samlock-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  });

  app.put('/api/stock/items/:id', (req, res) => {
    const it = db.prepare('SELECT * FROM catalog_items WHERE id=?').get(req.params.id); if (!it) return res.status(404).json({ error: 'Introuvable' });
    const b = req.body; const m = (k, d) => (b[k] === undefined ? d : num(b[k]) || 0);
    db.prepare("UPDATE catalog_items SET track_stock=?, stock_min=?, stock_target=?, stock_location=?, brand=?, updated_at=datetime('now') WHERE id=?")
      .run(b.track_stock === undefined ? it.track_stock : (b.track_stock ? 1 : 0), m('stock_min', it.stock_min), m('stock_target', it.stock_target), b.stock_location === undefined ? it.stock_location : (String(b.stock_location).trim() || null), b.brand === undefined ? it.brand : (String(b.brand).trim() || null), it.id);
    res.json(list(true).find((r) => r.id === it.id));
  });

  /** Pièces consommées par un article vendu. */
  app.get('/api/catalog/:id/parts', (req, res) => res.json(db.prepare('SELECT p.part_id, p.qty, ci.ref, ci.label, ci.cost_material, ci.stock_qty FROM item_parts p JOIN catalog_items ci ON ci.id=p.part_id WHERE p.item_id=? ORDER BY ci.label').all(req.params.id)));
  app.put('/api/catalog/:id/parts', (req, res) => {
    const id = Number(req.params.id); if (!db.prepare('SELECT 1 FROM catalog_items WHERE id=?').get(id)) return res.status(404).json({ error: 'Introuvable' });
    const parts = (req.body.parts || []).map((p) => ({ part_id: Number(p.part_id), qty: num(p.qty) })).filter((p) => p.part_id && p.part_id !== id && p.qty > 0);
    db.transaction(() => { db.prepare('DELETE FROM item_parts WHERE item_id=?').run(id); for (const p of parts) db.prepare('INSERT OR REPLACE INTO item_parts(item_id,part_id,qty) VALUES(?,?,?)').run(id, p.part_id, p.qty); })();
    if (parts[0]) syncPartCosts(parts[0].part_id);
    res.json(db.prepare('SELECT p.part_id, p.qty, ci.ref, ci.label, ci.cost_material, ci.stock_qty FROM item_parts p JOIN catalog_items ci ON ci.id=p.part_id WHERE p.item_id=?').all(id));
  });

  /** Réception fournisseur : lignes { supplier_ref | ref | item_id, qty, unit_cost } → entrées de stock. Les références inconnues sont renvoyées. */
  app.post('/api/stock/import-tiime', (req, res) => { try { res.json(importTiimeHistory()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
  app.post('/api/stock/import-afdb', (req, res) => { try { res.json(importAfdbHistory()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
  app.post('/api/stock/receipts', (req, res) => {
    const ok = []; const unknown = [];
    for (const l of req.body.lines || []) {
      const it = l.item_id ? db.prepare('SELECT * FROM catalog_items WHERE id=?').get(l.item_id)
        : db.prepare('SELECT * FROM catalog_items WHERE archived=0 AND (supplier_ref=? OR ref=?)').get(String(l.supplier_ref || l.ref || '').trim(), String(l.ref || l.supplier_ref || '').trim());
      if (!it) { unknown.push(l.supplier_ref || l.ref || l.item_id); continue; }
      try { ok.push({ ref: it.ref, ...applyMove({ item_id: it.id, kind: 'entree', qty: l.qty, unit_cost: l.unit_cost ?? null, supplier_id: it.supplier_id, note: req.body.note || null }) }); } catch (e) { unknown.push(`${l.supplier_ref || l.ref} (${e.message})`); }
    }
    log?.('stock', `Réception : ${ok.length} ligne(s)${unknown.length ? `, ${unknown.length} référence(s) inconnue(s)` : ''}`);
    res.json({ received: ok, unknown });
  });

  app.get('/api/stock/moves', (req, res) => {
    const args = []; let sql = `SELECT m.*, ci.label, ci.ref, c.name AS supplier_name FROM stock_moves m JOIN catalog_items ci ON ci.id=m.item_id LEFT JOIN contacts c ON c.id=m.supplier_id`;
    if (req.query.item_id) { sql += ' WHERE m.item_id=?'; args.push(req.query.item_id); }
    sql += ' ORDER BY m.id DESC LIMIT ?'; args.push(Math.min(500, Number(req.query.limit) || 100));
    res.json(db.prepare(sql).all(...args));
  });

  app.post('/api/stock/moves', (req, res) => {
    try {
      const b = req.body; const out = applyMove({ item_id: Number(b.item_id), kind: b.kind, qty: b.qty, unit_cost: b.unit_cost, supplier_id: b.supplier_id ? Number(b.supplier_id) : null, note: String(b.note || '').trim() || null });
      log?.('stock', `${MOVE_KINDS[b.kind]} : ${out.delta > 0 ? '+' : ''}${out.delta} (stock ${out.stock_qty})`);
      res.json(out);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  /** Articles à recommander, regroupés par fournisseur. */
  app.get('/api/stock/reorder', (_req, res) => {
    const rows = list(false).filter((r) => r.status !== 'ok' && (r.stock_min > 0 || r.status === 'rupture'))
      .map((r) => ({ ...r, suggested: Math.max(1, Math.ceil((r.stock_target > 0 ? r.stock_target : Math.max(r.stock_min * 2, 1)) - r.available)) }));
    const groups = {};
    for (const r of rows) { const k = r.supplier_id || 0; (groups[k] ||= { supplier_id: r.supplier_id, supplier_name: r.supplier_name || 'Sans fournisseur', supplier_email: r.supplier_email, items: [] }).items.push(r); }
    res.json(Object.values(groups));
  });

  /** Commande fournisseur : préparée dans la file d'envoi (validation humaine), jamais envoyée directement. */
  app.post('/api/stock/reorder/email', (req, res) => {
    const { supplier_id, lines = [], message } = req.body;
    const sup = db.prepare("SELECT * FROM contacts WHERE id=?").get(supplier_id);
    if (!sup?.email) return res.status(400).json({ error: "Ce fournisseur n'a pas d'adresse e-mail." });
    const items = lines.map((l) => ({ it: db.prepare('SELECT * FROM catalog_items WHERE id=?').get(l.item_id), qty: num(l.qty) })).filter((x) => x.it && x.qty > 0);
    if (!items.length) return res.status(400).json({ error: 'Aucune ligne à commander.' });
    const body = `Bonjour,\n\nPourriez-vous nous préparer la commande suivante, avec votre meilleur prix et le délai de livraison :\n${items.map((x) => `  • ${x.it.ref ? x.it.ref + ' — ' : ''}${x.it.label}${x.it.brand ? ' (' + x.it.brand + ')' : ''} : ${x.qty} ${x.it.unit}`).join('\n')}\n${message ? '\n' + message + '\n' : ''}\nMerci d'avance.\n\nCordialement,`;
    const id = outbox('email_commande', sup.email, 'Commande de matériel', body, `stock_order:${Date.now()}`, null);
    log?.('mail', `Commande fournisseur préparée pour ${sup.name} — à valider`, { contact_id: sup.id });
    res.json({ outbox_id: id });
  });
}
