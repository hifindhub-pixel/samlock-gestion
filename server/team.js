// Espace intervenant (sous-traitant) : accès personnel par lien, interventions, devis à faire signer, bons d'intervention,
// et suivi des revenus. Règle de partage : le sous-traitant touche COMMISSION % (60 par défaut) du gain réel
// = chiffre d'affaires HT encaissable − marchandises ; SAMLOCK garde le solde (40 %).
import crypto from 'node:crypto';
import { db, getSettings, round2 } from './db.js';
import { buildDirectInvoice } from './billing.js';
import { consumption } from './stock.js';

const addCol = (table, col, def) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };
addCol('contacts', 'portal_token', 'TEXT');
addCol('contacts', 'commission_pct', 'REAL');
addCol('projects', 'sub_id', 'INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS sub_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sub_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  amount REAL NOT NULL, date TEXT NOT NULL DEFAULT (date('now')), method TEXT, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const fail = (res, code, msg) => res.status(code).json({ error: msg });
const num = (v) => Number(String(v ?? '').replace(',', '.'));
export const commissionOf = (sub) => { const c = sub.commission_pct != null ? Number(sub.commission_pct) : Number(getSettings().sub_commission_pct); return Number.isFinite(c) && c >= 0 && c <= 100 ? c : 60; };

/** Coût marchandises estimé d'une ligne : pièces consommées (composition de stock) au coût moyen, sinon coût matière de l'article. */
function goodsOfLine(itemId, qty, fallbackMaterial = 0) {
  if (!itemId) return round2((fallbackMaterial || 0) * qty);
  const parts = consumption(itemId, qty);
  if (parts.size) { let t = 0; for (const [pid, q] of parts) t += (db.prepare('SELECT cost_material FROM catalog_items WHERE id=?').get(pid)?.cost_material || 0) * q; return round2(t); }
  return round2((db.prepare('SELECT cost_material FROM catalog_items WHERE id=?').get(itemId)?.cost_material || fallbackMaterial || 0) * qty);
}

/** Revenus d'une intervention : CA HT émis (net d'avoirs), part encaissée, marchandises, gain réel, parts. */
export function projectEarnings(projectId, pct) {
  const invs = db.prepare("SELECT * FROM invoices WHERE project_id=? AND kind<>'avoir' AND status IN ('envoyee','payee')").all(projectId);
  let revenue = 0; let paid = 0;
  for (const i of invs) {
    const credit = db.prepare("SELECT COALESCE(SUM(total_ht),0) t FROM invoices WHERE credit_of=? AND kind='avoir' AND status<>'brouillon'").get(i.id).t;
    const net = round2(i.total_ht + credit); revenue += net; if (i.status === 'payee') paid += net;
  }
  revenue = round2(revenue); paid = round2(paid);
  const real = db.prepare("SELECT COALESCE(SUM(amount_ht),0) t FROM expenses WHERE project_id=? AND kind IN ('fourniture','autre')").get(projectId).t;
  let est = 0;
  const direct = db.prepare("SELECT il.item_id, il.qty FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id WHERE i.project_id=? AND i.kind<>'avoir' AND i.status IN ('envoyee','payee') AND il.item_id IS NOT NULL").all(projectId);
  if (direct.length) for (const l of direct) est += goodsOfLine(l.item_id, l.qty);
  else for (const l of db.prepare("SELECT l.item_id, l.qty, l.cost_material FROM lines l JOIN quotes q ON q.id=l.quote_id WHERE q.project_id=? AND q.status='signe'").all(projectId)) est += goodsOfLine(l.item_id, l.qty, l.cost_material);
  est = round2(est);
  const goods = round2(real > 0 ? real : est);
  const gain = round2(revenue - goods); const share = round2(Math.max(0, gain) * pct / 100);
  const ratio = revenue > 0 ? paid / revenue : 0;
  return { revenue_ht: revenue, paid_ht: paid, due_ht: round2(revenue - paid), goods, goods_source: real > 0 ? 'reel' : 'estime', gain, share, share_paid: round2(share * ratio), share_due: round2(share * (1 - ratio)), samlock_share: round2(Math.max(0, gain) - share) };
}

export function subEarnings(sub) {
  const pct = commissionOf(sub);
  const projects = db.prepare('SELECT p.*, c.name cname, c.company ccompany, c.phone cphone FROM projects p JOIN contacts c ON c.id=p.contact_id WHERE p.sub_id=? ORDER BY p.id DESC').all(sub.id);
  const rows = projects.map((p) => ({ project_id: p.id, title: p.title, client: p.ccompany || p.cname, address: [p.address, p.city].filter(Boolean).join(', '), stage: p.stage, ...projectEarnings(p.id, pct) }));
  const sum = (k) => round2(rows.reduce((a, r) => a + r[k], 0));
  const payouts = db.prepare('SELECT * FROM sub_payouts WHERE sub_id=? ORDER BY date DESC, id DESC').all(sub.id);
  const reversed = round2(payouts.reduce((a, p) => a + p.amount, 0));
  const totals = { revenue_ht: sum('revenue_ht'), goods: sum('goods'), gain: sum('gain'), share: sum('share'), share_paid: sum('share_paid'), share_due: sum('share_due'), samlock_share: sum('samlock_share'), reversed, to_reverse: round2(Math.max(0, sum('share_paid') - reversed)) };
  return { pct, rows, totals, payouts };
}

export function mountTeam(app, { log, setStage, token }) {
  const subByToken = (t) => (t ? db.prepare("SELECT * FROM contacts WHERE kind='sous_traitant' AND portal_token=?").get(t) : null);
  const mine = (sub, pid) => db.prepare('SELECT * FROM projects WHERE id=? AND sub_id=?').get(pid, sub.id);
  const guard = (req, res) => { const s = subByToken(req.params.token); if (!s) { fail(res, 404, 'Lien invalide.'); return null; } return s; };

  function createQuote(project, lines) {
    const S = getSettings(); const clean = (Array.isArray(lines) ? lines : []).slice(0, 60);
    if (!clean.length) throw Object.assign(new Error('Choisissez au moins une prestation.'), { status: 400 });
    const qid = db.prepare('INSERT INTO quotes(project_id,kind,public_token,validity_days,deposit_rate,title) VALUES(?,?,?,?,?,?)').run(project.id, 'devis', token(), Number(S.quote_validity_days), Number(S.deposit_rate), project.title).lastInsertRowid;
    const sid = db.prepare('INSERT INTO sections(quote_id,title,position) VALUES(?,?,0)').run(qid, 'Travaux').lastInsertRowid;
    const ins = db.prepare('INSERT INTO lines(quote_id,section_id,position,item_id,label,description,qty,unit,vat,cost_material,labor_hours,labor_rate,cost_sub,price_ht,to_price) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)');
    clean.forEach((l, n) => {
      const it = db.prepare('SELECT * FROM catalog_items WHERE id=? AND archived=0').get(Number(l.item_id)); if (!it) throw Object.assign(new Error(`Prestation ${n + 1} introuvable.`), { status: 400 });
      const qty = num(l.qty ?? 1); if (!(qty > 0)) throw Object.assign(new Error(`Quantité invalide (${it.label}).`), { status: 400 });
      const price = l.unit_price != null && l.unit_price !== '' ? num(l.unit_price) : it.price_ht; if (!(price >= 0)) throw Object.assign(new Error(`Prix invalide (${it.label}).`), { status: 400 });
      ins.run(qid, sid, n, it.id, it.label, null, qty, it.unit, it.vat, it.cost_material, it.labor_hours, it.labor_rate, it.cost_sub, price);
    });
    return qid;
  }
  const presentQuote = (qid) => {
    const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(qid);
    if (!q.number) {
      const year = new Date().getFullYear(); const last = db.prepare('SELECT number FROM quotes WHERE number LIKE ? ORDER BY number DESC LIMIT 1').get(`DEV-${year}-%`);
      db.prepare('UPDATE quotes SET number=? WHERE id=?').run(`DEV-${year}-${String(last ? Number(last.number.split('-')[2]) + 1 : 1).padStart(4, '0')}`, q.id);
    }
    db.prepare("UPDATE quotes SET status='envoye', sent_at=datetime('now') WHERE id=? AND status IN ('brouillon','envoye','vu')").run(q.id);
    setStage(q.project_id, 'devis_envoye', 'devis présenté sur place');
    return db.prepare('SELECT * FROM quotes WHERE id=?').get(qid);
  };

  /* ---------------------------------------------------------------- Administration (côté SAMLOCK) */
  app.post('/api/subcontractors/:id/portal', (req, res) => {
    const s = db.prepare("SELECT * FROM contacts WHERE id=? AND kind='sous_traitant'").get(req.params.id); if (!s) return fail(res, 404, 'Sous-traitant introuvable.');
    if (req.body.commission_pct !== undefined && req.body.commission_pct !== '') {
      const c = num(req.body.commission_pct); if (!(c >= 0 && c <= 100)) return fail(res, 400, 'Commission invalide (0 à 100 %).');
      db.prepare('UPDATE contacts SET commission_pct=? WHERE id=?').run(c, s.id);
    }
    if (req.body.regenerate || !s.portal_token) db.prepare('UPDATE contacts SET portal_token=? WHERE id=?').run(token(), s.id);
    if (req.body.disable) db.prepare('UPDATE contacts SET portal_token=NULL WHERE id=?').run(s.id);
    const n = db.prepare('SELECT * FROM contacts WHERE id=?').get(s.id);
    res.json({ portal_token: n.portal_token, commission_pct: commissionOf(n) });
  });
  app.get('/api/subcontractors/:id/earnings', (req, res) => {
    const s = db.prepare("SELECT * FROM contacts WHERE id=? AND kind='sous_traitant'").get(req.params.id); if (!s) return fail(res, 404, 'Sous-traitant introuvable.');
    res.json({ portal_token: s.portal_token, ...subEarnings(s) });
  });
  app.post('/api/subcontractors/:id/payouts', (req, res) => {
    const s = db.prepare("SELECT * FROM contacts WHERE id=? AND kind='sous_traitant'").get(req.params.id); if (!s) return fail(res, 404, 'Sous-traitant introuvable.');
    const amount = num(req.body.amount); if (!(amount > 0)) return fail(res, 400, 'Montant invalide.');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : new Date().toISOString().slice(0, 10);
    db.prepare('INSERT INTO sub_payouts(sub_id,amount,date,method,note) VALUES(?,?,?,?,?)').run(s.id, round2(amount), date, req.body.method || 'virement', String(req.body.note || '').slice(0, 200) || null);
    log?.('prix', `Reversement à ${s.name} : ${round2(amount)} €`);
    res.json(subEarnings(s));
  });
  app.delete('/api/subcontractors/payouts/:id', (req, res) => { db.prepare('DELETE FROM sub_payouts WHERE id=?').run(req.params.id); res.json({ ok: true }); });
  app.put('/api/interventions/:id/sub', (req, res) => {
    const sid = req.body.sub_id ? Number(req.body.sub_id) : null;
    if (sid && !db.prepare("SELECT 1 FROM contacts WHERE id=? AND kind='sous_traitant'").get(sid)) return fail(res, 400, 'Sous-traitant introuvable.');
    db.prepare('UPDATE projects SET sub_id=? WHERE id=?').run(sid, req.params.id); res.json({ ok: true });
  });

  /* ---------------------------------------------------------------- Espace intervenant (lien personnel) */
  const view = (sub) => {
    const E = subEarnings(sub); const S = getSettings();
    const interventions = db.prepare('SELECT p.*, c.name cname, c.company ccompany, c.phone cphone, c.email cemail FROM projects p JOIN contacts c ON c.id=p.contact_id WHERE p.sub_id=? ORDER BY p.id DESC').all(sub.id).map((p) => {
      const e = E.rows.find((r) => r.project_id === p.id);
      const quotes = db.prepare("SELECT id,number,status,public_token,title FROM quotes WHERE project_id=? AND kind IN ('devis','avenant') ORDER BY id").all(p.id).map((q) => {
        const t = db.prepare("SELECT COALESCE(SUM(l.qty*l.price_ht*(1+l.vat/100)),0) ttc FROM lines l WHERE l.quote_id=?").get(q.id); return { ...q, ttc: round2(t.ttc), sign_token: ['envoye', 'vu', 'signe'].includes(q.status) ? q.public_token : null, public_token: undefined };
      });
      const pv = db.prepare('SELECT status, token FROM pv WHERE project_id=? ORDER BY id DESC LIMIT 1').get(p.id);
      const invoices = db.prepare("SELECT number,kind,status,total_ttc FROM invoices WHERE project_id=? AND kind<>'avoir' ORDER BY id").all(p.id);
      return { id: p.id, title: p.title, stage: p.stage, address: [p.address, p.city].filter(Boolean).join(', '), client: p.ccompany || p.cname, client_name: p.cname, phone: p.cphone, email: p.cemail, quotes, pv: pv ? { status: pv.status, sign_token: pv.status === 'envoye' || pv.status === 'signe' ? pv.token : null } : null, invoices, earnings: e };
    });
    return { company: S.company_name, sub: { name: sub.name, trade: sub.trade }, commission_pct: E.pct, totals: E.totals, payouts: E.payouts, interventions };
  };
  app.get('/api/public/team/:token', (req, res) => { const s = guard(req, res); if (s) res.json(view(s)); });
  app.get('/api/public/team/:token/catalog', (req, res) => {
    if (!guard(req, res)) return;
    res.json(db.prepare('SELECT id, ref, label, unit, category, price_ht, vat FROM catalog_items WHERE archived=0 AND price_ht>0 ORDER BY category, label').all());
  });
  app.post('/api/public/team/:token/interventions', (req, res) => {
    const s = guard(req, res); if (!s) return;
    const b = req.body || {}; const name = String(b.name || '').trim(); if (!name) return fail(res, 400, 'Nom du client manquant.');
    const email = String(b.email || '').trim().toLowerCase(); if (email && !/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Adresse e-mail invalide.');
    const addr = String(b.address || '').trim(); if (!addr) return fail(res, 400, "Adresse d'intervention manquante.");
    let out;
    try {
      db.transaction(() => {
        const cid = db.prepare("INSERT INTO contacts(kind,name,email,phone,address,postal,city,client_type,source) VALUES('prospect',?,?,?,?,?,?,?,?)")
          .run(name, email || null, String(b.phone || '').trim() || null, addr, String(b.postal || '').trim() || null, String(b.city || '').trim() || null, b.client_type === 'professionnel' ? 'professionnel' : 'particulier', `Intervenant ${s.name}`).lastInsertRowid;
        const title = String(b.title || '').trim() || 'Intervention';
        const pid = db.prepare("INSERT INTO projects(contact_id,title,address,city,stage,sub_id) VALUES(?,?,?,?,'prospect',?)").run(cid, title, addr, [b.postal, b.city].filter(Boolean).join(' ') || null, s.id).lastInsertRowid;
        log?.('stage', `Intervention créée par ${s.name} (espace intervenant)`, { contact_id: cid, project_id: pid });
        let quote_id = null;
        if (b.mode === 'direct') {
          const inv = buildDirectInvoice(pid, b.lines, { intervention_date: new Date().toISOString().slice(0, 10) });
          log?.('devis', `Facture directe préparée par ${s.name} — à valider`, { contact_id: cid, project_id: pid }); out = { project_id: pid, invoice_id: inv.id };
        } else { quote_id = createQuote({ id: pid, title }, b.lines); out = { project_id: pid, quote_id }; }
      })();
    } catch (e) { return fail(res, e.status || 500, e.message); }
    res.json(out);
  });
  app.post('/api/public/team/:token/interventions/:pid/quote', (req, res) => {
    const s = guard(req, res); if (!s) return; const p = mine(s, req.params.pid); if (!p) return fail(res, 404, 'Intervention introuvable.');
    try { res.json({ quote_id: createQuote(p, req.body.lines) }); } catch (e) { fail(res, e.status || 500, e.message); }
  });
  app.post('/api/public/team/:token/quotes/:qid/present', (req, res) => {
    const s = guard(req, res); if (!s) return;
    const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.qid); if (!q || !mine(s, q.project_id)) return fail(res, 404, 'Devis introuvable.');
    if (q.status === 'signe') return fail(res, 400, 'Ce devis est déjà signé.');
    if (!db.prepare('SELECT 1 FROM lines WHERE quote_id=?').get(q.id)) return fail(res, 400, 'Le devis est vide.');
    const n = presentQuote(q.id); const c = db.prepare('SELECT c.email FROM contacts c JOIN projects p ON p.contact_id=c.id WHERE p.id=?').get(q.project_id);
    log?.('devis', `Devis ${n.number} présenté sur place par ${s.name}`, { project_id: q.project_id });
    res.json({ sign_token: n.public_token, number: n.number, has_email: !!c?.email });
  });
  app.post('/api/public/team/:token/interventions/:pid/pv', (req, res) => {
    const s = guard(req, res); if (!s) return; const p = mine(s, req.params.pid); if (!p) return fail(res, 404, 'Intervention introuvable.');
    if (!db.prepare("SELECT 1 FROM quotes WHERE project_id=? AND status='signe'").get(p.id) && !db.prepare('SELECT 1 FROM invoices WHERE project_id=?').get(p.id)) return fail(res, 400, 'Aucun devis signé : rien à faire signer.');
    const old = db.prepare('SELECT * FROM pv WHERE project_id=? ORDER BY id DESC LIMIT 1').get(p.id);
    if (old?.status === 'signe') return fail(res, 400, 'Le bon d’intervention est déjà signé.');
    if (old) { db.prepare('DELETE FROM pv WHERE id=?').run(old.id); db.prepare("DELETE FROM signatures WHERE doc_type='pv' AND doc_id=?").run(old.id); }
    const tok = token();
    db.prepare("INSERT INTO pv(project_id,token,date_reception,reserves,status) VALUES(?,?,?,?,'envoye')").run(p.id, tok, new Date().toISOString().slice(0, 10), String(req.body.reserves || '').trim() || null);
    log?.('devis', `Bon d’intervention présenté sur place par ${s.name}`, { contact_id: p.contact_id, project_id: p.id });
    res.json({ sign_token: tok });
  });
  app.post('/api/public/team/:token/interventions/:pid/direct-invoice', (req, res) => {
    const s = guard(req, res); if (!s) return; const p = mine(s, req.params.pid); if (!p) return fail(res, 404, 'Intervention introuvable.');
    try { const inv = buildDirectInvoice(p.id, req.body.lines, { intervention_date: new Date().toISOString().slice(0, 10) }); log?.('devis', `Facture directe préparée par ${s.name} — à valider`, { contact_id: p.contact_id, project_id: p.id }); res.json({ invoice_id: inv.id }); }
    catch (e) { fail(res, e.status || 500, e.message); }
  });
}
