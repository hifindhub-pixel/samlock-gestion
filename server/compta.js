// Rubrique Comptabilité : vue d'ensemble, marges, trésorerie, TVA et banque (import de relevés + rapprochement).
// Rien n'est transmis à l'extérieur : tout est calculé à partir des factures, des dépenses et des relevés importés.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { db, getSettings, round2 } from './db.js';
import { expenseTotals } from './expenses.js';
import { signedQuotes, quoteCalc } from './billing.js';

db.exec(`
CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, label TEXT NOT NULL, amount REAL NOT NULL, balance REAL,
  hash TEXT NOT NULL UNIQUE, source TEXT,
  status TEXT NOT NULL DEFAULT 'new',            -- new | matched | ignored
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bank_date ON bank_transactions(date);
`);

const today = () => new Date().toISOString().slice(0, 10);
const ym = (d) => String(d || '').slice(0, 7);
const addMonths = (ymStr, n) => { const [y, m] = ymStr.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const fail = (res, code, msg) => res.status(code).json({ error: msg });

/* ----------------------------------------------------------- Lecture des relevés (CSV / OFX) */
const stripAccents = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function parseAmount(v) {
  if (v == null) return null; let s = String(v).trim().replace(/[€\s ]/g, '');
  if (!s) return null;
  let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = Number(s); return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
}
function parseDate(v) {
  const s = String(v || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/))) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
function splitCsv(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const sep = [';', '\t', ','].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let cur = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === sep) { cur.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; cur.push(f); f = ''; if (cur.some((x) => x.trim())) rows.push(cur); cur = []; }
    else f += c;
  }
  cur.push(f); if (cur.some((x) => x.trim())) rows.push(cur);
  return rows;
}
export function parseStatement(buf, name = '') {
  let text = buf.toString('utf8'); if (text.includes('�')) text = buf.toString('latin1'); text = text.replace(/^﻿/, '');
  const out = []; const errors = [];
  if (/<OFX>|<STMTTRN>/i.test(text)) {
    for (const blk of text.split(/<STMTTRN>/i).slice(1)) {
      const g = (t) => (blk.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i')) || [])[1]?.trim();
      const date = parseDate(g('DTPOSTED')); const amount = parseAmount(g('TRNAMT'));
      if (!date || amount == null) { errors.push('Ligne OFX illisible'); continue; }
      out.push({ date, amount, label: [g('NAME'), g('MEMO')].filter(Boolean).join(' — ') || 'Opération', balance: null });
    }
    return { rows: out, errors };
  }
  const rows = splitCsv(text); if (rows.length < 2) return { rows: [], errors: ['Fichier vide ou illisible.'] };
  // ligne d'en-têtes = première ligne contenant « date »
  let h = rows.findIndex((r) => r.some((c) => /^date/.test(stripAccents(c).trim())));
  if (h < 0) h = 0;
  const head = rows[h].map((c) => stripAccents(c).trim());
  const idx = (re) => head.findIndex((c) => re.test(c));
  const iDate = idx(/^date( d'?operation| operation| comptable|$)/) >= 0 ? idx(/^date( d'?operation| operation| comptable|$)/) : idx(/date/);
  const iLabel = (() => { const a = head.findIndex((c, i) => i !== iDate && /libelle|label|description|intitule|designation|motif|detail|reference|nom/.test(c)); return a >= 0 ? a : head.findIndex((c, i) => i !== iDate && /operation|tiers|beneficiaire/.test(c)); })();
  const iDebit = idx(/debit|sortie|retrait/); const iCredit = idx(/credit|entree|depot/);
  const iAmount = idx(/^(montant|amount|somme|valeur)/); const iBal = idx(/solde|balance/);
  if (iDate < 0 || (iAmount < 0 && iDebit < 0 && iCredit < 0)) return { rows: [], errors: ['Colonnes introuvables : il faut au minimum une date et un montant (ou débit/crédit).'] };
  for (const r of rows.slice(h + 1)) {
    const date = parseDate(r[iDate]);
    let amount = iAmount >= 0 ? parseAmount(r[iAmount]) : null;
    if (amount == null) { const d = iDebit >= 0 ? parseAmount(r[iDebit]) : null; const c = iCredit >= 0 ? parseAmount(r[iCredit]) : null; if (d != null || c != null) amount = (c || 0) - Math.abs(d || 0); }
    if (!date || amount == null) { if (r.some((x) => x.trim())) errors.push(`Ligne ignorée : ${r.join(' ').slice(0, 60)}`); continue; }
    const label = (iLabel >= 0 ? r[iLabel] : r.filter((_, i) => ![iDate, iAmount, iDebit, iCredit, iBal].includes(i)).join(' ')).replace(/\s+/g, ' ').trim() || 'Opération';
    out.push({ date, amount: round2(amount), label, balance: iBal >= 0 ? parseAmount(r[iBal]) : null });
  }
  return { rows: out, errors: errors.slice(0, 10) };
}

export function mountCompta(app, { upload, log }) {
  /* ---------------------------------------------------------- Vue d'ensemble + séries mensuelles */
  app.get('/api/compta/overview', (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const inv = db.prepare("SELECT * FROM invoices WHERE status<>'brouillon' AND number IS NOT NULL").all();
    const inYear = (d) => String(d || '').startsWith(String(year));
    const issued = inv.filter((i) => inYear(i.issued_at));
    const months = Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, '0')}`);
    const series = months.map((m) => ({ month: m, invoiced_ht: 0, collected_ttc: 0, expenses_ht: 0 }));
    const at = (m) => series[Number(m.slice(5, 7)) - 1];
    for (const i of issued) at(ym(i.issued_at)).invoiced_ht += i.total_ht;
    for (const i of inv.filter((x) => x.status === 'payee' && inYear(x.paid_at))) at(ym(i.paid_at)).collected_ttc += i.total_ttc;
    const exps = db.prepare('SELECT * FROM expenses WHERE date LIKE ?').all(`${year}-%`);
    for (const e of exps) at(ym(e.date)).expenses_ht += e.amount_ht;
    let hoursCost = 0; try { for (const t of db.prepare('SELECT date,hours*rate c FROM timesheets WHERE date LIKE ?').all(`${year}-%`)) { at(ym(t.date)).expenses_ht += t.c; hoursCost += t.c; } } catch { /* planning absent */ }
    const t = today();
    const open = inv.filter((i) => i.status === 'envoyee');
    const invoicedHt = round2(issued.reduce((a, i) => a + i.total_ht, 0));
    const expensesHt = round2(exps.reduce((a, e) => a + e.amount_ht, 0) + hoursCost);
    res.json({
      year, invoiced_ht: invoicedHt, invoiced_ttc: round2(issued.reduce((a, i) => a + i.total_ttc, 0)),
      collected_ttc: round2(inv.filter((i) => i.status === 'payee' && inYear(i.paid_at)).reduce((a, i) => a + i.total_ttc, 0)),
      receivable_ttc: round2(open.reduce((a, i) => a + i.total_ttc, 0)), overdue_ttc: round2(open.filter((i) => i.due_at && i.due_at < t).reduce((a, i) => a + i.total_ttc, 0)),
      expenses_ht: expensesHt, result_ht: round2(invoicedHt - expensesHt),
      unpaid_expenses_ttc: round2(db.prepare('SELECT * FROM expenses WHERE paid=0').all().reduce((a, e) => a + e.amount_ht * (1 + e.vat / 100), 0)),
      series: series.map((s) => ({ ...s, invoiced_ht: round2(s.invoiced_ht), collected_ttc: round2(s.collected_ttc), expenses_ht: round2(s.expenses_ht) })),
    });
  });

  /* ---------------------------------------------------------- Marges par intervention (prévu / réel) */
  app.get('/api/compta/margins', (_req, res) => {
    const rows = db.prepare("SELECT p.id,p.title,p.stage,p.city,c.name AS contact_name,c.company AS contact_company FROM projects p JOIN contacts c ON c.id=p.contact_id WHERE p.stage IN ('devis_valide','intervention_en_cours','intervention_terminee') ORDER BY p.updated_at DESC").all();
    const out = [];
    for (const p of rows) {
      let ht = 0, cost = 0; for (const q of signedQuotes(p.id)) { const c = quoteCalc(q.id).totals; ht += c.total; cost += c.cost; }
      if (!ht) continue;
      const a = expenseTotals(p.id);
      const invoiced = db.prepare("SELECT COALESCE(SUM(total_ht),0) s FROM invoices WHERE project_id=? AND status<>'brouillon'").get(p.id).s;
      const planned_margin = cost > 0 ? round2(ht - cost) : null;
      out.push({ id: p.id, title: p.title, stage: p.stage, who: p.contact_company || p.contact_name, city: p.city, sold_ht: round2(ht), planned_cost: round2(cost), planned_margin,
        planned_margin_pct: planned_margin != null ? round2((planned_margin / ht) * 100) : null, spent_ht: a.total_ht, hours: a.hours,
        real_margin: a.total_ht > 0 ? round2(ht - a.total_ht) : null, real_margin_pct: a.total_ht > 0 ? round2(((ht - a.total_ht) / ht) * 100) : null, invoiced_ht: round2(invoiced), billed_pct: round2((invoiced / ht) * 100) });
    }
    const tracked = out.filter((r) => r.real_margin != null);
    const sold = tracked.reduce((a, r) => a + r.sold_ht, 0);
    res.json({ rows: out, totals: { sold_ht: round2(out.reduce((a, r) => a + r.sold_ht, 0)), planned_margin_pct: (() => { const c = out.filter((r) => r.planned_margin != null); const s = c.reduce((a, r) => a + r.sold_ht, 0); return s ? round2((c.reduce((a, r) => a + r.planned_margin, 0) / s) * 100) : null; })(), real_margin_pct: sold ? round2((tracked.reduce((a, r) => a + r.real_margin, 0) / sold) * 100) : null, tracked: tracked.length } });
  });

  /* ---------------------------------------------------------- Trésorerie : encaissements / décaissements attendus */
  const bankBalance = () => { const r = db.prepare('SELECT balance, date FROM bank_transactions WHERE balance IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1').get(); return r ? { value: r.balance, date: r.date, source: 'relevé importé' } : null; };
  app.get('/api/compta/cashflow', (req, res) => {
    const S = getSettings(); const horizon = Math.min(12, Math.max(1, Number(req.query.months) || 6)); const t = today(); const cur = ym(t);
    const manual = S.treasury_opening !== '' && S.treasury_opening != null && !Number.isNaN(Number(S.treasury_opening)) ? { value: Number(S.treasury_opening), date: S.treasury_opening_date || null, source: 'saisi manuellement' } : null;
    const opening = bankBalance() || manual;
    const months = Array.from({ length: horizon + 3 }, (_, k) => addMonths(cur, k - 3)).map((m) => ({ month: m, in_actual: 0, out_actual: 0, in_expected: 0, out_expected: 0 }));
    const get = (m) => months.find((x) => x.month === m);
    for (const i of db.prepare("SELECT * FROM invoices WHERE status='payee' AND paid_at IS NOT NULL").all()) get(ym(i.paid_at)) && (get(ym(i.paid_at)).in_actual += i.total_ttc);
    for (const e of db.prepare('SELECT * FROM expenses WHERE paid=1').all()) get(ym(e.date)) && (get(ym(e.date)).out_actual += e.amount_ht * (1 + e.vat / 100));
    const late = [];
    for (const i of db.prepare("SELECT i.*, p.title, c.name cn, c.company cc FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id WHERE i.status='envoyee'").all()) {
      let m = ym(i.due_at || i.issued_at || t); if (m < cur) { m = cur; late.push(i.number); } const x = get(m); if (x) x.in_expected += i.total_ttc;
    }
    for (const e of db.prepare('SELECT * FROM expenses WHERE paid=0').all()) { let m = ym(e.date); if (m < cur) m = cur; const x = get(m); if (x) x.out_expected += e.amount_ht * (1 + e.vat / 100); }
    let cum = opening ? opening.value : null;
    const rows = months.map((m) => {
      const past = m.month < cur; const inn = past ? m.in_actual : m.in_actual + m.in_expected; const out = past ? m.out_actual : m.out_actual + m.out_expected;
      const net = inn - out; if (!past && cum != null) cum += m.in_expected - m.out_expected; // le solde actuel contient déjà ce qui est réglé ce mois-ci
      return { month: m.month, past, current: m.month === cur, in: round2(inn), out: round2(out), net: round2(net), cumulative: !past && cum != null ? round2(cum) : null };
    });
    res.json({ opening, rows, late_invoices: late.length, note: "Prévision à partir des échéances des factures envoyées et des dépenses non payées. Les factures en retard sont placées sur le mois en cours." });
  });
  app.put('/api/compta/opening', (req, res) => {
    const v = req.body.value === '' || req.body.value == null ? '' : Number(String(req.body.value).replace(',', '.'));
    if (v !== '' && !Number.isFinite(v)) return fail(res, 400, 'Montant invalide.');
    db.prepare("INSERT INTO settings(key,value) VALUES('treasury_opening',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(v));
    db.prepare("INSERT INTO settings(key,value) VALUES('treasury_opening_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(today());
    res.json({ ok: true });
  });

  /* ---------------------------------------------------------- TVA (estimation, à valider par le comptable) */
  app.get('/api/compta/vat', (req, res) => {
    const y = new Date().getFullYear(); const from = req.query.from || `${y}-01-01`; const to = req.query.to || `${y}-12-31`;
    const coll = {}; const ded = {};
    for (const l of db.prepare("SELECT il.vat, il.base_ht FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id WHERE i.status<>'brouillon' AND i.number IS NOT NULL AND i.issued_at BETWEEN ? AND ?").all(from, to)) {
      const k = String(l.vat); coll[k] ??= { rate: l.vat, base: 0, vat: 0 }; coll[k].base += l.base_ht; coll[k].vat += l.base_ht * l.vat / 100;
    }
    for (const e of db.prepare('SELECT * FROM expenses WHERE date BETWEEN ? AND ?').all(from, to)) { const k = String(e.vat); ded[k] ??= { rate: e.vat, base: 0, vat: 0 }; ded[k].base += e.amount_ht; ded[k].vat += e.amount_ht * e.vat / 100; }
    const fin = (o) => Object.values(o).sort((a, b) => b.rate - a.rate).map((r) => ({ rate: r.rate, base: round2(r.base), vat: round2(r.vat) }));
    const c = fin(coll), d = fin(ded); const tc = round2(c.reduce((a, r) => a + r.vat, 0)), td = round2(d.reduce((a, r) => a + r.vat, 0));
    res.json({ from, to, collected: c, deductible: d, total_collected: tc, total_deductible: td, net: round2(tc - td),
      note: "Estimation sur les factures émises (TVA sur les débits) et les dépenses saisies. Les prestations de services relèvent normalement de la TVA sur les encaissements : à valider avec votre comptable avant toute déclaration." });
  });

  /* ---------------------------------------------------------- Banque : import de relevés et rapprochement */
  const suggest = (t) => {
    const lab = stripAccents(t.label);
    if (t.amount > 0) {
      const cands = db.prepare("SELECT i.id,i.number,i.total_ttc,i.kind,c.name cn,c.company cc FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id WHERE i.status='envoyee'").all();
      const byNum = cands.find((i) => i.number && lab.includes(stripAccents(i.number)));
      const byAmt = cands.filter((i) => Math.abs(i.total_ttc - t.amount) < 0.01);
      const pick = byNum || (byAmt.length === 1 ? byAmt[0] : null);
      if (pick) return { type: 'invoice', id: pick.id, text: `Facture ${pick.number} — ${pick.cc || pick.cn}`, amount: pick.total_ttc, sure: !!byNum || byAmt.length === 1 };
    } else {
      const cands = db.prepare("SELECT e.id,e.label,e.supplier,e.amount_ht,e.vat FROM expenses e WHERE e.paid=0").all().map((e) => ({ ...e, ttc: round2(e.amount_ht * (1 + e.vat / 100)) }));
      const byAmt = cands.filter((e) => Math.abs(e.ttc + t.amount) < 0.01);
      if (byAmt.length === 1) return { type: 'expense', id: byAmt[0].id, text: `Dépense « ${byAmt[0].label} »${byAmt[0].supplier ? ' — ' + byAmt[0].supplier : ''}`, amount: -byAmt[0].ttc, sure: true };
    }
    return null;
  };
  app.get('/api/bank/transactions', (req, res) => {
    const { status = 'all', q = '', from, to } = req.query;
    let sql = 'SELECT * FROM bank_transactions WHERE 1=1'; const args = [];
    if (status !== 'all') { sql += ' AND status=?'; args.push(status); }
    if (from) { sql += ' AND date>=?'; args.push(from); } if (to) { sql += ' AND date<=?'; args.push(to); }
    const rows = db.prepare(sql + ' ORDER BY date DESC, id DESC LIMIT 1000').all(...args).filter((r) => !q || q.split(/\s+/).every((w) => stripAccents(`${r.label} ${r.amount}`).includes(stripAccents(w))));
    for (const r of rows) { if (r.status === 'new') r.suggestion = suggest(r); if (r.invoice_id) r.invoice = db.prepare('SELECT id,number FROM invoices WHERE id=?').get(r.invoice_id); if (r.expense_id) r.expense = db.prepare('SELECT id,label FROM expenses WHERE id=?').get(r.expense_id); }
    const all = db.prepare('SELECT status, COUNT(*) n, COALESCE(SUM(CASE WHEN amount>0 THEN amount END),0) cin, COALESCE(SUM(CASE WHEN amount<0 THEN amount END),0) cout FROM bank_transactions GROUP BY status').all();
    res.json({ rows, counts: Object.fromEntries(all.map((a) => [a.status, a.n])), total: all.reduce((a, x) => a + x.n, 0), balance: bankBalance(),
      candidates: { invoices: db.prepare("SELECT i.id,i.number,i.total_ttc,c.name cn,c.company cc FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id WHERE i.status='envoyee' ORDER BY i.id DESC").all(),
        expenses: db.prepare('SELECT id,label,supplier,amount_ht,vat FROM expenses WHERE paid=0 ORDER BY id DESC').all() } });
  });
  app.post('/api/bank/import', upload.single('file'), (req, res) => {
    if (!req.file) return fail(res, 400, 'Aucun fichier reçu.');
    try {
      const buf = fs.readFileSync(req.file.path); try { fs.unlinkSync(req.file.path); } catch { /* ok */ }
      const { rows, errors } = parseStatement(buf, req.file.originalname);
      if (!rows.length) return fail(res, 400, errors[0] || 'Aucune opération lue dans ce fichier.');
      const ins = db.prepare('INSERT OR IGNORE INTO bank_transactions(date,label,amount,balance,hash,source) VALUES(?,?,?,?,?,?)');
      const seen = new Map(); let added = 0;
      db.transaction(() => {
        for (const r of rows) {
          const base = `${r.date}|${r.label}|${r.amount}`; const n = (seen.get(base) || 0) + 1; seen.set(base, n); // deux opérations identiques le même jour restent distinctes
          const hash = crypto.createHash('sha1').update(`${base}|${n}`).digest('hex');
          added += ins.run(r.date, r.label, r.amount, r.balance, hash, req.file.originalname).changes;
        }
      })();
      log('note', `Relevé bancaire importé : ${added} opération(s) nouvelle(s) sur ${rows.length}`, {});
      res.json({ read: rows.length, added, duplicates: rows.length - added, errors });
    } catch (e) { fail(res, 500, e.message); }
  });
  const getTx = (id) => db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(id);
  app.post('/api/bank/transactions/:id/match', (req, res) => {
    const t = getTx(req.params.id); if (!t) return fail(res, 404, 'Introuvable');
    const { invoice_id, expense_id } = req.body;
    db.transaction(() => {
      if (invoice_id) {
        const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoice_id); if (!inv) throw Object.assign(new Error('Facture introuvable'), { status: 404 });
        if (t.amount <= 0) throw Object.assign(new Error('Un encaissement est attendu pour rapprocher une facture.'), { status: 400 });
        if (inv.status === 'envoyee') db.prepare("UPDATE invoices SET status='payee', paid_at=? WHERE id=?").run(t.date, inv.id);
        db.prepare("UPDATE bank_transactions SET status='matched', invoice_id=?, expense_id=NULL WHERE id=?").run(inv.id, t.id);
        const p = db.prepare('SELECT contact_id FROM projects WHERE id=?').get(inv.project_id); log('devis', `Facture ${inv.number} encaissée le ${t.date} (rapprochement bancaire, ${t.amount.toFixed(2).replace('.', ',')} €)`, { contact_id: p?.contact_id, project_id: inv.project_id });
      } else if (expense_id) {
        const e = db.prepare('SELECT * FROM expenses WHERE id=?').get(expense_id); if (!e) throw Object.assign(new Error('Dépense introuvable'), { status: 404 });
        db.prepare('UPDATE expenses SET paid=1 WHERE id=?').run(e.id);
        db.prepare("UPDATE bank_transactions SET status='matched', expense_id=?, invoice_id=NULL WHERE id=?").run(e.id, t.id);
      } else throw Object.assign(new Error('Indiquez une facture ou une dépense.'), { status: 400 });
    })();
    res.json({ ok: true });
  });
  app.post('/api/bank/transactions/:id/ignore', (req, res) => { db.prepare("UPDATE bank_transactions SET status='ignored', note=? WHERE id=? AND status<>'matched'").run(req.body.note || null, req.params.id); res.json({ ok: true }); });
  app.post('/api/bank/transactions/:id/reset', (req, res) => {
    const t = getTx(req.params.id); if (!t) return fail(res, 404, 'Introuvable');
    db.prepare("UPDATE bank_transactions SET status='new', invoice_id=NULL, expense_id=NULL WHERE id=?").run(t.id); res.json({ ok: true }); // la facture/dépense reste dans son état : à corriger à la main si besoin
  });
  app.delete('/api/bank/transactions', (req, res) => { if (req.body?.confirm !== 'SUPPRIMER') return fail(res, 400, 'Confirmation manquante'); db.prepare('DELETE FROM bank_transactions').run(); res.json({ ok: true }); });
}
