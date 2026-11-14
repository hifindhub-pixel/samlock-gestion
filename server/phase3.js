import { payLine } from './payments.js';
import { db, getSettings } from './db.js';
import { PROVIDERS, syncInvoice, exportCsv, exportFec } from './accounting.js';
import { signedQuotes } from './billing.js';

db.exec(`
CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, network TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'brouillon', text TEXT NOT NULL, file_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')), published_at TEXT, published_url TEXT
);`);

const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0).replace(/[  ]/g, ' ');
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const dateFr = (s) => new Date(s).toLocaleDateString('fr-FR');

export function mountPhase3(app, { log, APP_URL }) {
  const outbox = (kind, to, subject, body, refType, refId) =>
    db.prepare('INSERT INTO outbox(kind,to_addr,subject,body,ref_type,ref_id) VALUES(?,?,?,?,?,?)').run(kind, to, subject, body, refType, refId).lastInsertRowid;

  /* ------------------------------------------------------------ Comptabilité */
  app.get('/api/accounting', (_req, res) => {
    const S = getSettings();
    res.json({
      provider: S.accounting_provider, webhook_url: S.accounting_webhook_url,
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, kind: p.kind, ready: p.ready() })),
      sync: db.prepare('SELECT invoice_id,provider,status,error,external_id,synced_at FROM accounting_sync').all(),
    });
  });
  app.get('/api/accounting/export', (req, res) => {
    const y = new Date().getFullYear(); const from = req.query.from || `${y}-01-01`; const to = req.query.to || `${y}-12-31`;
    if (req.query.format === 'fec') { const f = exportFec(from, to); res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${f.name}"` }); return res.send(f.text); }
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="factures-${from}_${to}.csv"` }); res.send(exportCsv(from, to));
  });
  app.post('/api/invoices/:id/sync', async (req, res) => {
    try { await syncInvoice(Number(req.params.id), APP_URL); res.json({ ok: true }); } catch (e) { fail(res, e.status || 500, e.message); }
  });

  /* ------------------------------------------------------------ Réseaux sociaux (brouillons, publication manuelle) */
  const NETS = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', google: 'Google Business' };
  // Génération par modèle (sans IA). Remplaçable plus tard par un appel à un modèle de langage : même entrée, même sortie.
  function composeText({ network, project, sections, kind, S }) {
    const city = project.city ? ` à ${project.city}` : '';
    const works = sections.slice(0, 4).map((s) => `• ${s}`).join('\n');
    const tags = S.social_hashtags + (project.city ? ` #${project.city.replace(/[^\p{L}\d]/gu, '')}` : '');
    const intro = kind === 'avant_apres' ? `Avant / après${city} 👇` : `Intervention terminé${city} ✅`;
    if (network === 'linkedin') return `${intro}\n\n${project.title}.\n${works ? 'Au programme :\n' + works + '\n' : ''}\nMerci à nos équipes et partenaires pour la qualité de l'exécution.\n\n${S.company_name} — ${S.company_phone}\n${tags}`;
    if (network === 'google') return `${intro} ${project.title}. ${works.replaceAll('\n', ' ')} Devis gratuit : ${S.company_phone}.`;
    return `${intro}\n\n${project.title}\n${works}\n\n📞 Votre projet ? Devis gratuit au ${S.company_phone}\n\n${tags}`;
  }
  app.post('/api/interventions/:id/social/draft', (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id); if (!p) return fail(res, 404, 'Introuvable');
    const { network = 'instagram', kind = 'realisation' } = req.body;
    if (!NETS[network]) return fail(res, 400, 'Réseau inconnu.');
    const quotes = signedQuotes(p.id);
    if (!quotes.some((q) => q.photo_auth)) return fail(res, 400, "Le client n'a pas autorisé la publication de photos (case cochée à la signature du devis).");
    const tags = kind === 'avant_apres' ? ['avant', 'apres'] : ['apres'];
    const files = db.prepare(`SELECT id,tag FROM files WHERE project_id=? AND kind='photo' AND tag IN (${tags.map(() => '?').join(',')}) ORDER BY CASE tag WHEN 'avant' THEN 0 ELSE 1 END, id LIMIT 10`).all(p.id, ...tags);
    if (!files.length) return fail(res, 400, kind === 'avant_apres' ? 'Il faut au moins une photo « avant » et une photo « après ».' : 'Aucune photo « après » sur cette intervention.');
    const sections = db.prepare('SELECT DISTINCT s.title FROM sections s WHERE s.quote_id IN (' + quotes.map(() => '?').join(',') + ') ORDER BY s.position').all(...quotes.map((q) => q.id)).map((r) => r.title).filter(Boolean);
    const text = composeText({ network, project: p, sections, kind, S: getSettings() });
    const id = db.prepare('INSERT INTO social_posts(project_id,network,text,file_ids) VALUES(?,?,?,?)').run(p.id, network, text, JSON.stringify(files.map((f) => f.id))).lastInsertRowid;
    res.json({ id });
  });
  app.get('/api/social', (_req, res) => {
    const rows = db.prepare('SELECT s.*, p.title AS project_title, p.city FROM social_posts s JOIN projects p ON p.id=s.project_id ORDER BY s.id DESC').all();
    res.json({ posts: rows.map((r) => ({ ...r, file_ids: JSON.parse(r.file_ids), network_label: NETS[r.network] })), networks: NETS });
  });
  app.put('/api/social/:id', (req, res) => {
    const s = db.prepare('SELECT * FROM social_posts WHERE id=?').get(req.params.id); if (!s) return fail(res, 404, 'Introuvable');
    if (s.status === 'publie') return fail(res, 400, 'Déjà publiée.');
    const ids = Array.isArray(req.body.file_ids) ? req.body.file_ids : JSON.parse(s.file_ids);
    db.prepare("UPDATE social_posts SET text=?, file_ids=?, status='brouillon' WHERE id=?").run(req.body.text ?? s.text, JSON.stringify(ids), s.id); res.json({ ok: true });
  });
  app.post('/api/social/:id/approve', (req, res) => { db.prepare("UPDATE social_posts SET status='approuve' WHERE id=? AND status='brouillon'").run(req.params.id); res.json({ ok: true }); });
  app.post('/api/social/:id/published', (req, res) => {
    const s = db.prepare('SELECT * FROM social_posts WHERE id=?').get(req.params.id); if (s.status !== 'approuve') return fail(res, 400, "Validez d'abord la publication.");
    db.prepare("UPDATE social_posts SET status='publie', published_at=datetime('now'), published_url=? WHERE id=?").run(req.body.url || null, s.id);
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(s.project_id); log('note', `Publication ${NETS[s.network]} publiée`, { contact_id: p.contact_id, project_id: p.id }); res.json({ ok: true });
  });
  app.delete('/api/social/:id', (req, res) => { db.prepare('DELETE FROM social_posts WHERE id=?').run(req.params.id); res.json({ ok: true }); });

  /* ------------------------------------------------------------ Relances (manuelles : rien ne part sans clic puis validation) */
  app.get('/api/reminders', (_req, res) => {
    const quotes = db.prepare(`SELECT q.id, q.number, q.title, q.sent_at, p.title AS project_title, c.name AS contact_name, c.company AS contact_company, c.email,
      CAST(julianday('now') - julianday(q.sent_at) AS INTEGER) AS days FROM quotes q JOIN projects p ON p.id=q.project_id JOIN contacts c ON c.id=p.contact_id
      WHERE q.status IN ('envoye','vu') AND q.sent_at IS NOT NULL AND julianday('now') - julianday(q.sent_at) >= 7 ORDER BY q.sent_at`).all();
    const invoices = db.prepare(`SELECT i.id, i.number, i.kind, i.total_ttc, i.due_at, p.title AS project_title, c.name AS contact_name, c.company AS contact_company, c.email,
      CAST(julianday('now') - julianday(i.due_at) AS INTEGER) AS days_late FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id
      WHERE i.status='envoyee' AND i.due_at < date('now') ORDER BY i.due_at`).all();
    const subs = db.prepare(`SELECT id, name, company, trade, email, decennale_until, urssaf_until FROM contacts WHERE kind='sous_traitant' AND (decennale_until < date('now','+30 day') OR urssaf_until < date('now','+30 day'))`).all();
    const pending = new Set(db.prepare("SELECT ref_type FROM outbox WHERE status='pending' AND ref_type LIKE 'reminder:%'").all().map((r) => r.ref_type));
    res.json({
      quotes: quotes.map((q) => ({ ...q, pending: pending.has(`reminder:quote:${q.id}`) })),
      invoices: invoices.map((i) => ({ ...i, pending: pending.has(`reminder:invoice:${i.id}`) })),
      subs: subs.map((s) => ({ ...s, pending: pending.has(`reminder:sub:${s.id}`) })),
    });
  });
  /** Prépare une relance dans la file de validation. Retourne un message d'erreur, ou null si c'est fait. */
  const prepareReminder = (type, id) => {
    const S = getSettings(); const ref = `reminder:${type}:${id}`;
    if (db.prepare("SELECT 1 FROM outbox WHERE status='pending' AND ref_type=?").get(ref)) return 'Une relance est déjà en attente de validation.';
    const sign = `Cordialement,`;
    if (type === 'quote') {
      const q = db.prepare('SELECT q.*, p.title AS pt, p.contact_id, c.name, c.email FROM quotes q JOIN projects p ON p.id=q.project_id JOIN contacts c ON c.id=p.contact_id WHERE q.id=?').get(id);
      if (!q?.email) return "Pas d'adresse e-mail.";
      outbox('email_relance', q.email, `Votre devis ${q.number} — ${q.pt}`, `Bonjour ${q.name},\n\nJe me permets de revenir vers vous concernant notre devis ${q.number} pour « ${q.pt} », envoyé le ${dateFr(q.sent_at)}.\n\nAvez-vous eu le temps de le consulter ? Je reste disponible pour en discuter ou l'ajuster. Vous pouvez le signer en ligne :\n${APP_URL}/signer/quote/${q.public_token}\n\n${sign}`, ref, q.id);
      log('mail', `Relance du devis ${q.number} préparée — à valider`, { contact_id: q.contact_id, project_id: q.project_id });
    } else if (type === 'invoice') {
      const i = db.prepare('SELECT i.*, p.title AS pt, p.contact_id, c.name, c.email FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id WHERE i.id=?').get(id);
      if (!i?.email) return "Pas d'adresse e-mail.";
      outbox('email_relance', i.email, `Rappel — facture ${i.number}`, `Bonjour ${i.name},\n\nSauf erreur de notre part, la facture ${i.number} (${eur(i.total_ttc)} TTC, « ${i.pt} »), échue le ${dateFr(i.due_at)}, n'a pas encore été réglée.\n\nVous pouvez la retrouver ici : ${APP_URL}/api/public/invoices/${i.public_token}/pdf\nIBAN : ${S.company_iban}${payLine(APP_URL, i.public_token)}\n\nSi le règlement est déjà parti, merci d'ignorer ce message.\n\n${sign}`, ref, i.id);
      log('mail', `Relance de la facture ${i.number} préparée — à valider`, { contact_id: i.contact_id, project_id: i.project_id });
    } else if (type === 'sub') {
      const s = db.prepare('SELECT * FROM contacts WHERE id=?').get(id);
      if (!s?.email) return "Pas d'adresse e-mail.";
      outbox('email_relance', s.email, 'Mise à jour de vos attestations', `Bonjour ${s.name},\n\nVos attestations arrivent à échéance (décennale : ${s.decennale_until ? dateFr(s.decennale_until) : '—'} · vigilance URSSAF : ${s.urssaf_until ? dateFr(s.urssaf_until) : '—'}).\nMerci de nous transmettre les nouvelles versions afin de pouvoir continuer à vous confier des interventions.\n\n${sign}`, ref, s.id);
    } else return 'Type inconnu.';
    return null;
  };
  /** Préparation automatique des relances (jamais envoyées : elles attendent votre validation). Désactivable dans Paramètres. */
  const autoReminders = () => {
    try {
      if (getSettings().auto_reminders === '0') return;
      const recent = (ref) => db.prepare("SELECT 1 FROM outbox WHERE ref_type=? AND created_at > datetime('now','-14 day')").get(ref);
      const inv = db.prepare("SELECT i.id FROM invoices i WHERE i.status='envoyee' AND i.total_ttc > 0 AND i.due_at < date('now','-2 day')").all();
      const qs = db.prepare("SELECT q.id FROM quotes q WHERE q.status IN ('envoye','vu') AND q.sent_at IS NOT NULL AND julianday('now') - julianday(q.sent_at) >= 7").all();
      let n = 0;
      for (const [type, rows] of [['invoice', inv], ['quote', qs]]) for (const r of rows) { if (recent(`reminder:${type}:${r.id}`)) continue; if (!prepareReminder(type, r.id)) n++; }
      if (n) console.log(`Relances préparées automatiquement : ${n} (à valider)`);
    } catch (e) { console.warn('auto-relances', e.message); }
  };
  setTimeout(autoReminders, 60e3); setInterval(autoReminders, 6 * 3600e3);
  app.post('/api/reminders/:type/:id', (req, res) => {
    const err = prepareReminder(req.params.type, req.params.id);
    if (err) return fail(res, 400, err);
    res.json({ ok: true });
  });
}
