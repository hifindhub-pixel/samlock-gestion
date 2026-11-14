// Sous-traitants (serruriers partenaires, dépanneurs en renfort) : conformité, missions, fin de mission, règlement.
// Un sous-traitant ne voit jamais le prix de vente : seulement le montant convenu pour sa mission.
import { db, getSettings, round2 } from './db.js';

const fail = (res, code, msg) => res.status(code).json({ error: msg });
const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0).replace(/[  ]/g, ' ');
const daysTo = (d) => (d ? Math.ceil((new Date(d + 'T23:59:59') - new Date()) / 864e5) : null);
const docState = (d) => { const n = daysTo(d); return { until: d || null, days: n, state: n == null ? 'absent' : n < 0 ? 'expire' : n <= 30 ? 'bientot' : 'ok' }; };

export function subCompliance(sub) {
  const rc = docState(sub.decennale_until); const urssaf = docState(sub.urssaf_until);
  return { rc, urssaf, ok: rc.state !== 'absent' && rc.state !== 'expire' && urssaf.state !== 'absent' && urssaf.state !== 'expire' };
}

export function mountSubs(app, { log }) {
  const mission = (a) => ({ ...a, items: JSON.parse(a.items || '[]') });

  /** Tableau de bord des sous-traitants : conformité + argent engagé / à payer. */
  app.get('/api/subcontractors', (_req, res) => {
    const subs = db.prepare("SELECT * FROM contacts WHERE kind='sous_traitant' ORDER BY name").all();
    const missions = db.prepare(`SELECT a.*, p.title project_title, p.address project_address, p.city project_city, p.id project_id FROM assignments a JOIN projects p ON p.id=a.project_id ORDER BY a.id DESC`).all().map(mission);
    const rows = subs.map((s) => {
      const ms = missions.filter((m) => m.contact_id === s.id);
      const open = ms.filter((m) => ['envoye', 'accepte'].includes(m.status) && !m.done_at);
      const toPay = ms.filter((m) => m.status === 'accepte' && m.done_at && !m.paid_at);
      const paid = ms.filter((m) => m.paid_at);
      return { ...s, compliance: subCompliance(s), missions: ms, stats: { count: ms.length, open: open.length, to_pay_count: toPay.length, to_pay: round2(toPay.reduce((a, m) => a + m.total, 0)), paid: round2(paid.reduce((a, m) => a + (m.paid_amount ?? m.total), 0)), committed: round2(ms.filter((m) => m.status === 'accepte').reduce((a, m) => a + m.total, 0)) } };
    });
    res.json({
      rows,
      totals: { to_pay: round2(rows.reduce((a, r) => a + r.stats.to_pay, 0)), open: rows.reduce((a, r) => a + r.stats.open, 0), blocked: rows.filter((r) => !r.compliance.ok).length, expiring: rows.filter((r) => r.compliance.ok && (r.compliance.rc.state === 'bientot' || r.compliance.urssaf.state === 'bientot')).length },
    });
  });

  /** Fin de mission (déclarée par le sous-traitant via son lien, ou saisie ici). */
  const markDone = (a, note, by) => {
    if (a.status !== 'accepte') throw Object.assign(new Error("La mission n'a pas encore été acceptée."), { status: 400 });
    if (a.done_at) return;
    db.prepare("UPDATE assignments SET done_at=datetime('now'), done_note=? WHERE id=?").run(String(note || '').trim() || null, a.id);
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(a.project_id); const sub = db.prepare('SELECT * FROM contacts WHERE id=?').get(a.contact_id);
    log?.('prix', `Mission terminée par ${sub.name}${by === 'sub' ? ' (déclarée via son lien)' : ''} — ${eur(a.total)} HT à régler`, { contact_id: p.contact_id, project_id: p.id });
  };
  app.post('/api/assignments/:id/done', (req, res) => {
    const a = db.prepare('SELECT * FROM assignments WHERE id=?').get(req.params.id); if (!a) return fail(res, 404, 'Introuvable');
    try { markDone(a, req.body.note, 'admin'); res.json({ ok: true }); } catch (e) { fail(res, e.status || 500, e.message); }
  });
  app.post('/api/public/assignments/:token/done', (req, res) => {
    const a = db.prepare('SELECT * FROM assignments WHERE token=?').get(req.params.token); if (!a) return fail(res, 404, 'Lien invalide');
    try { markDone(a, req.body.note, 'sub'); if (req.body.invoice_ref) db.prepare('UPDATE assignments SET sub_invoice_ref=? WHERE id=?').run(String(req.body.invoice_ref).trim().slice(0, 60), a.id); res.json({ ok: true }); } catch (e) { fail(res, e.status || 500, e.message); }
  });

  /** Règlement du sous-traitant : enregistré, et répercuté dans les dépenses réelles de l'intervention. */
  app.post('/api/assignments/:id/paid', (req, res) => {
    const a = db.prepare('SELECT * FROM assignments WHERE id=?').get(req.params.id); if (!a) return fail(res, 404, 'Introuvable');
    if (a.status !== 'accepte') return fail(res, 400, "La mission n'a pas été acceptée.");
    if (a.paid_at) return fail(res, 400, 'Déjà réglée.');
    const amount = Number(String(req.body.amount ?? a.total).replace(',', '.')); if (!(amount > 0)) return fail(res, 400, 'Montant invalide.');
    const vat = req.body.vat === undefined || req.body.vat === '' ? 0 : Number(req.body.vat); if (![0, 5.5, 10, 20].includes(vat)) return fail(res, 400, 'TVA invalide.');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : new Date().toISOString().slice(0, 10);
    const METHODS = ['virement', 'especes', 'cheque', 'cb', 'autre']; const method = METHODS.includes(req.body.method) ? req.body.method : 'virement';
    const ref = String(req.body.invoice_ref ?? a.sub_invoice_ref ?? '').trim() || null;
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(a.project_id); const sub = db.prepare('SELECT * FROM contacts WHERE id=?').get(a.contact_id);
    db.transaction(() => {
      db.prepare('UPDATE assignments SET paid_at=?, paid_amount=?, paid_method=?, sub_invoice_ref=COALESCE(?,sub_invoice_ref), done_at=COALESCE(done_at,datetime(\'now\')) WHERE id=?').run(date, round2(amount), method, ref, a.id);
      db.prepare("INSERT INTO expenses(project_id,kind,supplier,label,invoice_ref,date,amount_ht,vat,paid) VALUES(?,?,?,?,?,?,?,?,1)").run(a.project_id, 'sous_traitance', sub.company || sub.name, `Sous-traitance — ${p.title}`, ref, date, round2(amount), vat);
    })();
    log?.('prix', `Sous-traitant ${sub.name} réglé : ${eur(amount)} HT`, { contact_id: p.contact_id, project_id: p.id });
    res.json({ ok: true });
  });
}
