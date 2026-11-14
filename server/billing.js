import crypto from 'node:crypto';
import { db, computeQuote, getSettings, round2 } from './db.js';

/** Devis + avenants signés d'une affaire : la base de toute facturation. */
export function signedQuotes(projectId) {
  return db.prepare("SELECT * FROM quotes WHERE project_id=? AND status='signe' ORDER BY id").all(projectId);
}
/** Devis (et avenants) signés d'une affaire, tels qu'ils sont cités sur les factures pour la traçabilité. */
export function quoteRefs(projectId) {
  return signedQuotes(projectId).filter((q) => q.number).map((q) => ({ number: q.number, title: q.title || null, kind: q.kind, signed_at: q.signed_at }));
}
/** Devis liés à une facture : instantané pris à sa création, sinon devis signés actuels de l'affaire (factures reprises). */
export function invoiceQuotes(inv) {
  try { const r = inv.quote_refs ? JSON.parse(inv.quote_refs) : null; if (r?.length) return r; } catch { /* instantané illisible */ }
  return quoteRefs(inv.project_id);
}
export function quoteRefsLabel(refs) { return refs.map((r) => r.number).join(', '); }
export function quoteCalc(qid) {
  const secs = db.prepare('SELECT * FROM sections WHERE quote_id=?').all(qid);
  const lines = db.prepare('SELECT * FROM lines WHERE quote_id=?').all(qid);
  return computeQuote(secs, lines);
}
/** Bases HT par taux de TVA, sur l'ensemble des devis/avenants signés. */
export function contractBases(projectId) {
  const bases = {};
  for (const q of signedQuotes(projectId)) for (const [rate, base] of Object.entries(quoteCalc(q.id).totals.vat)) bases[rate] = round2((bases[rate] || 0) + base);
  return bases;
}
export function invoicedBases(projectId, exceptId = null) {
  const rows = db.prepare(`SELECT il.vat, il.base_ht FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id WHERE i.project_id=? AND i.id IS NOT ?`).all(projectId, exceptId);
  const b = {};
  for (const r of rows) b[r.vat] = round2((b[r.vat] || 0) + r.base_ht);
  return b;
}

/**
 * Génère une facture brouillon.
 *  - acompte   : taux d'acompte du devis principal × bases du contrat
 *  - situation : opts.percent % du contrat
 *  - solde     : tout le contrat moins ce qui a déjà été facturé, par taux de TVA
 */
const insLine = (invoiceId, l) => db.prepare('INSERT INTO invoice_lines(invoice_id,label,base_ht,vat,qty,unit,unit_price,item_id,cost_unit) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(invoiceId, l.label, l.base_ht, l.vat, l.qty ?? 1, l.unit || 'u', l.unit_price ?? null, l.item_id ?? null, l.cost_unit ?? 0);
const totalsOf = (lines) => { const ht = round2(lines.reduce((a, l) => a + l.base_ht, 0)); const tva = round2(lines.reduce((a, l) => a + round2(l.base_ht * (l.vat / 100)), 0)); return { ht, tva, ttc: round2(ht + tva) }; };
const fullyCredited = `NOT EXISTS (SELECT 1 FROM invoices a WHERE a.credit_of=i.id AND -a.total_ttc >= i.total_ttc - 0.01)`;

/** TVA applicable : 10 % pour un particulier (logement de plus de 2 ans), 20 % pour un professionnel. */
export const vatFor = (contact) => (contact?.client_type === 'professionnel' ? 20 : 10);

/**
 * Facture directe, sans devis préalable (dépannage : le prix est annoncé avant d'intervenir et réglé sur place).
 * lines : [{ item_id?, label?, qty, unit_price?, vat?, unit? }]
 */
export function buildDirectInvoice(projectId, lines, opts = {}) {
  const S = getSettings();
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId); if (!project) throw Object.assign(new Error('Intervention introuvable.'), { status: 404 });
  const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(project.contact_id);
  if (!Array.isArray(lines) || !lines.length) throw Object.assign(new Error('Ajoutez au moins une ligne.'), { status: 400 });
  const out = lines.map((l, k) => {
    const it = l.item_id ? db.prepare('SELECT * FROM catalog_items WHERE id=?').get(l.item_id) : null;
    const label = String(l.label || it?.label || '').trim(); if (!label) throw Object.assign(new Error(`Ligne ${k + 1} : désignation manquante.`), { status: 400 });
    const qty = Number(String(l.qty ?? 1).replace(',', '.')); if (!(qty > 0)) throw Object.assign(new Error(`Ligne ${k + 1} : quantité invalide.`), { status: 400 });
    const price = Number(String(l.unit_price ?? it?.price_ht ?? '').replace(',', '.')); if (!Number.isFinite(price)) throw Object.assign(new Error(`Ligne ${k + 1} : prix manquant.`), { status: 400 });
    const vat = l.vat != null && l.vat !== '' ? Number(l.vat) : vatFor(contact, it?.vat ?? Number(S.vat_default));
    const cost = it ? (it.cost_material || 0) + (it.labor_hours || 0) * (it.labor_rate || 0) + (it.cost_sub || 0) : 0;
    return { label, qty, unit: l.unit || it?.unit || 'u', unit_price: price, vat, base_ht: round2(qty * price), item_id: it?.id || null, cost_unit: round2(cost) };
  });
  const t = totalsOf(out);
  const id = db.prepare('INSERT INTO invoices(public_token,project_id,kind,title,total_ht,total_tva,total_ttc,due_at,quote_refs,claim_ref,intervention_date) VALUES(?,?,?,?,?,?,?,date(\'now\',?),?,?,?)')
    .run(crypto.randomBytes(16).toString('hex'), projectId, 'facture', `Facture — ${project.title}`, t.ht, t.tva, t.ttc, `+${Number(S.payment_days || 0)} days`, '[]', String(opts.claim_ref || '').trim() || null, opts.intervention_date || new Date().toISOString().slice(0, 10)).lastInsertRowid;
  for (const l of out) insLine(id, l);
  return loadInvoice(id);
}

export function buildInvoice(projectId, kind, opts = {}) {
  const S = getSettings();
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  const main = db.prepare("SELECT * FROM quotes WHERE project_id=? AND kind='devis' AND status='signe' ORDER BY id LIMIT 1").get(projectId);
  if (!main) throw Object.assign(new Error("Aucun devis signé : rien à facturer."), { status: 400 });
  const contract = contractBases(projectId);
  const done = invoicedBases(projectId);
  let lines = [];
  if (kind === 'facture') {
    if (db.prepare(`SELECT 1 FROM invoices i WHERE i.project_id=? AND i.kind='facture' AND ${fullyCredited}`).get(projectId)) throw Object.assign(new Error('Cette intervention est déjà facturée (créez un avoir pour la refacturer).'), { status: 400 });
    const qids = signedQuotes(projectId).map((q) => q.id);
    const raw = db.prepare(`SELECT l.* FROM lines l JOIN sections s ON s.id=l.section_id WHERE l.quote_id IN (${qids.map(() => '?').join(',')}) ORDER BY l.quote_id, s.position, s.id, l.position, l.id`).all(...qids);
    if (raw.some((l) => l.to_price)) throw Object.assign(new Error('Une ligne du devis est encore « à chiffrer ».'), { status: 400 });
    lines = raw.map((l) => ({ label: l.description ? `${l.label} — ${l.description}` : l.label, qty: l.qty, unit: l.unit, unit_price: l.price_ht, vat: l.vat, base_ht: round2(l.qty * l.price_ht), item_id: l.item_id, cost_unit: round2((l.cost_material || 0) + (l.labor_hours || 0) * (l.labor_rate || 0) + (l.cost_sub || 0)) }));
    const prevNums = db.prepare("SELECT number FROM invoices i WHERE i.project_id=? AND i.kind IN ('acompte','situation') AND number IS NOT NULL ORDER BY id").all(projectId).map((r) => r.number);
    for (const [vat, base] of Object.entries(done)) if (Math.abs(base) > 0.004) lines.push({ label: `À déduire : acompte(s) déjà facturé(s)${prevNums.length ? ' (' + prevNums.join(', ') + ')' : ''}`, qty: 1, unit: 'forfait', unit_price: -base, vat: Number(vat), base_ht: -base });
    if (!lines.length) throw Object.assign(new Error('Rien à facturer.'), { status: 400 });
  } else if (kind === 'acompte') {
    if (db.prepare("SELECT 1 FROM invoices i WHERE i.project_id=? AND i.kind='acompte' AND NOT EXISTS (SELECT 1 FROM invoices a WHERE a.credit_of=i.id AND -a.total_ttc >= i.total_ttc - 0.01)").get(projectId)) throw Object.assign(new Error('Une facture d\'acompte existe déjà pour cette affaire (supprimez le brouillon pour la refaire).'), { status: 400 });
    const pct = Number(opts.percent ?? main.deposit_rate);
    lines = Object.entries(contract).map(([vat, base]) => ({ label: `Acompte de ${pct} % — ${main.title || project.title}`, vat: Number(vat), base_ht: round2((base * pct) / 100) }));
  } else if (kind === 'situation') {
    const pct = Number(opts.percent);
    if (!(pct > 0 && pct <= 100)) throw Object.assign(new Error('Pourcentage d\'avancement invalide.'), { status: 400 });
    lines = Object.entries(contract).map(([vat, base]) => ({ label: `Situation — avancement ${pct} % — ${main.title || project.title}`, vat: Number(vat), base_ht: round2((base * pct) / 100) }));
  } else if (kind === 'solde') {
    lines = Object.entries(contract).map(([vat, base]) => ({ label: `Solde — ${main.title || project.title}`, vat: Number(vat), base_ht: round2(base - (done[vat] || 0)) })).filter((l) => Math.abs(l.base_ht) > 0.004);
    if (!lines.length) throw Object.assign(new Error('Tout est déjà facturé.'), { status: 400 });
  } else throw Object.assign(new Error('Type de facture inconnu.'), { status: 400 });
  const totalHt = round2(lines.reduce((a, l) => a + l.base_ht, 0));
  const totalTva = round2(lines.reduce((a, l) => a + round2(l.base_ht * (l.vat / 100)), 0));
  const id = db.prepare('INSERT INTO invoices(public_token,project_id,kind,title,total_ht,total_tva,total_ttc,due_at,quote_refs,claim_ref,intervention_date) VALUES(?,?,?,?,?,?,?,date(\'now\',?),?,?,?)')
    .run(crypto.randomBytes(16).toString('hex'), projectId, kind, `${{ facture: 'Facture', acompte: 'Facture d\'acompte', situation: 'Facture de situation', solde: 'Facture de solde' }[kind]} — ${project.title}`, totalHt, totalTva, round2(totalHt + totalTva), `+${Number(S.payment_days || 0)} days`, JSON.stringify(quoteRefs(projectId)), String(opts.claim_ref || '').trim() || null, new Date().toISOString().slice(0, 10)).lastInsertRowid;
  for (const l of lines) insLine(id, l);
  return loadInvoice(id);
}

/** Avoir lié à une facture émise (total ou partiel). Montants négatifs : ils s'imputent automatiquement sur le solde. */
export function buildCreditNote(invoiceId, { percent = 100, reason } = {}) {
  const src = loadInvoice(invoiceId);
  if (!src) throw Object.assign(new Error('Facture introuvable.'), { status: 404 });
  if (src.kind === 'avoir') throw Object.assign(new Error("On ne peut pas faire un avoir sur un avoir."), { status: 400 });
  if (!src.number || src.status === 'brouillon') throw Object.assign(new Error("Seule une facture émise peut faire l'objet d'un avoir (supprimez simplement un brouillon)."), { status: 400 });
  if (!String(reason || '').trim()) throw Object.assign(new Error("Indiquez le motif de l'avoir."), { status: 400 });
  const pct = Number(percent); if (!(pct > 0 && pct <= 100)) throw Object.assign(new Error('Pourcentage invalide.'), { status: 400 });
  const already = db.prepare("SELECT COALESCE(SUM(-total_ttc),0) t FROM invoices WHERE credit_of=? AND kind='avoir'").get(invoiceId).t;
  const lines = src.lines.map((l) => ({ label: `Avoir sur ${src.number} — ${l.label}`, vat: l.vat, base_ht: -round2((l.base_ht * pct) / 100) }));
  const totalHt = round2(lines.reduce((a, l) => a + l.base_ht, 0));
  const totalTva = round2(lines.reduce((a, l) => a + round2(l.base_ht * (l.vat / 100)), 0));
  const ttc = round2(totalHt + totalTva);
  if (round2(already - ttc) > round2(src.total_ttc) + 0.01) throw Object.assign(new Error(`Cet avoir dépasse le montant restant à créditer (${round2(src.total_ttc - already)} € TTC).`), { status: 400 });
  const id = db.prepare('INSERT INTO invoices(public_token,project_id,kind,title,total_ht,total_tva,total_ttc,due_at,quote_refs,credit_of,reason) VALUES(?,?,?,?,?,?,?,date(\'now\'),?,?,?)')
    .run(crypto.randomBytes(16).toString('hex'), src.project_id, 'avoir', `Avoir sur facture ${src.number} — ${src.project.title}`, totalHt, totalTva, ttc, src.quote_refs || JSON.stringify(quoteRefs(src.project_id)), invoiceId, String(reason).trim()).lastInsertRowid;
  for (const l of lines) insLine(id, l);
  return loadInvoice(id);
}

export function loadInvoice(id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if (!inv) return null;
  inv.lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY id').all(id);
  inv.project = db.prepare('SELECT * FROM projects WHERE id=?').get(inv.project_id);
  inv.contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(inv.project.contact_id);
  inv.quotes = invoiceQuotes(inv);
  if (inv.credit_of) inv.credit_src = db.prepare('SELECT id,number,issued_at FROM invoices WHERE id=?').get(inv.credit_of);
  inv.previous = db.prepare("SELECT id,number,kind,total_ttc,status FROM invoices WHERE project_id=? AND id<>? AND kind IN ('acompte','situation','avoir') ORDER BY id").all(inv.project_id, id);
  return inv;
}

export function nextInvoiceNumber(kind) {
  // Numérotation propre au logiciel (SAM-2026-0001 ; avoirs SAM-AV-2026-0001), distincte de celle de Tiime (TIIME-…).
  const year = new Date().getFullYear(); const P = kind === 'avoir' ? 'SAM-AV' : 'SAM';
  const last = db.prepare("SELECT number FROM invoices WHERE number LIKE ? ORDER BY number DESC LIMIT 1").get(`${P}-${year}-%`);
  return `${P}-${year}-${String(last ? Number(last.number.split('-').pop()) + 1 : 1).padStart(4, '0')}`;
}
