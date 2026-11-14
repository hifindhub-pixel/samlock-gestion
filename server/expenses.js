// Dépenses réelles par intervention (achats fournisseurs, sous-traitants, main-d'œuvre, divers) : budget prévu vs réel.
import { db, round2 } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'fourniture',      -- fourniture | sous_traitance | main_oeuvre | autre
  supplier TEXT, label TEXT NOT NULL, invoice_ref TEXT,
  date TEXT NOT NULL DEFAULT (date('now')),
  amount_ht REAL NOT NULL DEFAULT 0, vat REAL NOT NULL DEFAULT 20,
  paid INTEGER NOT NULL DEFAULT 0, file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

export const EXPENSE_KINDS = { fourniture: 'Fournitures', sous_traitance: 'Sous-traitance', main_oeuvre: 'Main-d\'œuvre', autre: 'Divers' };

export function expenseTotals(projectId) {
  const rows = db.prepare('SELECT * FROM expenses WHERE project_id=? ORDER BY date DESC, id DESC').all(projectId);
  const by = { fourniture: 0, sous_traitance: 0, main_oeuvre: 0, autre: 0 };
  let ht = 0, ttc = 0, unpaid = 0;
  for (const e of rows) {
    by[e.kind] = round2((by[e.kind] || 0) + e.amount_ht); ht += e.amount_ht; const t = e.amount_ht * (1 + e.vat / 100); ttc += t; if (!e.paid) unpaid += t;
  }
  // main-d'œuvre pointée (module planning) : ajoutée au réel si présente
  let hours = 0, hoursCost = 0;
  try { const h = db.prepare('SELECT COALESCE(SUM(hours),0) h, COALESCE(SUM(hours*rate),0) c FROM timesheets WHERE project_id=?').get(projectId); hours = h.h; hoursCost = round2(h.c); } catch { /* module absent */ }
  by.main_oeuvre = round2(by.main_oeuvre + hoursCost);
  return { rows, by, hours, hours_cost: hoursCost, total_ht: round2(ht + hoursCost), total_ttc: round2(ttc), unpaid_ttc: round2(unpaid) };
}

export function mountExpenses(app, { upload, log }) {
  const load = (id) => db.prepare('SELECT e.*, f.orig_name AS file_name FROM expenses e LEFT JOIN files f ON f.id=e.file_id WHERE e.id=?').get(id);
  const clean = (b) => {
    const kind = Object.keys(EXPENSE_KINDS).includes(b.kind) ? b.kind : 'fourniture';
    const amount = Number(String(b.amount_ht ?? '').replace(',', '.'));
    if (!String(b.label || '').trim()) throw Object.assign(new Error('Indiquez un libellé.'), { status: 400 });
    if (!Number.isFinite(amount) || amount === 0) throw Object.assign(new Error('Montant HT invalide.'), { status: 400 });
    return { kind, supplier: String(b.supplier || '').trim() || null, label: String(b.label).trim(), invoice_ref: String(b.invoice_ref || '').trim() || null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : new Date().toISOString().slice(0, 10), amount_ht: round2(amount),
      vat: Number(String(b.vat ?? '20').replace(',', '.')) || 0, paid: b.paid === true || b.paid === 'true' || b.paid === '1' || b.paid === 1 ? 1 : 0 };
  };
  const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });
  app.get('/api/interventions/:id/expenses', (req, res) => res.json(expenseTotals(Number(req.params.id))));
  app.post('/api/interventions/:id/expenses', upload.single('file'), (req, res) => {
    try {
      const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id); if (!p) return res.sendStatus(404);
      const e = clean(req.body); let fileId = null;
      if (req.file) fileId = db.prepare("INSERT INTO files(project_id,kind,filename,orig_name,mime,size) VALUES(?,?,?,?,?,?)").run(p.id, 'document', req.file.filename, req.file.originalname, req.file.mimetype, req.file.size).lastInsertRowid;
      const id = db.prepare('INSERT INTO expenses(project_id,kind,supplier,label,invoice_ref,date,amount_ht,vat,paid,file_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.id, e.kind, e.supplier, e.label, e.invoice_ref, e.date, e.amount_ht, e.vat, e.paid, fileId).lastInsertRowid;
      log('note', `Dépense ajoutée : ${e.label} (${e.amount_ht.toFixed(2).replace('.', ',')} € HT)`, { contact_id: p.contact_id, project_id: p.id });
      res.json(load(id));
    } catch (e) { fail(res, e); }
  });
  app.put('/api/expenses/:id', upload.single('file'), (req, res) => {
    try {
      const cur = load(req.params.id); if (!cur) return res.sendStatus(404);
      const e = clean({ ...cur, ...req.body }); let fileId = cur.file_id;
      if (req.file) fileId = db.prepare("INSERT INTO files(project_id,kind,filename,orig_name,mime,size) VALUES(?,?,?,?,?,?)").run(cur.project_id, 'document', req.file.filename, req.file.originalname, req.file.mimetype, req.file.size).lastInsertRowid;
      db.prepare('UPDATE expenses SET kind=?,supplier=?,label=?,invoice_ref=?,date=?,amount_ht=?,vat=?,paid=?,file_id=? WHERE id=?').run(e.kind, e.supplier, e.label, e.invoice_ref, e.date, e.amount_ht, e.vat, e.paid, fileId, cur.id);
      res.json(load(cur.id));
    } catch (e) { fail(res, e); }
  });
  app.delete('/api/expenses/:id', (req, res) => { db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id); res.json({ ok: true }); });
}
