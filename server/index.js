import express from 'express';
import compression from 'compression';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR, getSettings, setSettings, computeQuote, computeLine, round2 } from './db.js';
import { renderQuotePdf } from './pdf.js';
import { renderInvoicePdf } from './pdf2.js';
import { loadInvoice, nextInvoiceNumber } from './billing.js';
import { PassThrough } from 'node:stream';
const pdfBuffer = (render, doc) => new Promise((resolve, reject) => { const s = new PassThrough(); const chunks = []; s.on('data', (c) => chunks.push(c)); s.on('end', () => resolve(Buffer.concat(chunks))); s.on('error', reject); try { render(doc, s); } catch (e) { reject(e); } });
import { sendMail } from './mail.js';
import { mountPhase2 } from './phase2.js';
import { mountAuth } from './auth.js';
import { mountPhase3 } from './phase3.js';
import { mountCompta } from './compta.js';
import { mountAgenda } from './agenda.js';
import { mountChat } from './chat.js';
import { mountInbox } from './inbox.js';
import { mountPayments } from './payments.js';
import { mountExpenses } from './expenses.js';
import { mountPlanning } from './planning.js';
import { mountAgent } from './agent.js';
import { mountStock } from './stock.js';
import { mountHistory } from './history.js';
import { mountIk, travelBracket, distanceKm, ikSettings, ikYear } from './ik.js';
import { mountSubs } from './subs.js';
import { mountOuvrages, recomputeParentsOf, ouvrageDescription } from './ouvrages.js';
import { logoFile } from './brand.js';
import { mailConfigured } from './mail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(compression());
const PORT = process.env.PORT || 3001;
const APP_URL = process.env.APP_URL || `http://localhost:${process.env.NODE_ENV === 'production' ? PORT : 5173}`;
const upload = multer({ dest: path.join(DATA_DIR, 'uploads'), limits: { fileSize: 15 * 1024 * 1024 } });
const token = () => crypto.randomBytes(16).toString('hex');
let hooks = {};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { if (req.url.startsWith('/api/public/whatsapp') || req.url.startsWith('/api/public/stripe')) req.rawBody = buf; } }));

// --- Accès protégé par page de connexion (APP_PASSWORD pour activer ; liens publics exclus)
app.set('trust proxy', 1);
mountAuth(app);

const STAGES = ['prospect', 'visite_technique', 'devis_envoye', 'devis_valide', 'intervention_en_cours', 'intervention_terminee', 'devis_refuse'];
const STAGE_LABEL = { prospect: 'Demande', visite_technique: 'À diagnostiquer', devis_envoye: 'Devis envoyé', devis_valide: 'Devis accepté', devis_refuse: 'Devis refusé', intervention_en_cours: 'Intervention en cours', intervention_terminee: 'Terminée' };

const log = (kind, text, { contact_id = null, project_id = null } = {}) =>
  db.prepare('INSERT INTO activities(kind,text,contact_id,project_id) VALUES(?,?,?,?)').run(kind, text, contact_id, project_id);

function setStage(projectId, stage, why) {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!p || p.stage === stage) return;
  db.prepare("UPDATE projects SET stage=?, updated_at=datetime('now') WHERE id=?").run(stage, projectId);
  log('stage', `${STAGE_LABEL[p.stage]} → ${STAGE_LABEL[stage]}${why ? ` (${why})` : ''}`, { contact_id: p.contact_id, project_id: projectId });
  if (stage === 'devis_valide') { const c = db.prepare('SELECT kind FROM contacts WHERE id=?').get(p.contact_id); if (c?.kind === 'prospect') db.prepare("UPDATE contacts SET kind='client' WHERE id=?").run(p.contact_id); }
}

const UNASSIGNED = 'À définir';
function loadQuote(id) {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q) return null;
  q.project = db.prepare('SELECT * FROM projects WHERE id=?').get(q.project_id);
  q.contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(q.project.contact_id);
  q.sections = db.prepare('SELECT * FROM sections WHERE quote_id=? ORDER BY position,id').all(id);
  q.lines = db.prepare('SELECT * FROM lines WHERE quote_id=? ORDER BY position,id').all(id);
  q.calc = computeQuote(q.sections, q.lines);
  q.price_requests = db.prepare('SELECT pr.*, c.name AS supplier_name FROM price_requests pr JOIN contacts c ON c.id=pr.supplier_id WHERE pr.quote_id=? ORDER BY pr.id DESC').all(id);
  return q;
}

const quoteTotals = (qid) => {
  const secs = db.prepare('SELECT * FROM sections WHERE quote_id=?').all(qid);
  const lines = db.prepare('SELECT * FROM lines WHERE quote_id=?').all(qid);
  return computeQuote(secs, lines).totals;
};

/* ------------------------------------------------------------------ Paramètres */
const SECRETS = ['stripe_secret', 'stripe_webhook_secret', 'smtp_pass', 'imap_pass', 'anthropic_api_key', 'whatsapp_token', 'whatsapp_app_secret'];
const publicSettings = () => { const S = getSettings(); const out = { ...S }; for (const k of SECRETS) { delete out[k]; out[`${k}_set`] = !!S[k]; } out.smtp_pass_set = !!S.smtp_pass || !!process.env.SMTP_URL; out.anthropic_api_key_set = !!S.anthropic_api_key || !!process.env.ANTHROPIC_API_KEY; return { ...out, mail_ready: mailConfigured() }; };
// Sauvegarde automatique quotidienne (14 jours conservés) dans DATA_DIR/backups + un instantané avant toute suppression de contact.
const BK_DIR = path.join(DATA_DIR, 'backups');
export function snapshot(tag = 'auto') {
  try {
    fs.mkdirSync(BK_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const f = path.join(BK_DIR, tag === 'auto' ? `samlock-${day}.db` : `samlock-${day}-${tag}-${Date.now()}.db`);
    if (tag === 'auto' && fs.existsSync(f)) return null;
    db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(BK_DIR).filter((n) => n.endsWith('.db')).sort();
    for (const n of old.slice(0, Math.max(0, old.length - 20))) fs.unlinkSync(path.join(BK_DIR, n));
    return f;
  } catch (e) { console.error('Sauvegarde auto impossible :', e.message); return null; }
}
setTimeout(() => snapshot(), 5000); setInterval(() => snapshot(), 6 * 3600e3).unref?.();
if (process.env.NODE_ENV === 'production' && !process.env.APP_PASSWORD) console.warn('⚠ APP_PASSWORD absent : le logiciel est ouvert à toute personne connaissant l\'adresse.');
// Sauvegarde : copie cohérente de la base (SQLite VACUUM INTO), à télécharger depuis Réglages.
app.get('/api/backup', (_q, res) => {
  const tmp = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const day = new Date().toISOString().slice(0, 10);
    res.download(tmp, `samlock-sauvegarde-${day}.db`, () => { try { fs.unlinkSync(tmp); } catch { /* déjà supprimé */ } });
  } catch (e) { try { fs.unlinkSync(tmp); } catch { /* rien à nettoyer */ } res.status(500).json({ error: 'Sauvegarde impossible : ' + e.message }); }
});
app.get('/api/settings', (_q, res) => res.json(publicSettings()));
app.put('/api/settings', (req, res) => { const b = { ...req.body }; for (const k of SECRETS) if (!b[k]) delete b[k]; setSettings(b); res.json(publicSettings()); });
app.get('/api/public/brand/:name.png', (req, res) => { const f = logoFile(req.params.name); if (!f) return res.sendStatus(404); res.set('Cache-Control', 'public, max-age=86400').sendFile(f); });
app.post('/api/settings/test-mail', wrap(async (req, res) => {
  if (!mailConfigured()) return res.status(400).json({ error: "Renseignez d'abord le serveur, l'identifiant et le mot de passe." });
  const to = req.body.to || getSettings().company_email;
  try { await sendMail({ to, subject: 'Test — envoi d\'e-mails opérationnel', body: `Bonjour,\n\nCe message confirme que l'envoi d'e-mails depuis votre logiciel de gestion fonctionne.\n\n${getSettings().company_name}` }); res.json({ ok: true, to }); }
  catch (e) { res.status(502).json({ error: 'Échec : ' + (e.responseCode === 535 ? 'identifiant ou mot de passe refusé par le serveur.' : e.message) }); }
}));

/* ------------------------------------------------------------------ Tableau de bord */
app.get('/api/dashboard', (_req, res) => {
  const projects = db.prepare('SELECT p.*, c.name AS contact_name FROM projects p JOIN contacts c ON c.id=p.contact_id').all();
  const byStage = Object.fromEntries(STAGES.map((s) => [s, { count: 0, amount: 0 }]));
  for (const p of projects) {
    const q = db.prepare("SELECT id FROM quotes WHERE project_id=? AND kind='devis' ORDER BY id DESC LIMIT 1").get(p.id);
    const t = q ? quoteTotals(q.id) : null;
    byStage[p.stage].count++;
    byStage[p.stage].amount += t?.ht || 0;
  }
  const quotes = db.prepare("SELECT id,status FROM quotes WHERE status IN ('envoye','vu','signe') AND imported=0").all();
  let cost = 0, total = 0;
  for (const q of quotes) { const t = quoteTotals(q.id); cost += t.cost; total += t.total; }
  const pendingOutbox = db.prepare("SELECT COUNT(*) n FROM outbox WHERE status='pending'").get().n;
  const pendingPrices = db.prepare("SELECT COUNT(DISTINCT token) n FROM price_requests WHERE status='repondue'").get().n;
  const recent = db.prepare(`SELECT a.*, c.name AS contact_name, p.title AS project_title FROM activities a LEFT JOIN contacts c ON c.id=a.contact_id LEFT JOIN projects p ON p.id=a.project_id ORDER BY a.id DESC LIMIT 12`).all();
  const subs = db.prepare("SELECT id,name,trade,decennale_until,urssaf_until FROM contacts WHERE kind='sous_traitant'").all();
  const inv = db.prepare("SELECT status, total_ttc, due_at FROM invoices WHERE status IN ('envoyee','brouillon')").all();
  const today = new Date().toISOString().slice(0, 10);
  const receivable = round2(inv.filter((i) => i.status === 'envoyee').reduce((a, i) => a + i.total_ttc, 0));
  const overdue = round2(inv.filter((i) => i.status === 'envoyee' && i.due_at && i.due_at < today).reduce((a, i) => a + i.total_ttc, 0));
  const draftInvoices = inv.filter((i) => i.status === 'brouillon').length;
  const ikNow = ikSettings().enabled ? (() => { const y = ikYear(new Date().getFullYear()); return { km: y.totals.km, ik: y.totals.ik, count: y.totals.count }; })() : null;
  const stockAlert = db.prepare("SELECT SUM(CASE WHEN stock_qty<=0 THEN 1 ELSE 0 END) out_n, SUM(CASE WHEN stock_qty>0 AND stock_min>0 AND stock_qty<=stock_min THEN 1 ELSE 0 END) low_n, COUNT(*) n FROM catalog_items WHERE track_stock=1 AND archived=0").get();
  const subsToPay = db.prepare("SELECT COALESCE(SUM(total),0) t, COUNT(*) n FROM assignments WHERE status='accepte' AND done_at IS NOT NULL AND paid_at IS NULL").get();
  res.json({ ik: ikNow, stock: { tracked: stockAlert.n || 0, out: stockAlert.out_n || 0, low: stockAlert.low_n || 0 }, subsToPay, receivable, overdue, draftInvoices, byStage, stages: STAGES, avg_margin: total > 0 ? ((total - cost) / total) * 100 : null, quoted_total: round2(total), pendingOutbox, pendingPrices, recent, subs, settings: publicSettings() });
});

/** Indicateurs de pilotage : CA facturé / encaissé sur 6 mois, taux de signature, délai moyen de signature. */
app.get('/api/dashboard/pilotage', (_req, res) => {
  const months = []; const d = new Date(); d.setDate(1);
  for (let i = 5; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); }
  const billed = Object.fromEntries(db.prepare("SELECT substr(issued_at,1,7) m, SUM(total_ht) v FROM invoices WHERE issued_at IS NOT NULL GROUP BY m").all().map((r) => [r.m, r.v]));
  const cashed = Object.fromEntries(db.prepare("SELECT substr(paid_at,1,7) m, SUM(total_ttc) v FROM invoices WHERE status='payee' AND paid_at IS NOT NULL AND kind<>'avoir' GROUP BY m").all().map((r) => [r.m, r.v]));
  const qs = db.prepare("SELECT id,status,sent_at,signed_at FROM quotes WHERE kind='devis' AND imported=0 AND status IN ('signe','refuse','expire')").all();
  const signed = qs.filter((q) => q.status === 'signe'); const decided = qs.length;
  const days = signed.filter((q) => q.sent_at && q.signed_at).map((q) => (new Date(q.signed_at) - new Date(q.sent_at)) / 864e5).filter((x) => x >= 0);
  res.json({
    months: months.map((m) => ({ m, billed: round2(billed[m] || 0), cashed: round2(cashed[m] || 0) })),
    win_rate: decided ? Math.round((signed.length / decided) * 100) : null, decided,
    avg_sign_days: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
  });
});

/* ------------------------------------------------------------------ Contacts */
app.get('/api/contacts', (req, res) => {
  const { kind, q } = req.query;
  let sql = 'SELECT * FROM contacts WHERE 1=1'; const args = [];
  if (kind && kind !== 'all') { sql += ' AND kind=?'; args.push(kind); }
  if (q) { sql += ' AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ? OR city LIKE ?)'; const l = `%${q}%`; args.push(l, l, l, l, l); }
  sql += ' ORDER BY created_at DESC, id DESC';
  const rows = db.prepare(sql).all(...args);
  const counts = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) n FROM contacts GROUP BY kind').all().map((r) => [r.kind, r.n]));
  res.json({ rows, counts });
});
app.post('/api/contacts', (req, res) => {
  const c = req.body;
  if (!c.name?.trim()) return res.status(400).json({ error: 'Le nom est obligatoire' });
  const r = db.prepare(`INSERT INTO contacts(kind,name,company,email,phone,address,postal,city,source,referrer,notes,siret,trade,decennale_until,urssaf_until,client_type) VALUES(@kind,@name,@company,@email,@phone,@address,@postal,@city,@source,@referrer,@notes,@siret,@trade,@decennale_until,@urssaf_until,@client_type)`)
    .run({ client_type: 'particulier', kind: 'prospect', company: null, email: null, phone: null, address: null, postal: null, city: null, source: null, referrer: null, notes: null, siret: null, trade: null, decennale_until: null, urssaf_until: null, ...c, client_type: c.client_type === 'professionnel' ? 'professionnel' : 'particulier' });
  log('note', `Fiche créée${c.source ? ` (source : ${c.source})` : ''}`, { contact_id: r.lastInsertRowid });
  res.json(db.prepare('SELECT * FROM contacts WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/contacts/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Introuvable' });
  const projects = db.prepare('SELECT * FROM projects WHERE contact_id=? ORDER BY id DESC').all(c.id).map((p) => {
    const quotes = db.prepare('SELECT id,number,status,kind,title,created_at FROM quotes WHERE project_id=? ORDER BY id DESC').all(p.id).map((q) => ({ ...q, totals: quoteTotals(q.id) }));
    return { ...p, quotes };
  });
  const activities = db.prepare('SELECT * FROM activities WHERE contact_id=? ORDER BY id DESC LIMIT 100').all(c.id);
  res.json({ ...c, projects, activities });
});
app.put('/api/contacts/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Introuvable' });
  const n = { ...cur, ...req.body, id: cur.id };
  db.prepare(`UPDATE contacts SET kind=@kind,name=@name,company=@company,email=@email,phone=@phone,address=@address,postal=@postal,city=@city,source=@source,referrer=@referrer,notes=@notes,siret=@siret,trade=@trade,decennale_until=@decennale_until,urssaf_until=@urssaf_until,client_type=@client_type WHERE id=@id`).run({ ...n, client_type: n.client_type === 'professionnel' ? 'professionnel' : 'particulier' });
  if (cur.kind !== n.kind) log('note', `Rubrique : ${cur.kind} → ${n.kind}`, { contact_id: cur.id });
  res.json(n);
});
app.delete('/api/contacts/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Introuvable' });
  // Garde-fou : une facture émise (numérotée) ne se supprime pas, sauf demande explicite ?force=1 (données de test).
  const inv = db.prepare("SELECT COUNT(*) n FROM invoices i JOIN projects p ON p.id=i.project_id WHERE p.contact_id=? AND i.number IS NOT NULL").get(c.id).n;
  if (inv && req.query.force !== '1') return res.status(409).json({ error: `Ce contact a ${inv} facture(s) numérotée(s). La suppression est définitive (obligation de conservation 10 ans).`, needs_force: true, invoices: inv });
  snapshot('avant-suppression');
  db.prepare("DELETE FROM outbox WHERE ref_type='quote' AND ref_id IN (SELECT q.id FROM quotes q JOIN projects p ON p.id=q.project_id WHERE p.contact_id=?)").run(c.id);
  db.prepare('DELETE FROM contacts WHERE id=?').run(c.id); res.json({ ok: true });
});
app.post('/api/contacts/:id/notes', (req, res) => { log('note', req.body.text, { contact_id: Number(req.params.id), project_id: req.body.project_id || null }); res.json({ ok: true }); });

/* ------------------------------------------------------------------ Interventions / pipeline */
app.get('/api/projects', (_req, res) => {
  const rows = db.prepare('SELECT p.*, c.name AS contact_name, c.company AS contact_company, c.phone AS contact_phone, c.source AS contact_source FROM projects p JOIN contacts c ON c.id=p.contact_id ORDER BY p.updated_at DESC').all();
  for (const p of rows) {
    const q = db.prepare("SELECT id,number,status FROM quotes WHERE project_id=? AND kind='devis' ORDER BY id DESC LIMIT 1").get(p.id);
    if (q) { const t = quoteTotals(q.id); p.quote = { ...q, ht: t.ht, margin_pct: t.margin_pct }; }
  }
  res.json({ rows, stages: STAGES, labels: STAGE_LABEL });
});
app.post('/api/projects', (req, res) => {
  const { contact_id, title, address, city, stage } = req.body;
  if (!contact_id || !title?.trim()) return res.status(400).json({ error: 'Contact et intitulé requis' });
  const r = db.prepare('INSERT INTO projects(contact_id,title,address,city,stage) VALUES(?,?,?,?,?)').run(contact_id, title, address || null, city || null, stage || 'prospect');
  log('stage', `Demande créée : ${title}`, { contact_id, project_id: r.lastInsertRowid });
  res.json(db.prepare('SELECT * FROM projects WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/projects/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Introuvable' });
  const { title = cur.title, address = cur.address, city = cur.city } = req.body;
  db.prepare("UPDATE projects SET title=?,address=?,city=?,updated_at=datetime('now') WHERE id=?").run(title, address, city, cur.id);
  if (req.body.stage && STAGES.includes(req.body.stage)) setStage(cur.id, req.body.stage, 'manuel');
  res.json(db.prepare('SELECT * FROM projects WHERE id=?').get(cur.id));
});
app.delete('/api/projects/:id', (req, res) => { db.prepare('DELETE FROM projects WHERE id=?').run(req.params.id); res.json({ ok: true }); });

/* ------------------------------------------------------------------ Catalogue */
const catSql = `SELECT ci.*, (SELECT COUNT(*) FROM catalog_components WHERE parent_id=ci.id) AS n_components, c.name AS supplier_name FROM catalog_items ci LEFT JOIN contacts c ON c.id=ci.supplier_id`;
app.get('/api/catalog', (req, res) => {
  const { q, category } = req.query;
  let sql = `${catSql} WHERE ci.archived=0`; const args = [];
  if (category && category !== 'all') { sql += ' AND ci.category=?'; args.push(category); }
  if (q) { sql += ' AND (ci.label LIKE ? OR ci.ref LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY ci.category, ci.label';
  res.json({ rows: db.prepare(sql).all(...args), categories: db.prepare('SELECT DISTINCT category FROM catalog_items WHERE archived=0 AND category IS NOT NULL ORDER BY category').all().map((r) => r.category) });
});
const costOf = (i) => (Number(i.cost_material) || 0) + (Number(i.labor_hours) || 0) * (Number(i.labor_rate) || 0) + (Number(i.cost_sub) || 0);
function upsertItem(id, b, note) {
  const S = getSettings();
  const base = id ? db.prepare('SELECT * FROM catalog_items WHERE id=?').get(id) : { ref: null, label: '', unit: 'u', category: null, supplier_id: null, cost_material: 0, labor_hours: 0, labor_rate: Number(S.default_labor_rate), cost_sub: 0, price_ht: 0, vat: Number(S.vat_default), brand: null, supplier_ref: null, track_stock: 0, stock_min: 0, stock_target: 0, stock_location: null };
  const n = { ...base, ...b };
  // Si on fournit un taux de marge (marge = (PV - coût) / PV), le prix de vente est recalculé.
  if (b.margin_rate !== undefined && b.margin_rate !== null && b.margin_rate !== '') {
    const m = Math.min(Number(b.margin_rate), 95) / 100; n.price_ht = round2(costOf(n) / (1 - m));
  }
  if (id) {
    db.prepare("UPDATE catalog_items SET ref=?,label=?,unit=?,category=?,supplier_id=?,cost_material=?,labor_hours=?,labor_rate=?,cost_sub=?,price_ht=?,vat=?,brand=?,supplier_ref=?,track_stock=?,stock_min=?,stock_target=?,stock_location=?,updated_at=datetime('now') WHERE id=?")
      .run(n.ref, n.label, n.unit, n.category, n.supplier_id || null, n.cost_material, n.labor_hours, n.labor_rate, n.cost_sub, n.price_ht, n.vat, n.brand || null, n.supplier_ref || null, n.track_stock ? 1 : 0, Number(n.stock_min) || 0, Number(n.stock_target) || 0, n.stock_location || null, id);
  } else {
    id = db.prepare('INSERT INTO catalog_items(ref,label,unit,category,supplier_id,cost_material,labor_hours,labor_rate,cost_sub,price_ht,vat,brand,supplier_ref,track_stock,stock_min,stock_target,stock_location) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(n.ref, n.label, n.unit, n.category, n.supplier_id || null, n.cost_material, n.labor_hours, n.labor_rate, n.cost_sub, n.price_ht, n.vat, n.brand || null, n.supplier_ref || null, n.track_stock ? 1 : 0, Number(n.stock_min) || 0, Number(n.stock_target) || 0, n.stock_location || null).lastInsertRowid;
  }
  if (base.id) recomputeParentsOf(id);
  const changed = !base.id || Number(base.price_ht) !== Number(n.price_ht) || costOf(base) !== costOf(n);
  if (changed) db.prepare('INSERT INTO catalog_history(item_id,price_ht,cost_total,note) VALUES(?,?,?,?)').run(id, n.price_ht, round2(costOf(n)), note || null);
  return db.prepare(`${catSql} WHERE ci.id=?`).get(id);
}
import { templateBuffer, parseFile, analyse, commit as commitCatalog } from './catalog-import.js';
app.get('/api/catalog/template.xlsx', async (_req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modele-catalogue-samlock.xlsx"');
  res.send(await templateBuffer());
});
app.post('/api/catalog/import/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
    const buf = fs.readFileSync(req.file.path); fs.unlink(req.file.path, () => {});
    const { rows } = await parseFile(buf, req.file.originalname);
    if (!rows.length) return res.status(400).json({ error: 'Aucune ligne à importer' });
    if (rows.length > 3000) return res.status(400).json({ error: 'Plus de 3000 lignes : découpez le fichier' });
    const out = analyse(rows, { db, defaults: getSettings() });
    res.json({ rows: out, summary: { total: out.length, create: out.filter((r) => r.action === 'création').length, update: out.filter((r) => r.action === 'mise à jour').length, error: out.filter((r) => r.action === 'erreur').length } });
  } catch (e) { res.status(400).json({ error: `Fichier illisible : ${e.message}` }); }
});
app.post('/api/catalog/import/commit', (req, res) => {
  const rows = (Array.isArray(req.body.rows) ? req.body.rows : []).filter((r) => r.action !== 'erreur' && !r.errors?.length);
  // Ré-analyse côté serveur : on ne fait jamais confiance au client.
  const checked = analyse(rows.map((r) => ({ _line: r.line, ref: r.ref, label: r.label, unit: r.unit, category: r.category, supplier: r.supplier, cost_material: r.cost_material, labor_hours: r.labor_hours, labor_rate: r.labor_rate, cost_sub: r.cost_sub, price_ht: r.price_ht, margin_rate: r.margin_rate, vat: r.vat })), { db, defaults: getSettings() });
  const r = commitCatalog(checked, { db, upsertItem, defaults: getSettings() });
  log?.('catalogue', `Import : ${r.created} créés, ${r.updated} mis à jour`);
  res.json(r);
});
// Efface TOUTES les données métier (démo) en conservant les réglages. Confirmation explicite obligatoire.
app.post('/api/admin/clear-data', (req, res) => {
  if (req.body.confirm !== 'EFFACER') return res.status(400).json({ error: 'Confirmation manquante' });
  const keep = new Set(['settings', 'sqlite_sequence']);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name).filter((n) => !keep.has(n));
  db.pragma('foreign_keys = OFF');
  db.transaction(() => { for (const t of tables) db.exec(`DELETE FROM ${t}`); db.exec("DELETE FROM sqlite_sequence WHERE name != 'settings'"); })();
  db.pragma('foreign_keys = ON');
  const up = path.join(DATA_DIR, 'uploads');
  try { for (const f of fs.readdirSync(up)) fs.unlinkSync(path.join(up, f)); } catch { /* dossier absent */ }
  res.json({ ok: true, tables: tables.length });
});
app.post('/api/catalog', (req, res) => {
  if (!req.body.label?.trim()) return res.status(400).json({ error: 'Désignation obligatoire' });
  const S = getSettings();
  const b = { ...req.body }; if (b.price_ht === undefined && b.margin_rate === undefined) b.margin_rate = S.default_margin;
  res.json(upsertItem(null, b, 'Création'));
});
app.put('/api/catalog/:id', (req, res) => res.json(upsertItem(Number(req.params.id), req.body, 'Modification')));
app.delete('/api/catalog/:id', (req, res) => { db.prepare('UPDATE catalog_items SET archived=1 WHERE id=?').run(req.params.id); res.json({ ok: true }); });
app.get('/api/catalog/:id/history', (req, res) => res.json(db.prepare('SELECT * FROM catalog_history WHERE item_id=? ORDER BY id DESC').all(req.params.id)));

/* ------------------------------------------------------------------ Devis */
app.get('/api/quotes', (_req, res) => {
  const rows = db.prepare(`SELECT q.*, p.title AS project_title, p.stage, c.name AS contact_name, c.company AS contact_company FROM quotes q JOIN projects p ON p.id=q.project_id JOIN contacts c ON c.id=p.contact_id ORDER BY q.id DESC`).all();
  for (const q of rows) { const t = quoteTotals(q.id); q.ht = t.ht; q.ttc = t.ttc; q.margin_pct = t.margin_pct; q.profit = t.costed ? t.profit : null; }
  res.json(rows);
});
app.post('/api/quotes', (req, res) => {
  const S = getSettings();
  let { project_id, kind = 'devis', parent_id = null } = req.body;
  if (!project_id) {
    // Devis sans affaire : on crée une affaire provisoire « à rattacher » (client à définir), à remplacer depuis le devis.
    const c = db.prepare("INSERT INTO contacts(kind,name) VALUES('prospect',?)").run(UNASSIGNED);
    project_id = db.prepare("INSERT INTO projects(contact_id,title,stage) VALUES(?,?,'prospect')").run(c.lastInsertRowid, 'Intervention à définir').lastInsertRowid;
  } else if (!db.prepare('SELECT 1 FROM projects WHERE id=?').get(project_id)) return res.status(404).json({ error: 'Intervention introuvable' });
  const r = db.prepare('INSERT INTO quotes(project_id,kind,parent_id,public_token,validity_days,deposit_rate,title) VALUES(?,?,?,?,?,?,?)')
    .run(project_id, kind, parent_id, token(), Number(S.quote_validity_days), Number(S.deposit_rate), req.body.title || null);
  db.prepare('INSERT INTO sections(quote_id,title,position) VALUES(?,?,0)').run(r.lastInsertRowid, 'Poste 1');
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(project_id);
  log('devis', `Brouillon de ${kind} créé`, { contact_id: p.contact_id, project_id });
  res.json(loadQuote(r.lastInsertRowid));
});
app.get('/api/quotes/:id', (req, res) => { const q = loadQuote(req.params.id); q ? res.json(q) : res.status(404).json({ error: 'Introuvable' }); });
app.put('/api/quotes/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  const n = { ...cur, ...req.body };
  const ret = Math.min(5, Math.max(0, Number(n.retention_pct) || 0)); // loi n°71-584 : 5 % maximum
  const aid = Math.max(0, Number(n.aid_amount) || 0); const aidLabel = aid > 0 ? String(n.aid_label || 'Aide / prime').slice(0, 80) : null;
  if (cur.status === 'signe' && (ret !== (cur.retention_pct || 0) || aid !== (cur.aid_amount || 0))) return res.status(409).json({ error: 'Devis signé : la retenue de garantie et les aides ne peuvent plus changer.' });
  db.prepare('UPDATE quotes SET title=?,intro=?,notes=?,validity_days=?,deposit_rate=?,photo_auth=?,retention_pct=?,aid_label=?,aid_amount=? WHERE id=?').run(n.title, n.intro, n.notes, n.validity_days, n.deposit_rate, n.photo_auth ? 1 : 0, ret, aidLabel, aid, cur.id);
  res.json(loadQuote(cur.id));
});
app.delete('/api/quotes/:id', (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Introuvable' });
  let dropProject = false;
  if (q.status === 'signe') {
    if (!req.query.force) return res.status(409).json({ needs_force: true, error: 'Un devis signé est un document contractuel : confirmation renforcée requise.' });
    const inv = db.prepare("SELECT COUNT(*) n FROM invoices WHERE project_id=? AND number IS NOT NULL").get(q.project_id).n;
    if (inv) return res.status(400).json({ error: `Cette intervention a ${inv} facture(s) numérotée(s) : un devis signé lié à des factures ne peut pas être supprimé (obligation de conservation).` });
    snapshot('avant-suppression-devis-signe');
    dropProject = db.prepare('SELECT COUNT(*) n FROM quotes WHERE project_id=? AND id<>?').get(q.project_id, q.id).n === 0;
  }
  db.prepare("DELETE FROM outbox WHERE ref_type='quote' AND ref_id=? AND status='pending'").run(q.id);
  db.prepare('DELETE FROM quotes WHERE id=?').run(q.id);
  if (dropProject) db.prepare('DELETE FROM projects WHERE id=?').run(q.project_id);
  res.json({ ok: true, project_deleted: dropProject });
});
app.post('/api/quotes/:id/duplicate', (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  const tx = db.transaction(() => {
    const nid = db.prepare('INSERT INTO quotes(project_id,kind,public_token,title,intro,notes,validity_days,deposit_rate) VALUES(?,?,?,?,?,?,?,?)').run(q.project_id, 'devis', token(), q.title, q.intro, q.notes, q.validity_days, q.deposit_rate).lastInsertRowid;
    const map = {};
    for (const s of db.prepare('SELECT * FROM sections WHERE quote_id=? ORDER BY position,id').all(q.id)) map[s.id] = db.prepare('INSERT INTO sections(quote_id,title,position) VALUES(?,?,?)').run(nid, s.title, s.position).lastInsertRowid;
    for (const l of db.prepare('SELECT * FROM lines WHERE quote_id=? ORDER BY position,id').all(q.id))
      db.prepare('INSERT INTO lines(quote_id,section_id,position,item_id,label,description,qty,unit,vat,cost_material,labor_hours,labor_rate,cost_sub,price_ht,to_price) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(nid, map[l.section_id], l.position, l.item_id, l.label, l.description, l.qty, l.unit, l.vat, l.cost_material, l.labor_hours, l.labor_rate, l.cost_sub, l.price_ht, l.to_price);
    return nid;
  });
  res.json(loadQuote(tx()));
});
app.post('/api/quotes/:id/status', (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  const { status } = req.body;
  if (!['brouillon', 'envoye', 'vu', 'signe', 'refuse', 'expire'].includes(status)) return res.status(400).json({ error: 'Statut inconnu' });
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(q.project_id);
  db.prepare('UPDATE quotes SET status=?, signed_at=CASE WHEN ?=\'signe\' THEN datetime(\'now\') ELSE signed_at END WHERE id=?').run(status, status, q.id);
  log('devis', `Devis ${q.number || '#' + q.id} → ${status}`, { contact_id: p.contact_id, project_id: p.id });
  if (status === 'envoye') setStage(p.id, 'devis_envoye', 'devis');
  if (status === 'signe') hooks.onQuoteSigned?.(q.id);
  if (status === 'refuse' || status === 'expire') setStage(p.id, 'devis_refuse', `devis ${status}`);
  res.json(loadQuote(q.id));
});

// Sections
app.post('/api/quotes/:id/sections', (req, res) => {
  const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM sections WHERE quote_id=?').get(req.params.id).p;
  const r = db.prepare('INSERT INTO sections(quote_id,title,position) VALUES(?,?,?)').run(req.params.id, req.body.title || `Poste ${pos + 1}`, pos);
  res.json(db.prepare('SELECT * FROM sections WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/sections/:id', (req, res) => { db.prepare('UPDATE sections SET title=? WHERE id=?').run(req.body.title, req.params.id); res.json({ ok: true }); });
app.delete('/api/sections/:id', (req, res) => { db.prepare('DELETE FROM sections WHERE id=?').run(req.params.id); res.json({ ok: true }); });

// Lignes. Chaque ligne copie les prix du catalogue à l'instant T (A-05 : un devis émis ne bouge jamais).
const LINE_NUM = ['qty', 'cost_material', 'labor_hours', 'labor_rate', 'cost_sub', 'price_ht'];
const VAT_RATES = [0, 2.1, 5.5, 10, 20];
const COST_ONLY = new Set(['cost_material', 'labor_hours', 'labor_rate', 'cost_sub']);
const bad = (m) => Object.assign(new Error(m), { status: 400 });
// Valide/normalise une ligne de devis : nombres finis, TVA légale, ordre de grandeur raisonnable.
function sanitizeLine(n) {
  for (const f of LINE_NUM) {
    const v = Number(n[f] === '' || n[f] == null ? 0 : n[f]);
    if (!Number.isFinite(v)) throw bad(`Valeur invalide pour « ${f} ».`);
    if (Math.abs(v) > 1e9) throw bad(`Valeur trop grande pour « ${f} ».`);
    n[f] = v;
  }
  n.vat = Number(n.vat); if (!VAT_RATES.includes(n.vat)) throw bad('Taux de TVA invalide (0, 2,1, 5,5, 10 ou 20 %).');
  n.label = String(n.label ?? '').slice(0, 500); if (n.description != null) n.description = String(n.description).slice(0, 5000);
  return n;
}
// Un devis signé est contractuel : seuls les coûts internes (marge) restent modifiables ; le reste passe par un avenant.
function guardSigned(quoteId, changedKeys) {
  const q = db.prepare('SELECT status,imported FROM quotes WHERE id=?').get(quoteId);
  if (q?.status !== 'signe') return;
  if (changedKeys && changedKeys.every((k) => COST_ONLY.has(k))) return;
  throw Object.assign(new Error('Ce devis est signé : il ne peut plus être modifié. Créez un avenant.'), { status: 409 });
}
const LINE_FIELDS = ['item_id', 'label', 'description', 'qty', 'unit', 'vat', 'cost_material', 'labor_hours', 'labor_rate', 'cost_sub', 'price_ht', 'to_price'];
app.post('/api/quotes/:id/lines', (req, res) => {
  const S = getSettings();
  const b = req.body; const qid = Number(req.params.id);
  let base = { item_id: null, label: '', description: null, qty: 1, unit: 'u', vat: Number(S.vat_default), cost_material: 0, labor_hours: 0, labor_rate: Number(S.default_labor_rate), cost_sub: 0, price_ht: 0, to_price: 0 };
  if (b.item_id) {
    const it = db.prepare('SELECT * FROM catalog_items WHERE id=?').get(b.item_id);
    base = { ...base, description: ouvrageDescription(it.id), item_id: it.id, label: it.label, unit: it.unit, vat: it.vat, cost_material: it.cost_material, labor_hours: it.labor_hours, labor_rate: it.labor_rate, cost_sub: it.cost_sub, price_ht: it.price_ht };
  }
  guardSigned(qid);
  { // TVA : 10 % pour un particulier, 20 % pour un professionnel (sauf choix explicite sur la ligne)
    const cc = db.prepare('SELECT c.client_type FROM quotes q JOIN projects p ON p.id=q.project_id JOIN contacts c ON c.id=p.contact_id WHERE q.id=?').get(qid);
    if (cc && b.line?.vat == null) base.vat = cc.client_type === 'professionnel' ? 20 : 10;
  }
  const n = sanitizeLine({ ...base, ...b.line });
  const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM lines WHERE section_id=?').get(b.section_id).p;
  const r = db.prepare(`INSERT INTO lines(quote_id,section_id,position,${LINE_FIELDS.join(',')}) VALUES(?,?,?,${LINE_FIELDS.map(() => '?').join(',')})`).run(qid, b.section_id, pos, ...LINE_FIELDS.map((f) => n[f]));
  res.json(db.prepare('SELECT * FROM lines WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/lines/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM lines WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Ligne introuvable.' });
  guardSigned(cur.quote_id, Object.keys(req.body).filter((k) => String(req.body[k] ?? '') !== String(cur[k] ?? '')));
  const n = sanitizeLine({ ...cur, ...req.body });
  db.prepare(`UPDATE lines SET section_id=?,${LINE_FIELDS.map((f) => f + '=?').join(',')} WHERE id=?`).run(n.section_id, ...LINE_FIELDS.map((f) => n[f]), cur.id);
  res.json(db.prepare('SELECT * FROM lines WHERE id=?').get(cur.id));
});
app.delete('/api/lines/:id', (req, res) => { const cl = db.prepare('SELECT quote_id FROM lines WHERE id=?').get(req.params.id); if (cl) guardSigned(cl.quote_id); db.prepare('DELETE FROM lines WHERE id=?').run(req.params.id); res.json({ ok: true }); });
// B-09 : ligne libre → nouvel article de catalogue en 1 clic
app.post('/api/lines/:id/to-catalog', (req, res) => {
  const l = db.prepare('SELECT * FROM lines WHERE id=?').get(req.params.id);
  const it = upsertItem(null, { label: l.label, unit: l.unit, vat: l.vat, cost_material: l.cost_material, labor_hours: l.labor_hours, labor_rate: l.labor_rate, cost_sub: l.cost_sub, price_ht: l.price_ht, category: req.body.category || 'À classer' }, 'Ajouté depuis un devis');
  db.prepare('UPDATE lines SET item_id=? WHERE id=?').run(it.id, l.id);
  res.json(it);
});

/** Ajoute au devis la ligne de déplacement correspondant à la distance siège → lieu d'intervention. */
app.post('/api/quotes/:id/travel', wrap(async (req, res) => {
  const qid = Number(req.params.id); const q = loadQuote(qid); if (!q) return res.status(404).json({ error: 'Introuvable' });
  guardSigned(qid);
  const dest = [q.project.address, q.project.city].filter(Boolean).join(', ') || [q.contact.address, q.contact.postal, q.contact.city].filter(Boolean).join(' ');
  if (!dest.trim()) return res.status(400).json({ error: "Renseignez d'abord l'adresse de l'intervention." });
  const S = getSettings(); const ik = ikSettings(S);
  let d; try { d = await distanceKm(ik.origin, dest, ik.factor); } catch (e) { return res.status(502).json({ error: e.name === 'AbortError' ? 'Service de calcul de distance injoignable.' : e.message }); }
  const b = travelBracket(d.km, S);
  if (b.beyond) return res.status(422).json({ error: `${d.km} km : au-delà des tranches de déplacement. Ajoutez une ligne libre.`, km: d.km });
  if (!b.item) return res.status(422).json({ error: `Article « ${b.ref} » absent du catalogue (déplacement jusqu'à ${b.max} km).`, km: d.km });
  const sec = q.sections[0]?.id || db.prepare('INSERT INTO sections(quote_id,title,position) VALUES(?,?,0)').run(qid, 'Poste 1').lastInsertRowid;
  const it = b.item; const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM lines WHERE section_id=?').get(sec).p;
  const vat = q.contact.client_type === 'professionnel' ? 20 : 10;
  const r = db.prepare(`INSERT INTO lines(quote_id,section_id,position,item_id,label,description,qty,unit,vat,cost_material,labor_hours,labor_rate,cost_sub,price_ht) VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?,?)`)
    .run(qid, sec, pos, it.id, it.label, `Distance ${String(d.km).replace(".", ",")} km depuis ${ik.origin.split(',')[0]}${d.method === 'estimation' ? ' (estimée)' : ''}`, it.unit, vat, it.cost_material, it.labor_hours, it.labor_rate, it.cost_sub, it.price_ht);
  res.json({ line: db.prepare('SELECT * FROM lines WHERE id=?').get(r.lastInsertRowid), km: d.km, method: d.method, bracket: b.max });
}));

// PDF + lien public
app.get('/api/quotes/:id/pdf', (req, res) => {
  const q = loadQuote(req.params.id); if (!q) return res.sendStatus(404);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${q.number || 'devis-brouillon-' + q.id}.pdf"` });
  renderQuotePdf(q, res);
});
app.get('/api/public/quotes/:token/pdf', (req, res) => {
  const id = db.prepare('SELECT id FROM quotes WHERE public_token=?').get(req.params.token)?.id;
  const q = id && loadQuote(id); if (!q) return res.sendStatus(404);
  if (q.status === 'envoye') db.prepare("UPDATE quotes SET status='vu' WHERE id=?").run(id);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${q.number || 'devis'}.pdf"` });
  renderQuotePdf(q, res);
});

// Envoi du devis → file de validation (rien ne part sans clic humain)
// Rattache un devis à une intervention existante, ou à une nouvelle (nouveau client ou client existant).
app.post('/api/quotes/:id/attach', (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Introuvable' });
  if (q.status === 'signe') return res.status(409).json({ error: 'Un devis signé ne peut plus changer d’intervention.' });
  const b = req.body || {};
  const old = db.prepare('SELECT * FROM projects WHERE id=?').get(q.project_id);
  let pid;
  if (b.project_id) {
    if (!db.prepare('SELECT 1 FROM projects WHERE id=?').get(b.project_id)) return res.status(404).json({ error: 'Intervention introuvable' });
    pid = Number(b.project_id);
  } else {
    let cid = b.contact_id ? Number(b.contact_id) : null;
    if (cid && !db.prepare('SELECT 1 FROM contacts WHERE id=?').get(cid)) return res.status(404).json({ error: 'Client introuvable' });
    if (!cid) {
      const nc = b.new_contact || {};
      if (!String(nc.name || '').trim()) return res.status(400).json({ error: 'Le nom du client est obligatoire.' });
      cid = db.prepare("INSERT INTO contacts(kind,name,company,email,phone,city) VALUES('prospect',?,?,?,?,?)")
        .run(String(nc.name).trim(), nc.company || null, nc.email || null, nc.phone || null, nc.city || null).lastInsertRowid;
      log('note', 'Fiche créée depuis un devis', { contact_id: cid });
    }
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: "L’intitulé de l’intervention est obligatoire." });
    pid = db.prepare("INSERT INTO projects(contact_id,title,address,city,stage) VALUES(?,?,?,?,'prospect')").run(cid, title, b.address || null, b.city || null).lastInsertRowid;
    log('stage', `Demande créée : ${title}`, { contact_id: cid, project_id: pid });
  }
  db.prepare('UPDATE quotes SET project_id=? WHERE id=?').run(pid, q.id);
  // Nettoyage de l'affaire provisoire (et de son contact provisoire) si elle est vide.
  if (old && old.id !== pid) {
    const oc = db.prepare('SELECT * FROM contacts WHERE id=?').get(old.contact_id);
    const left = db.prepare('SELECT COUNT(*) n FROM quotes WHERE project_id=?').get(old.id).n;
    if (!left && old.title === 'Intervention à définir' && oc && oc.name === UNASSIGNED) {
      db.prepare('DELETE FROM projects WHERE id=?').run(old.id);
      if (!db.prepare('SELECT 1 FROM projects WHERE contact_id=?').get(oc.id)) db.prepare('DELETE FROM contacts WHERE id=?').run(oc.id);
    }
  }
  res.json(loadQuote(q.id));
});

app.post('/api/quotes/:id/send', (req, res) => {
  const q = loadQuote(req.params.id); const S = getSettings();
  if (q.contact.name === UNASSIGNED) return res.status(400).json({ error: "Rattachez d'abord le devis à un client et à une intervention." });
  if (!q.contact.email) return res.status(400).json({ error: "Le client n'a pas d'adresse e-mail." });
  if (!q.lines.length) return res.status(400).json({ error: 'Le devis est vide.' });
  if (q.lines.some((l) => l.to_price)) return res.status(400).json({ error: 'Des lignes sont encore « à chiffrer ».' });
  const link = `${APP_URL}/signer/quote/${q.public_token}`;
  const r = db.prepare("INSERT INTO outbox(kind,to_addr,subject,body,ref_type,ref_id) VALUES('email_devis',?,?,?,'quote',?)").run(
    q.contact.email,
    `${q.kind === 'avenant' ? 'Avenant' : 'Devis'} ${q.title || q.project.title} – ${S.company_name}`,
    `Bonjour ${q.contact.name},\n\nSuite à notre échange, veuillez trouver votre ${q.kind === 'avenant' ? 'avenant' : 'devis'} pour « ${q.project.title} » (${q.calc.totals.ttc.toFixed(2).replace('.', ',')} € TTC).\n\nVous le trouverez en pièce jointe.\n\nPour l'accepter, merci de le signer électroniquement en cliquant sur ce lien :\n${link}\n\nIl reste valable ${q.validity_days} jours. N'hésitez pas à me contacter pour toute question.\n\nCordialement,`,
    q.id);
  res.json(db.prepare('SELECT * FROM outbox WHERE id=?').get(r.lastInsertRowid));
});

/* ------------------------------------------------------------------ Demandes de prix fournisseurs (B-10) */
app.post('/api/quotes/:id/price-requests', (req, res) => {
  const { line_ids = [], supplier_ids = [], message } = req.body;
  const q = loadQuote(req.params.id); const S = getSettings();
  const lines = q.lines.filter((l) => line_ids.includes(l.id));
  if (!lines.length || !supplier_ids.length) return res.status(400).json({ error: 'Choisissez au moins une ligne et un fournisseur.' });
  const out = [];
  const tx = db.transaction(() => {
    for (const sid of supplier_ids) {
      const sup = db.prepare('SELECT * FROM contacts WHERE id=?').get(sid);
      if (!sup.email) throw Object.assign(new Error(`${sup.name} n'a pas d'adresse e-mail.`), { status: 400 });
      const t = token();
      for (const l of lines) db.prepare("INSERT INTO price_requests(token,quote_id,line_id,supplier_id,label,unit,qty,message,status) VALUES(?,?,?,?,?,?,?,?, 'a_envoyer')").run(t, q.id, l.id, sid, l.label, l.unit, l.qty, message || null);
      const list = lines.map((l) => `  • ${l.label} — ${l.qty} ${l.unit}`).join('\n');
      const o = db.prepare("INSERT INTO outbox(kind,to_addr,subject,body,ref_type,ref_id) VALUES('email_prix',?,?,?,?,?)").run(
        sup.email, `Demande de prix – ${S.company_name}`,
        `Bonjour,\n\nPourriez-vous nous communiquer votre meilleur prix pour :\n${list}\n\n${message ? message + '\n\n' : ''}Répondre en 1 minute (référence, prix, délai) :\n${APP_URL}/fournisseur/${t}\n\nVous pouvez aussi répondre à ce message en joignant votre devis.\n\nMerci,`,
        'price_token:' + t, q.id);
      out.push(o.lastInsertRowid);
    }
  });
  try { tx(); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  res.json({ outbox_ids: out });
});
app.get('/api/public/requests/:token', (req, res) => {
  const rows = db.prepare('SELECT id,label,unit,qty,message,status,answer_ref,answer_label,answer_price,answer_delay,answer_comment FROM price_requests WHERE token=? ORDER BY id').all(req.params.token);
  if (!rows.length) return res.status(404).json({ error: 'Lien invalide' });
  const sup = db.prepare('SELECT c.name FROM price_requests pr JOIN contacts c ON c.id=pr.supplier_id WHERE pr.token=? LIMIT 1').get(req.params.token);
  const S = getSettings();
  res.json({ company: S.company_name, supplier: sup.name, items: rows });
});
app.post('/api/public/requests/:token', upload.single('file'), (req, res) => {
  const answers = JSON.parse(req.body.answers || '[]');
  const rows = db.prepare('SELECT * FROM price_requests WHERE token=?').all(req.params.token);
  if (!rows.length) return res.status(404).json({ error: 'Lien invalide' });
  const tx = db.transaction(() => {
    for (const a of answers) {
      const r = rows.find((x) => x.id === a.id); if (!r || a.price === '' || a.price == null) continue;
      db.prepare("UPDATE price_requests SET status='repondue',answer_ref=?,answer_label=?,answer_price=?,answer_delay=?,answer_comment=?,answer_file=COALESCE(?,answer_file),answered_at=datetime('now') WHERE id=?")
        .run(a.ref || null, a.label || null, Number(String(a.price).replace(',', '.')), a.delay || null, a.comment || null, req.file?.filename || null, r.id);
    }
  });
  tx();
  const q = rows[0].quote_id && db.prepare('SELECT p.contact_id, p.id pid FROM quotes q JOIN projects p ON p.id=q.project_id WHERE q.id=?').get(rows[0].quote_id);
  if (q) log('prix', `Réponse fournisseur reçue (${rows.length} ligne(s)) — à valider`, { contact_id: q.contact_id, project_id: q.pid });
  res.json({ ok: true });
});
app.get('/api/price-requests/pending', (_req, res) => {
  res.json(db.prepare(`SELECT pr.*, c.name AS supplier_name, q.number AS quote_number, p.title AS project_title, l.cost_material AS cur_cost, l.price_ht AS cur_price FROM price_requests pr JOIN contacts c ON c.id=pr.supplier_id LEFT JOIN quotes q ON q.id=pr.quote_id LEFT JOIN projects p ON p.id=q.project_id LEFT JOIN lines l ON l.id=pr.line_id WHERE pr.status='repondue' ORDER BY pr.answered_at DESC`).all());
});
app.get('/api/price-requests/:id/file', (req, res) => {
  const r = db.prepare('SELECT answer_file FROM price_requests WHERE id=?').get(req.params.id);
  if (!r?.answer_file) return res.sendStatus(404);
  res.sendFile(path.join(DATA_DIR, 'uploads', r.answer_file));
});
// Validation humaine : crée l'article de catalogue (prix d'achat, fournisseur, date), applique la marge et complète la ligne.
app.post('/api/price-requests/:id/validate', (req, res) => {
  const S = getSettings();
  const r = db.prepare('SELECT * FROM price_requests WHERE id=?').get(req.params.id);
  const margin = req.body.margin_rate ?? S.default_margin;
  const price = Number(req.body.price ?? r.answer_price);
  const line = r.line_id ? db.prepare('SELECT * FROM lines WHERE id=?').get(r.line_id) : null;
  const tx = db.transaction(() => {
    const item = upsertItem(null, {
      ref: req.body.ref ?? r.answer_ref, label: req.body.label || r.answer_label || r.label, unit: r.unit || 'u', category: req.body.category || 'Fournitures',
      supplier_id: r.supplier_id, cost_material: price, labor_hours: 0, labor_rate: 0, cost_sub: 0, margin_rate: margin, vat: line?.vat ?? Number(S.vat_default),
    }, `Demande de prix – ${r.answer_delay ? 'délai ' + r.answer_delay : 'validée'}`);
    db.prepare("UPDATE price_requests SET status='validee' WHERE id=?").run(r.id);
    if (line) {
      // On garde la main-d'œuvre déjà saisie sur la ligne ; la fourniture et le prix sont mis à jour.
      const nl = { ...line, item_id: item.id, cost_material: price, to_price: 0 };
      const cost = costOf(nl);
      nl.price_ht = round2(cost / (1 - Math.min(Number(margin), 95) / 100));
      db.prepare('UPDATE lines SET item_id=?,cost_material=?,price_ht=?,to_price=0 WHERE id=?').run(nl.item_id, nl.cost_material, nl.price_ht, line.id);
    }
    return item;
  });
  res.json(tx());
});
app.post('/api/price-requests/:id/reject', (req, res) => { db.prepare("UPDATE price_requests SET status='refusee' WHERE id=?").run(req.params.id); res.json({ ok: true }); });

/* ------------------------------------------------------------------ File de validation (messages sortants) */
app.get('/api/outbox', (req, res) => {
  const st = req.query.status || 'pending';
  res.json(db.prepare('SELECT * FROM outbox WHERE status=? ORDER BY id DESC LIMIT 200').all(st));
});
app.put('/api/outbox/:id', (req, res) => { const { subject, body, to_addr } = req.body; db.prepare("UPDATE outbox SET subject=COALESCE(?,subject),body=COALESCE(?,body),to_addr=COALESCE(?,to_addr) WHERE id=? AND status='pending'").run(subject, body, to_addr, req.params.id); res.json(db.prepare('SELECT * FROM outbox WHERE id=?').get(req.params.id)); });
const httpErr = (status, message) => Object.assign(new Error(message), { status });
/** Envoie un message de la file d'envoi (après validation humaine) : pièces jointes, numérotation définitive, suites métier. */
async function approveOutbox(id) {
  const o = db.prepare('SELECT * FROM outbox WHERE id=?').get(id);
  if (!o || o.status !== 'pending') throw httpErr(400, 'Déjà traité');
  // Le PDF joint doit porter son numéro définitif : on l'attribue avant l'envoi, et on l'annule si l'envoi échoue.
  let undo = null; const attachments = [];
  try {
    if (o.ref_type === 'quote') {
      const q0 = db.prepare('SELECT * FROM quotes WHERE id=?').get(o.ref_id);
      if (!q0.number) {
        const year = new Date().getFullYear(); const prefix = q0.kind === 'avenant' ? 'AVN' : 'DEV';
        const last = db.prepare("SELECT number FROM quotes WHERE number LIKE ? ORDER BY number DESC LIMIT 1").get(`${prefix}-${year}-%`);
        const nextN = last ? Number(last.number.split('-')[2]) + 1 : 1;
        db.prepare('UPDATE quotes SET number=? WHERE id=?').run(`${prefix}-${year}-${String(nextN).padStart(4, '0')}`, q0.id);
        undo = () => db.prepare('UPDATE quotes SET number=NULL WHERE id=?').run(q0.id);
      }
      const qq = loadQuote(q0.id); attachments.push({ filename: `${qq.number}.pdf`, content: await pdfBuffer(renderQuotePdf, qq) });
    } else if (o.ref_type?.startsWith('invoice:')) {
      const iid = Number(o.ref_type.split(':')[1]);
      const i0 = db.prepare('SELECT * FROM invoices WHERE id=?').get(iid);
      if (i0 && !i0.number) { db.prepare('UPDATE invoices SET number=? WHERE id=?').run(nextInvoiceNumber(i0.kind), iid); undo = () => db.prepare('UPDATE invoices SET number=NULL WHERE id=?').run(iid); }
      const inv = loadInvoice(iid); if (inv) attachments.push({ filename: `${inv.number || 'facture'}.pdf`, content: await pdfBuffer(renderInvoicePdf, inv) });
    }
    await sendMail({ to: o.to_addr, subject: o.subject, body: o.body, attachments });
  } catch (e) {
    try { undo?.(); } catch { /* numéro déjà libéré */ }
    db.prepare("UPDATE outbox SET status='failed', error=? WHERE id=?").run(String(e.message), o.id); throw httpErr(502, 'Échec d\'envoi : ' + e.message);
  }
  db.prepare("UPDATE outbox SET status='sent', decided_at=datetime('now') WHERE id=?").run(o.id);
  if (o.ref_type === 'quote') {
    const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(o.ref_id);
    if (!q.number) {
      const year = new Date().getFullYear(); const prefix = q.kind === 'avenant' ? 'AVN' : 'DEV';
      const last = db.prepare("SELECT number FROM quotes WHERE number LIKE ? ORDER BY number DESC LIMIT 1").get(`${prefix}-${year}-%`);
      const nextN = last ? Number(last.number.split('-')[2]) + 1 : 1;
      db.prepare('UPDATE quotes SET number=? WHERE id=?').run(`${prefix}-${year}-${String(nextN).padStart(4, '0')}`, q.id);
    }
    db.prepare("UPDATE quotes SET status='envoye', sent_at=datetime('now') WHERE id=?").run(q.id);
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(q.project_id);
    setStage(p.id, 'devis_envoye', 'devis envoyé');
    log('mail', `Devis envoyé à ${o.to_addr}`, { contact_id: p.contact_id, project_id: p.id });
  }
  if (o.ref_type.startsWith('price_token:')) {
    const t = o.ref_type.split(':')[1];
    db.prepare("UPDATE price_requests SET status='envoyee' WHERE token=? AND status='a_envoyer'").run(t);
    const pr = db.prepare('SELECT q.project_id, p.contact_id FROM price_requests pr JOIN quotes q ON q.id=pr.quote_id JOIN projects p ON p.id=q.project_id WHERE pr.token=? LIMIT 1').get(t);
    if (pr) log('prix', `Demande de prix envoyée à ${o.to_addr}`, { contact_id: pr.contact_id, project_id: pr.project_id });
  }
  hooks.afterApprove?.(o);
  return { ok: true };
}
app.post('/api/outbox/:id/approve', wrap(async (req, res) => {
  try { res.json(await approveOutbox(Number(req.params.id))); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));
app.post('/api/outbox/:id/reject', (req, res) => { db.prepare("UPDATE outbox SET status='rejected', decided_at=datetime('now') WHERE id=? AND status='pending'").run(req.params.id); res.json({ ok: true }); });

hooks = mountPhase2(app, { loadQuote, log, setStage, token, APP_URL, upload, approveOutbox });
mountPhase3(app, { log, APP_URL });
mountCompta(app, { upload, log });
mountAgenda(app, { log, APP_URL });
mountChat(app, { quoteTotals });
mountInbox(app);
mountPayments(app, { log, APP_URL });
mountExpenses(app, { upload, log });
mountPlanning(app, { log });
mountAgent(app, { token, log, upload, APP_URL });
mountStock(app, { log, outbox: (kind, to, subject, body, refType, refId) => db.prepare('INSERT INTO outbox(kind,to_addr,subject,body,ref_type,ref_id) VALUES(?,?,?,?,?,?)').run(kind, to, subject, body, refType, refId).lastInsertRowid });
mountIk(app, { log });
mountHistory(app);
mountSubs(app, { log, token, APP_URL });
mountOuvrages(app, { catRow: (id) => db.prepare(`${catSql} WHERE ci.id=?`).get(id) });

/* ------------------------------------------------------------------ Recherche globale (⌘K) */
app.get('/api/search', (req, res) => {
  const l = `%${req.query.q || ''}%`;
  res.json({
    contacts: db.prepare('SELECT id,name,company,kind,city FROM contacts WHERE name LIKE ? OR company LIKE ? OR phone LIKE ? LIMIT 6').all(l, l, l),
    quotes: db.prepare('SELECT q.id,q.number,q.title,p.title AS project_title FROM quotes q JOIN projects p ON p.id=q.project_id WHERE q.number LIKE ? OR q.title LIKE ? OR p.title LIKE ? LIMIT 6').all(l, l, l),
    items: db.prepare('SELECT id,label,ref FROM catalog_items WHERE archived=0 AND (label LIKE ? OR ref LIKE ?) LIMIT 6').all(l, l),
  });
});

/* ------------------------------------------------------------------ Front */
const dist = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use((_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.get('/sw.js', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'sw.js')); });
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '365d' }));
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) return res.status(400).json({ error: 'Données invalides.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Envoi trop volumineux.' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  const m = String(err.message || '');
  // Identifiant inexistant (ligne introuvable puis lecture d'un champ) → 404 propre
  if (err instanceof TypeError && /Cannot read properties of (undefined|null)/.test(m)) { console.warn('404 implicite', req.method, req.originalUrl); return res.status(404).json({ error: 'Élément introuvable.' }); }
  if (/NOT NULL constraint failed|FOREIGN KEY constraint failed|CHECK constraint failed/.test(m)) return res.status(400).json({ error: 'Données incomplètes ou liées à un élément inexistant.' });
  if (/UNIQUE constraint failed/.test(m)) return res.status(409).json({ error: 'Cet élément existe déjà.' });
  console.error(req.method, req.originalUrl, err); res.status(500).json({ error: 'Erreur interne. Réessayez ou contactez le support.' });
});
app.listen(PORT, () => console.log(`SAMLOCK API sur http://localhost:${PORT}`));
