// Import du catalogue depuis Excel/CSV : modèle, aperçu (rien n'est écrit), puis validation.
import ExcelJS from 'exceljs';

const COLS = [
  { key: 'ref', label: 'Référence', w: 12, alias: ['ref', 'reference', 'référence', 'code'] },
  { key: 'label', label: 'Désignation', w: 48, alias: ['designation', 'désignation', 'libelle', 'libellé', 'article', 'ouvrage'] },
  { key: 'unit', label: 'Unité', w: 9, alias: ['unite', 'unité', 'u'] },
  { key: 'category', label: 'Catégorie', w: 18, alias: ['categorie', 'catégorie', 'corps d\'etat', 'corps d\'état', 'lot'] },
  { key: 'supplier', label: 'Fournisseur', w: 20, alias: ['fournisseur'] },
  { key: 'cost_material', label: 'Coût fourniture (€)', w: 16, alias: ['cout fourniture', 'coût fourniture', 'fourniture', 'prix achat', "prix d'achat", 'achat ht'] },
  { key: 'labor_hours', label: 'Heures main-d\'œuvre', w: 16, alias: ['heures', 'heures main-d\'oeuvre', 'heures mo', 'temps', 'mo (h)'] },
  { key: 'labor_rate', label: 'Taux horaire (€/h)', w: 16, alias: ['taux horaire', 'taux', 'taux mo'] },
  { key: 'cost_sub', label: 'Sous-traitance (€)', w: 16, alias: ['sous-traitance', 'sous traitance', 'cout sous-traitance', 'st'] },
  { key: 'price_ht', label: 'Prix de vente HT (€)', w: 18, alias: ['prix ht', 'prix de vente', 'prix vente ht', 'pv ht', 'pu ht', 'prix unitaire ht'] },
  { key: 'margin_rate', label: 'Marge (%)', w: 11, alias: ['marge', 'marge %', 'taux de marge'] },
  { key: 'vat', label: 'TVA (%)', w: 10, alias: ['tva', 'tva %', 'taux tva'] },
];
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%€ ]/g, ' ').replace(/\s+/g, ' ').trim();
const ALIAS = new Map();
for (const c of COLS) for (const a of [c.label, c.key, ...c.alias]) ALIAS.set(norm(a), c.key);

const cellVal = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') { if (v.result !== undefined) return v.result ?? ''; if (v.richText) return v.richText.map((t) => t.text).join(''); if (v.text) return v.text; if (v instanceof Date) return v.toISOString(); }
  return v;
};
const LBL = Object.fromEntries(COLS.map((c) => [c.key, c.label]));
const toNum = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/\s/g, '').replace('€', '').replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

export async function templateBuffer() {
  const wb = new ExcelJS.Workbook(); wb.creator = 'SAMLOCK Gestion';
  const ws = wb.addWorksheet('Catalogue', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLS.map((c) => ({ header: c.label, key: c.key, width: c.w }));
  const head = ws.getRow(1); head.height = 22;
  head.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFEDEBE0' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C2F24' } }; c.alignment = { vertical: 'middle', wrapText: true }; });
  ws.addRows([
    { ref: 'PEI-001', label: 'Peinture murs : 2 couches acrylique mat, préparation incluse', unit: 'm²', category: 'Peinture', supplier: 'Point P', cost_material: 3.2, labor_hours: 0.28, labor_rate: 45, cost_sub: 0, margin_rate: 35, vat: 10 },
    { ref: 'PLA-004', label: 'Cloison placo BA13 sur ossature 48 mm', unit: 'm²', category: 'Plâtrerie', supplier: '', cost_material: 11.5, labor_hours: 0.55, labor_rate: 45, cost_sub: 0, price_ht: 62, vat: 10 },
  ]);
  const n = wb.addWorksheet('Mode d\'emploi');
  n.getColumn(1).width = 110;
  [
    'Une ligne = un article du catalogue. Seule la Désignation est obligatoire.',
    'Prix de vente : renseignez soit « Prix de vente HT », soit « Marge (%) » (le prix est alors calculé). Sans l\'un ni l\'autre, la marge par défaut des réglages est appliquée.',
    'Marge = (prix de vente − coût de revient) ÷ prix de vente. Coût de revient = fourniture + heures × taux horaire + sous-traitance.',
    'Un article déjà présent (même référence, ou même désignation) est mis à jour et son historique de prix est conservé.',
    'Fournisseur : s\'il n\'existe pas encore, il est créé dans vos contacts.',
    'Les deux lignes d\'exemple de l\'onglet Catalogue sont à supprimer. Vous pouvez aussi importer un fichier CSV.',
  ].forEach((t, i) => { n.getCell(i + 1, 1).value = t; n.getCell(i + 1, 1).alignment = { wrapText: true, vertical: 'top' }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function parseFile(buf, filename = '') {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) {
    const { Readable } = await import('node:stream');
    const text = buf.toString('utf8').replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const delimiter = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    await wb.csv.read(Readable.from([text]), { parserOptions: { delimiter } });
  } else await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Fichier vide');
  // Ligne d'en-tête : première ligne contenant « désignation » ou équivalent
  let headRow = 0, map = {};
  ws.eachRow((row, rn) => {
    if (headRow) return;
    const m = {}; row.eachCell((c, cn) => { const k = ALIAS.get(norm(cellVal(c.value))); if (k && !Object.values(m).includes(k)) m[cn] = k; });
    if (Object.values(m).includes('label')) { headRow = rn; map = m; }
  });
  if (!headRow) throw new Error('Colonne « Désignation » introuvable. Utilisez le modèle fourni.');
  const rows = [];
  ws.eachRow((row, rn) => {
    if (rn <= headRow) return;
    const r = { _line: rn }; let any = false;
    for (const [cn, k] of Object.entries(map)) { const v = cellVal(row.getCell(Number(cn)).value); if (v !== '') any = true; r[k] = v; }
    if (any) rows.push(r);
  });
  return { rows, columns: [...new Set(Object.values(map))] };
}

// Valide chaque ligne et indique ce qui sera créé / mis à jour. N'écrit rien.
export function analyse(rows, { db, defaults }) {
  const items = db.prepare('SELECT id, ref, label FROM catalog_items WHERE archived=0').all();
  const byRef = new Map(items.filter((i) => i.ref).map((i) => [norm(i.ref), i.id]));
  const byLabel = new Map(items.map((i) => [norm(i.label), i.id]));
  const sups = new Map(db.prepare("SELECT id, name, company FROM contacts WHERE kind='fournisseur'").all().flatMap((s) => [[norm(s.name), s.id], ...(s.company ? [[norm(s.company), s.id]] : [])]));
  const seen = new Set();
  return rows.map((raw) => {
    const errors = [], warnings = [];
    const r = {
      line: raw._line, ref: String(raw.ref ?? '').trim() || null, label: String(raw.label ?? '').trim(),
      unit: String(raw.unit ?? '').trim() || 'u', category: String(raw.category ?? '').trim() || null,
      supplier: String(raw.supplier ?? '').trim() || null,
    };
    for (const k of ['cost_material', 'labor_hours', 'labor_rate', 'cost_sub', 'price_ht', 'margin_rate', 'vat']) {
      const n = toNum(raw[k]);
      if (Number.isNaN(n)) { errors.push(`« ${LBL[k]} » n'est pas un nombre`); r[k] = null; } else if (n !== null && n < 0) { errors.push(`« ${LBL[k]} » est négatif`); r[k] = null; } else r[k] = n;
    }
    if (!r.label) errors.push('Désignation manquante');
    if (r.vat != null && ![0, 2.1, 5.5, 10, 20].includes(r.vat)) warnings.push(`TVA ${r.vat} % inhabituelle`);
    if (r.margin_rate != null && r.margin_rate >= 95) errors.push('Marge ≥ 95 %');
    const key = norm(r.ref || r.label);
    if (r.label && seen.has(key)) errors.push('Doublon dans le fichier'); seen.add(key);
    const id = (r.ref && byRef.get(norm(r.ref))) || byLabel.get(norm(r.label)) || null;
    if (r.supplier && !sups.has(norm(r.supplier))) warnings.push(`Fournisseur « ${r.supplier} » sera créé`);
    if (r.price_ht == null && r.margin_rate == null) warnings.push(`Marge par défaut (${defaults.default_margin} %) appliquée`);
    if (r.price_ht != null && r.margin_rate != null) warnings.push('Prix et marge renseignés : le prix est retenu');
    return { ...r, action: errors.length ? 'erreur' : id ? 'mise à jour' : 'création', item_id: id, errors, warnings };
  });
}

export function commit(rows, { db, upsertItem, defaults }) {
  let created = 0, updated = 0, suppliersCreated = 0;
  const sups = new Map(db.prepare("SELECT id, name, company FROM contacts WHERE kind='fournisseur'").all().flatMap((s) => [[norm(s.name), s.id], ...(s.company ? [[norm(s.company), s.id]] : [])]));
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (r.errors?.length) continue;
      let supplier_id;
      if (r.supplier) {
        let sid = sups.get(norm(r.supplier));
        if (!sid) { sid = db.prepare("INSERT INTO contacts(kind,name) VALUES('fournisseur',?)").run(r.supplier).lastInsertRowid; sups.set(norm(r.supplier), sid); suppliersCreated++; }
        supplier_id = sid;
      }
      const b = { ref: r.ref, label: r.label, unit: r.unit, category: r.category };
      if (supplier_id) b.supplier_id = supplier_id;
      for (const k of ['cost_material', 'labor_hours', 'labor_rate', 'cost_sub', 'vat']) if (r[k] != null) b[k] = r[k];
      if (r.price_ht != null) b.price_ht = r.price_ht;
      else if (r.margin_rate != null) b.margin_rate = r.margin_rate;
      else if (!r.item_id) b.margin_rate = Number(defaults.default_margin);
      upsertItem(r.item_id || null, b, 'Import Excel');
      r.item_id ? updated++ : created++;
    }
  });
  tx();
  return { created, updated, suppliersCreated };
}
