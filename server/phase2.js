import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, DATA_DIR, getSettings, round2 } from './db.js';
import { renderQuotePdf, quoteContentHash } from './pdf.js';
import { buildFacturX } from './facturx.js';
import { renderInvoicePdf, renderPvPdf, renderRecapPdf } from './pdf2.js';
import { expenseTotals } from './expenses.js';
import { payLine } from './payments.js';
import { buildCreditNote, invoiceQuotes, quoteRefsLabel, buildInvoice, buildDirectInvoice, loadInvoice, nextInvoiceNumber, signedQuotes, quoteCalc, vatFor } from './billing.js';
import { consumeForInvoice, returnForCredit } from './stock.js';
import { ensureTrip } from './ik.js';
import { startSignature, verifyAndSign, getSignature } from './signature.js';
import { sendMail } from './mail.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const mask = (e) => e.replace(/^(.).*(@.*)$/, '$1•••$2');
const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0).replace(/[  ]/g, ' ');
const pdfHeaders = (res, name) => res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"` });
const attOk = (d) => d && new Date(d + 'T23:59:59') >= new Date();

export function mountPhase2(app, { loadQuote, log, setStage, token, APP_URL, upload, approveOutbox }) {
  const outbox = (kind, to, subject, body, refType, refId) =>
    db.prepare('INSERT INTO outbox(kind,to_addr,subject,body,ref_type,ref_id) VALUES(?,?,?,?,?,?)').run(kind, to, subject, body, refType, refId).lastInsertRowid;
  const projectOf = (id) => db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  const contactOf = (id) => db.prepare('SELECT * FROM contacts WHERE id=?').get(id);
  const infoOf = (p) => { try { return JSON.parse(p.info || '{}'); } catch { return {}; } };
  const fail = (res, code, msg) => res.status(code).json({ error: msg });

  /* ---------------------------------------------------------------- Conséquences d'une signature de devis */
  function onQuoteSigned(qid) {
    const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(qid);
    const p = projectOf(q.project_id);
    setStage(p.id, 'devis_valide', 'devis signé');
    if (q.kind === 'devis' && Number(q.deposit_rate) > 0 && !db.prepare("SELECT 1 FROM invoices WHERE project_id=? AND kind='acompte'").get(p.id)) {
      const inv = buildInvoice(p.id, 'acompte');
      log('devis', `Facture d'acompte préparée (${inv.total_ttc.toFixed(2).replace('.', ',')} € TTC), prête à envoyer`, { contact_id: p.contact_id, project_id: p.id });
    }
  }

  /* ---------------------------------------------------------------- Après validation humaine d'un message sortant */
  function markInvoiceSent(id) {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
    if (!inv || inv.status !== 'brouillon') return;
    db.prepare("UPDATE invoices SET status='envoyee', number=COALESCE(number,?), issued_at=datetime('now') WHERE id=?").run(nextInvoiceNumber(inv.kind), id);
    const p = projectOf(inv.project_id);
    log('mail', `Facture envoyée (${inv.kind})`, { contact_id: p.contact_id, project_id: p.id });
    try { if (inv.kind === 'avoir') returnForCredit(id); } catch (e) { console.error('Retour en stock impossible :', e.message); }
    try { const out = consumeForInvoice(id); if (out.length) log('stock', `Stock mis à jour : ${out.length} article(s) sorti(s) avec la facture`, { contact_id: p.contact_id, project_id: p.id }); } catch (e) { console.error('Sortie de stock impossible :', e.message); }
    ensureTrip(id).catch(() => {});
  }
  function afterApprove(o) {
    const [type, id] = (o.ref_type || '').split(':'); const n = Number(id);
    if (type === 'invoice') markInvoiceSent(n);
    if (type === 'pv') db.prepare("UPDATE pv SET status='envoye' WHERE id=? AND status='brouillon'").run(n);
    if (type === 'assignment') {
      db.prepare("UPDATE assignments SET status='envoye' WHERE id=? AND status='a_envoyer'").run(n);
      const a = db.prepare('SELECT * FROM assignments WHERE id=?').get(n); const pr = projectOf(a.project_id);
      log('mail', `Ordre de mission envoyé à ${o.to_addr}`, { contact_id: pr.contact_id, project_id: pr.id });
    }
  }

  /* ---------------------------------------------------------------- Signature publique (devis, PV) */
  function signable(type, tok) {
    if (type === 'quote') {
      const id = db.prepare('SELECT id FROM quotes WHERE public_token=?').get(tok)?.id; if (!id) return null;
      const q = loadQuote(id); const sig = getSignature('quote', id);
      const expired = q.sent_at && new Date(q.sent_at.replace(' ', 'T') + 'Z').getTime() + q.validity_days * 864e5 < Date.now();
      const state = q.status === 'signe' ? 'signed' : ['envoye', 'vu'].includes(q.status) ? (expired ? 'expired' : 'open') : 'closed';
      return { type, id, contact: q.contact, project: q.project, title: `${q.kind === 'avenant' ? 'Avenant' : 'Devis'} ${q.number || ''}`.trim(), subtitle: q.title || q.project.title, amount: q.calc.totals.ttc, pdf: `/api/public/quotes/${tok}/pdf`, state, signed_at: sig?.signed_at, signer: sig?.signer_name, photo: true, hash: () => quoteContentHash(q) };
    }
    if (type === 'pv') {
      const pv = db.prepare('SELECT * FROM pv WHERE token=?').get(tok); if (!pv) return null;
      const project = projectOf(pv.project_id); const contact = contactOf(project.contact_id); const sig = getSignature('pv', pv.id);
      return { type, id: pv.id, contact, project, title: 'Bon d’intervention', subtitle: project.title, amount: null, pdf: `/api/public/pv/${tok}/pdf`, state: pv.status === 'signe' ? 'signed' : pv.status === 'envoye' ? 'open' : 'closed', signed_at: sig?.signed_at, signer: sig?.signer_name, reserves: pv.reserves, hash: () => sha(JSON.stringify({ pv: pv.id, project: project.id, date: pv.date_reception, reserves: pv.reserves || '' })) };
    }
    return null;
  }

  app.get('/api/public/sign/:type/:token', (req, res) => {
    const d = signable(req.params.type, req.params.token); if (!d) return fail(res, 404, 'Lien invalide');
    res.json({ company: getSettings().company_name, title: d.title, subtitle: d.subtitle, amount: d.amount, pdf: d.pdf, state: d.state, signed_at: d.signed_at, signer: d.signer, reserves: d.reserves, contact_name: d.contact.name, email_hint: d.contact.email ? mask(d.contact.email) : null, photo: !!d.photo, type: d.type });
  });
  app.post('/api/public/sign/:type/:token/otp', async (req, res, next) => {
    try {
      const d = signable(req.params.type, req.params.token); if (!d) return fail(res, 404, 'Lien invalide');
      if (d.state !== 'open') return fail(res, 400, d.state === 'expired' ? 'Ce devis a expiré.' : 'Ce document ne peut plus être signé.');
      if (!d.contact.email) return fail(res, 400, "Aucune adresse e-mail n'est enregistrée pour ce client.");
      const code = startSignature(d.type, d.id, d.contact.email);
      const r = await sendMail({ to: d.contact.email, subject: `Votre code de signature : ${code}`, code, preheader: `Votre code de signature : ${code}`, body: `Bonjour ${d.contact.name},\n\nVoici le code de confirmation pour signer électroniquement « ${d.title} ».\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message : rien ne sera signé.\n\nCordialement,` });
      if (r.simulated && process.env.DEMO_MODE !== '1') return fail(res, 503, "L'envoi d'e-mails n'est pas configuré (SMTP_URL) : signature impossible.");
      res.json({ sent_to: mask(d.contact.email), dev_code: r.simulated ? code : undefined }); // le code n'est jamais renvoyé au navigateur hors DEMO_MODE
    } catch (e) { next(e); }
  });
  app.post('/api/public/sign/:type/:token/confirm', (req, res) => {
    const d = signable(req.params.type, req.params.token); if (!d) return fail(res, 404, 'Lien invalide');
    if (d.state !== 'open') return fail(res, 400, 'Ce document ne peut plus être signé.');
    const { name, code, accept, photo_auth } = req.body;
    if (!name?.trim()) return fail(res, 400, 'Saisissez votre nom.');
    if (!accept) return fail(res, 400, 'Cochez « Lu et approuvé » pour signer.');
    try {
      verifyAndSign(d.type, d.id, { name, code, ip: req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress, ua: req.headers['user-agent'], hash: d.hash() });
    } catch (e) { return fail(res, e.status || 400, e.message); }
    const p = d.project;
    if (d.type === 'quote') {
      db.prepare("UPDATE quotes SET status='signe', signed_at=datetime('now'), photo_auth=? WHERE id=?").run(photo_auth ? 1 : 0, d.id);
      log('devis', `${d.title} signé électroniquement par ${name.trim()}${photo_auth ? ' (photos autorisées)' : ''}`, { contact_id: p.contact_id, project_id: p.id });
      onQuoteSigned(d.id);
    } else {
      db.prepare("UPDATE pv SET status='signe', signed_at=datetime('now') WHERE id=?").run(d.id);
      log('devis', `Bon d’intervention signé par ${name.trim()}`, { contact_id: p.contact_id, project_id: p.id });
      setStage(p.id, 'intervention_terminee', 'bon d’intervention signé');
      // Fin d’intervention : facture de solde générée, message prêt à envoyer (validation humaine)
      let inv = db.prepare("SELECT * FROM invoices WHERE project_id=? AND kind IN ('facture','solde') AND status='brouillon' AND credit_of IS NULL").get(p.id);
      try { if (!inv && !db.prepare("SELECT 1 FROM invoices WHERE project_id=? AND kind IN ('facture','solde') AND credit_of IS NULL").get(p.id)) inv = buildInvoice(p.id, 'facture'); } catch { /* déjà facturé ou pas de devis */ }
      if (inv && d.contact.email) {
        const pv = db.prepare('SELECT * FROM pv WHERE id=?').get(d.id);
        outbox('email_fin_intervention', d.contact.email, `Votre facture — ${p.title}`,
          `Bonjour ${d.contact.name},\n\nMerci de votre confiance. Notre intervention « ${p.title} » est terminée et vous avez signé le bon d’intervention.\n\nBon d’intervention : ${APP_URL}/api/public/pv/${pv.token}/pdf\nFacture (${eur(inv.total_ttc)} TTC) : ${APP_URL}/api/public/invoices/${inv.public_token}/pdf\n\nBien cordialement,`, `invoice:${inv.id}`, inv.id);
        log('mail', 'Message de fin d’intervention + facture préparés — à valider', { contact_id: p.contact_id, project_id: p.id });
      }
    }
    res.json({ ok: true });
  });
  app.get('/api/public/pv/:token/pdf', (req, res) => {
    const pv = db.prepare('SELECT * FROM pv WHERE token=?').get(req.params.token); if (!pv) return res.sendStatus(404);
    sendPvPdf(res, pv);
  });
  function sendPvPdf(res, pv) {
    const p = projectOf(pv.project_id); pdfHeaders(res, `PV-${pv.id}`);
    renderPvPdf(pv, p, contactOf(p.contact_id), signedQuotes(p.id), getSignature('pv', pv.id)?.status === 'signed' ? getSignature('pv', pv.id) : null, res);
  }

  /* ---------------------------------------------------------------- Interventions */
  const CH = ['devis_valide', 'intervention_en_cours', 'intervention_terminee'];
  function planned(projectId) {
    const t = { ht: 0, cost: 0, profit: 0, sub_cost: 0, mat_cost: 0, lab_cost: 0 };
    for (const q of signedQuotes(projectId)) {
      const c = quoteCalc(q.id).totals; t.ht += c.total; t.cost += c.cost; t.profit += c.profit; t.sub_cost += c.sub; t.mat_cost += c.mat; t.lab_cost += c.lab;
    }
    t.margin = t.ht > 0 && t.cost > 0 ? (t.profit / t.ht) * 100 : null;
    return { ...t, ht: round2(t.ht), cost: round2(t.cost), profit: round2(t.profit), mat_cost: round2(t.mat_cost), lab_cost: round2(t.lab_cost), sub_cost: round2(t.sub_cost) };
  }
  app.get('/api/dashboard/interventions', (_req, res) => {
    const rows = db.prepare("SELECT p.id,p.title,p.stage,c.name AS contact_name,c.company AS contact_company FROM projects p JOIN contacts c ON c.id=p.contact_id WHERE p.stage IN ('intervention_en_cours','devis_valide','intervention_terminee') ORDER BY p.updated_at DESC").all();
    const out = [];
    for (const p of rows) {
      const pl = planned(p.id); if (!pl.ht) continue;
      const a = expenseTotals(p.id);
      const spent = a.total_ht;
      const plannedCost = pl.cost; // 0 si coûts non renseignés : on ne conclut pas
      const over = plannedCost > 0 && spent > plannedCost * 1.05 ? round2(spent - plannedCost) : 0;
      out.push({ id: p.id, title: p.title, stage: p.stage, who: p.contact_company || p.contact_name, sold_ht: pl.ht, planned_cost: plannedCost, spent_ht: spent, hours: a.hours,
        real_margin: spent > 0 ? round2(pl.ht - spent) : null, real_margin_pct: spent > 0 ? round2(((pl.ht - spent) / pl.ht) * 100) : null,
        planned_margin_pct: pl.margin, over, unpaid_ttc: a.unpaid_ttc });
    }
    const tracked = out.filter((r) => r.spent_ht > 0);
    const sold = tracked.reduce((x, r) => x + r.sold_ht, 0), spent = tracked.reduce((x, r) => x + r.spent_ht, 0);
    res.json({ rows: out, tracked: tracked.length, real_margin_pct: sold > 0 ? round2(((sold - spent) / sold) * 100) : null, over: out.filter((r) => r.over > 0).sort((x, y) => y.over - x.over), untracked: out.filter((r) => r.stage === 'intervention_en_cours' && !r.spent_ht).length, unpaid_ttc: round2(out.reduce((x, r) => x + r.unpaid_ttc, 0)) });
  });
  app.get('/api/interventions', (_req, res) => {
    const rows = db.prepare(`SELECT p.*, c.name AS contact_name, c.company AS contact_company FROM projects p JOIN contacts c ON c.id=p.contact_id WHERE p.stage IN (${CH.map(() => '?').join(',')}) ORDER BY CASE p.stage WHEN 'intervention_en_cours' THEN 0 WHEN 'devis_valide' THEN 1 ELSE 2 END, p.updated_at DESC`).all(...CH);
    for (const p of rows) {
      p.info = infoOf(p); p.planned = planned(p.id);
      p.invoiced = db.prepare("SELECT COALESCE(SUM(total_ttc),0) s FROM invoices WHERE project_id=? AND status<>'brouillon'").get(p.id).s;
      p.paid = db.prepare("SELECT COALESCE(SUM(total_ttc),0) s FROM invoices WHERE project_id=? AND status='payee'").get(p.id).s;
      p.photos = db.prepare("SELECT COUNT(*) n FROM files WHERE project_id=? AND kind='photo'").get(p.id).n;
      p.cover = db.prepare("SELECT id FROM files WHERE project_id=? AND kind='photo' ORDER BY CASE tag WHEN 'apres' THEN 0 WHEN 'avant' THEN 1 ELSE 2 END, id DESC LIMIT 1").get(p.id)?.id;
      p.draft_invoices = db.prepare("SELECT COUNT(*) n FROM invoices WHERE project_id=? AND status='brouillon'").get(p.id).n;
    }
    res.json(rows);
  });
  app.get('/api/interventions/:id', (req, res) => {
    const p = projectOf(req.params.id); if (!p) return fail(res, 404, 'Introuvable');
    const quotes = db.prepare('SELECT id,number,kind,status,title,sent_at,signed_at,photo_auth FROM quotes WHERE project_id=? ORDER BY id').all(p.id).map((q) => ({ ...q, totals: quoteCalc(q.id).totals }));
    const signedLines = signedQuotes(p.id).flatMap((q) => db.prepare('SELECT l.*, s.title AS section_title FROM lines l JOIN sections s ON s.id=l.section_id WHERE l.quote_id=? ORDER BY s.position,l.position').all(q.id).map((l) => ({ ...l, quote_number: q.number })));
    const assignments = db.prepare('SELECT a.*, c.name AS contact_name, c.company AS contact_company, c.trade FROM assignments a JOIN contacts c ON c.id=a.contact_id WHERE a.project_id=? ORDER BY a.id DESC').all(p.id).map((a) => ({ ...a, items: JSON.parse(a.items) }));
    const subs = db.prepare("SELECT id,name,company,trade,email,decennale_until,urssaf_until FROM contacts WHERE kind='sous_traitant' ORDER BY name").all().map((s) => ({ ...s, ok: !!(attOk(s.decennale_until) && attOk(s.urssaf_until)) }));
    const pv = db.prepare('SELECT * FROM pv WHERE project_id=? ORDER BY id DESC LIMIT 1').get(p.id);
    res.json({
      project: { ...p, info: infoOf(p) }, contact: contactOf(p.contact_id), quotes, planned: planned(p.id), actual: expenseTotals(p.id), signed_lines: signedLines, assignments, subs,
      files: db.prepare('SELECT * FROM files WHERE project_id=? ORDER BY id DESC').all(p.id),
      pv: pv ? { ...pv, signature: getSignature('pv', pv.id) } : null,
      invoices: db.prepare('SELECT * FROM invoices WHERE project_id=? ORDER BY id').all(p.id).map((i) => ({ ...i, quotes: invoiceQuotes(i), lines: db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY id').all(i.id) })),
      activities: db.prepare('SELECT * FROM activities WHERE project_id=? ORDER BY id DESC LIMIT 60').all(p.id),
    });
  });
  app.put('/api/interventions/:id/info', (req, res) => {
    const p = projectOf(req.params.id); const info = { ...infoOf(p), ...req.body };
    db.prepare("UPDATE projects SET info=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(info), p.id); res.json(info);
  });
  app.post('/api/interventions/:id/start', (req, res) => {
    const p = projectOf(req.params.id);
    if (!signedQuotes(p.id).length) return fail(res, 400, 'Aucun devis signé : l’intervention ne peut pas démarrer.');
    const info = { ...infoOf(p), start_date: req.body.start_date || infoOf(p).start_date || new Date().toISOString().slice(0, 10) };
    db.prepare('UPDATE projects SET info=? WHERE id=?').run(JSON.stringify(info), p.id);
    setStage(p.id, 'intervention_en_cours', 'démarrage de l’intervention'); res.json({ ok: true });
  });

  /* ---------------------------------------------------------------- Photos et documents */
  app.post('/api/interventions/:id/files', upload.array('files', 30), (req, res) => {
    const p = projectOf(req.params.id); const { kind = 'photo', tag = null, room = null } = req.body; const out = [];
    for (const f of req.files || []) {
      const isImg = f.mimetype.startsWith('image/');
      const id = db.prepare('INSERT INTO files(project_id,kind,tag,room,filename,orig_name,mime,size) VALUES(?,?,?,?,?,?,?,?)').run(p.id, isImg && kind === 'photo' ? 'photo' : 'document', isImg ? tag || 'pendant' : null, room, f.filename, f.originalname, f.mimetype, f.size).lastInsertRowid;
      out.push(id);
    }
    if (out.length) log('note', `${out.length} fichier(s) ajouté(s)${tag ? ` (${tag})` : ''}`, { contact_id: p.contact_id, project_id: p.id });
    res.json({ ids: out });
  });
  app.get('/api/files/:id/raw', (req, res) => {
    const f = db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id); if (!f) return res.sendStatus(404);
    res.set('Content-Type', f.mime || 'application/octet-stream'); res.set('Content-Disposition', `inline; filename="${encodeURIComponent(f.orig_name || 'fichier')}"`);
    res.sendFile(path.join(DATA_DIR, 'uploads', f.filename));
  });
  app.put('/api/files/:id', (req, res) => {
    const f = db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id); const n = { ...f, ...req.body };
    db.prepare('UPDATE files SET tag=?,room=?,caption=?,shared=? WHERE id=?').run(n.tag, n.room, n.caption, n.shared ? 1 : 0, f.id); res.json({ ok: true });
  });
  app.delete('/api/files/:id', (req, res) => {
    const f = db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id); if (!f) return res.json({ ok: true });
    try { fs.unlinkSync(path.join(DATA_DIR, 'uploads', f.filename)); } catch { /* déjà supprimé */ }
    db.prepare('DELETE FROM files WHERE id=?').run(f.id); res.json({ ok: true });
  });

  /* ---------------------------------------------------------------- Sous-traitants : ordre de mission */
  app.post('/api/interventions/:id/assignments', (req, res) => {
    const p = projectOf(req.params.id); const { contact_id, items = [], start_date, end_date, message } = req.body;
    const sub = contactOf(contact_id);
    if (!sub || sub.kind !== 'sous_traitant') return fail(res, 400, 'Choisissez un sous-traitant.');
    if (!attOk(sub.decennale_until)) return fail(res, 400, `${sub.name} ne peut pas être affecté : assurance RC pro absente ou expirée.`);
    if (!attOk(sub.urssaf_until)) return fail(res, 400, `${sub.name} ne peut pas être affecté : attestation de vigilance URSSAF absente ou expirée.`);
    if (!items.length) return fail(res, 400, 'Cochez au moins une ligne du devis.');
    if (!sub.email) return fail(res, 400, `${sub.name} n'a pas d'adresse e-mail.`);
    const total = round2(items.reduce((a, i) => a + Number(i.amount || 0), 0));
    const tok = token();
    const id = db.prepare('INSERT INTO assignments(project_id,contact_id,token,items,total,start_date,end_date,message) VALUES(?,?,?,?,?,?,?,?)')
      .run(p.id, sub.id, tok, JSON.stringify(items), total, start_date || null, end_date || null, message || null).lastInsertRowid;
    const S = getSettings();
    outbox('email_ss_traitant', sub.email, `Ordre de mission — ${p.title}${p.city ? ' (' + p.city + ')' : ''}`,
      `Bonjour ${sub.name},\n\nNous vous confions les travaux suivants sur l’intervention « ${p.title} » :\n${items.map((i) => `  • ${i.label}`).join('\n')}\n\nMontant convenu : ${eur(total)} HT.\n${message ? '\n' + message + '\n' : ''}\nAdresse, accès, contact client et photos : ${APP_URL}/soustraitant/${tok}\nMerci de confirmer en ligne (cela vaut bon de commande).\n\nCordialement,`, `assignment:${id}`, id);
    log('prix', `Ordre de mission préparé pour ${sub.name} (${eur(total)} HT) — à valider`, { contact_id: p.contact_id, project_id: p.id });
    res.json({ id });
  });
  app.delete('/api/assignments/:id', (req, res) => { db.prepare('DELETE FROM assignments WHERE id=?').run(req.params.id); res.json({ ok: true }); });

  function assignmentBundle(tok) {
    const a = db.prepare('SELECT * FROM assignments WHERE token=?').get(tok); if (!a) return null;
    const project = projectOf(a.project_id); return { a, project, contact: contactOf(project.contact_id), sub: contactOf(a.contact_id), info: infoOf(project) };
  }
  app.get('/api/public/assignments/:token', (req, res) => {
    const b = assignmentBundle(req.params.token); if (!b) return fail(res, 404, 'Lien invalide');
    const S = getSettings();
    const photos = db.prepare("SELECT id,room,caption FROM files WHERE project_id=? AND kind='photo' AND tag='avant' ORDER BY id LIMIT 12").all(b.project.id);
    // Jamais de prix de vente : seulement le montant convenu avec le sous-traitant.
    res.json({ company: S.company_name, company_phone: S.company_phone, status: b.a.status, done_at: b.a.done_at, paid_at: b.a.paid_at, accepted_at: b.a.accepted_at, accepted_by: b.a.accepted_by, sub: { name: b.sub.name, trade: b.sub.trade }, project: { title: b.project.title, address: b.project.address, city: b.project.city }, client: { name: b.contact.name, phone: b.contact.phone }, info: b.info, start_date: b.a.start_date, end_date: b.a.end_date, message: b.a.message, items: JSON.parse(b.a.items), total: b.a.total, photos });
  });
  app.post('/api/public/assignments/:token/accept', (req, res) => {
    const b = assignmentBundle(req.params.token); if (!b) return fail(res, 404, 'Lien invalide');
    if (b.a.status === 'accepte') return res.json({ ok: true });
    if (!req.body.name?.trim()) return fail(res, 400, 'Saisissez votre nom.');
    db.prepare("UPDATE assignments SET status='accepte', accepted_at=datetime('now'), accepted_by=? WHERE id=?").run(req.body.name.trim(), b.a.id);
    log('prix', `${b.sub.name} a accepté l'ordre de mission (${eur(b.a.total)} HT) — dépense prévue`, { contact_id: b.project.contact_id, project_id: b.project.id });
    res.json({ ok: true });
  });
  app.get('/api/public/assignments/:token/photo/:fid', (req, res) => {
    const b = assignmentBundle(req.params.token); if (!b) return res.sendStatus(404);
    const f = db.prepare("SELECT * FROM files WHERE id=? AND project_id=? AND kind='photo' AND tag='avant'").get(req.params.fid, b.project.id); if (!f) return res.sendStatus(404);
    res.set('Content-Type', f.mime); res.sendFile(path.join(DATA_DIR, 'uploads', f.filename));
  });
  app.get('/api/public/assignments/:token/pdf', (req, res) => {
    const b = assignmentBundle(req.params.token); if (!b) return res.sendStatus(404);
    pdfHeaders(res, `ordre-travaux-${b.a.id}`); renderRecapPdf(b.a, b.project, b.contact, b.sub, b.info, [], res);
  });
  app.get('/api/assignments/:id/pdf', (req, res) => {
    const a = db.prepare('SELECT token FROM assignments WHERE id=?').get(req.params.id); if (!a) return res.sendStatus(404);
    const b = assignmentBundle(a.token); pdfHeaders(res, `ordre-travaux-${b.a.id}`); renderRecapPdf(b.a, b.project, b.contact, b.sub, b.info, [], res);
  });

  /* ---------------------------------------------------------------- PV de réception */
  app.post('/api/interventions/:id/pv', (req, res) => {
    const p = projectOf(req.params.id); const c = contactOf(p.contact_id);
    if (!signedQuotes(p.id).length && !db.prepare('SELECT 1 FROM invoices WHERE project_id=?').get(p.id)) return fail(res, 400, 'Aucun devis signé ni facture : rien à faire signer.');
    if (!c.email) return fail(res, 400, "Le client n'a pas d'adresse e-mail.");
    const old = db.prepare('SELECT * FROM pv WHERE project_id=? ORDER BY id DESC LIMIT 1').get(p.id);
    if (old?.status === 'signe') return fail(res, 400, 'Le bon d’intervention est déjà signé.');
    if (old) { db.prepare('DELETE FROM pv WHERE id=?').run(old.id); db.prepare("DELETE FROM signatures WHERE doc_type='pv' AND doc_id=?").run(old.id); }
    const tok = token();
    const id = db.prepare('INSERT INTO pv(project_id,token,date_reception,reserves) VALUES(?,?,?,?)').run(p.id, tok, req.body.date_reception || new Date().toISOString().slice(0, 10), req.body.reserves || null).lastInsertRowid;
    const S = getSettings();
    outbox('email_pv', c.email, `Bon d’intervention — ${p.title}`,
      `Bonjour ${c.name},\n\nNotre intervention « ${p.title} » est terminée. Merci de consulter et de signer le bon d’intervention en ligne (1 minute, aucun compte à créer) :\n${APP_URL}/signer/pv/${tok}\n\nDès la signature, nous vous envoyons votre facture.\n\nCordialement,`, `pv:${id}`, id);
    log('mail', 'Bon d’intervention préparé — à valider', { contact_id: p.contact_id, project_id: p.id });
    res.json({ id });
  });
  app.get('/api/pv/:id/pdf', (req, res) => { const pv = db.prepare('SELECT * FROM pv WHERE id=?').get(req.params.id); pv ? sendPvPdf(res, pv) : res.sendStatus(404); });
  app.post('/api/pv/:id/mark-signed', (req, res) => { // bon d’intervention signé sur papier
    const pv = db.prepare('SELECT * FROM pv WHERE id=?').get(req.params.id); const p = projectOf(pv.project_id);
    db.prepare("UPDATE pv SET status='signe', signed_at=datetime('now') WHERE id=?").run(pv.id);
    setStage(p.id, 'intervention_terminee', 'bon d’intervention signé'); try { if (!db.prepare("SELECT 1 FROM invoices WHERE project_id=? AND kind IN ('facture','solde') AND credit_of IS NULL").get(p.id)) buildInvoice(p.id, 'facture'); } catch { /* pas de devis signé */ }
    res.json({ ok: true });
  });

  /* ---------------------------------------------------------------- Factures */
  app.get('/api/invoices', (_req, res) => {
    const rows = db.prepare(`SELECT i.*, p.title AS project_title, c.name AS contact_name, c.company AS contact_company FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id ORDER BY i.id DESC`).all();
    const now = new Date().toISOString().slice(0, 10);
    for (const r of rows) { r.late = r.status === 'envoyee' && r.due_at && r.due_at < now; r.quotes = invoiceQuotes(r); }
    res.json(rows);
  });
  app.post('/api/invoices/:id/credit', (req, res) => {
    try { res.json(buildCreditNote(Number(req.params.id), { percent: req.body.percent ?? 100, reason: req.body.reason })); } catch (e) { fail(res, e.status || 500, e.message); }
  });
  app.post('/api/interventions/:id/invoices', (req, res) => {
    try { const inv = buildInvoice(Number(req.params.id), req.body.kind || 'facture', { percent: req.body.percent, claim_ref: req.body.claim_ref }); ensureTrip(inv.id).catch(() => {}); res.json(inv); } catch (e) { fail(res, e.status || 500, e.message); }
  });
  /** Facture directe (dépannage sans devis) : lignes choisies dans le catalogue ou libres. */
  app.post('/api/interventions/:id/direct-invoice', (req, res) => {
    try { const inv = buildDirectInvoice(Number(req.params.id), req.body.lines, { claim_ref: req.body.claim_ref, intervention_date: req.body.intervention_date }); ensureTrip(inv.id).catch(() => {}); res.json(inv); } catch (e) { fail(res, e.status || 500, e.message); }
  });
  /** Modification d'un brouillon de facture : lignes, n° de sinistre, date d'intervention. */
  app.put('/api/invoices/:id', (req, res) => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id); if (!inv) return fail(res, 404, 'Introuvable');
    if (inv.status !== 'brouillon') return fail(res, 400, 'Une facture émise ne se modifie plus : créez un avoir.');
    if (inv.kind === 'avoir') return fail(res, 400, 'Un avoir ne se modifie pas.');
    const contact = contactOf(projectOf(inv.project_id).contact_id); const S = getSettings();
    const lines = Array.isArray(req.body.lines) ? req.body.lines : null;
    if (lines) {
      if (!lines.length) return fail(res, 400, 'Une facture doit comporter au moins une ligne.');
      const out = [];
      for (const [k, l] of lines.entries()) {
        const label = String(l.label || '').trim(); const qty = Number(String(l.qty ?? 1).replace(',', '.')); const price = Number(String(l.unit_price ?? '').replace(',', '.'));
        if (!label) return fail(res, 400, `Ligne ${k + 1} : désignation manquante.`);
        if (!Number.isFinite(qty) || qty === 0) return fail(res, 400, `Ligne ${k + 1} : quantité invalide.`);
        if (!Number.isFinite(price)) return fail(res, 400, `Ligne ${k + 1} : prix invalide.`);
        const it = l.item_id ? db.prepare('SELECT * FROM catalog_items WHERE id=?').get(l.item_id) : null;
        const cost = it ? (it.cost_material || 0) + (it.labor_hours || 0) * (it.labor_rate || 0) + (it.cost_sub || 0) : Number(l.cost_unit) || 0;
        out.push({ label, qty, unit: l.unit || 'u', unit_price: price, vat: l.vat != null && l.vat !== '' ? Number(l.vat) : vatFor(contact, Number(S.vat_default)), base_ht: round2(qty * price), item_id: it?.id || null, cost_unit: round2(cost) });
      }
      const ht = round2(out.reduce((a, l) => a + l.base_ht, 0)); const tva = round2(out.reduce((a, l) => a + round2(l.base_ht * (l.vat / 100)), 0));
      db.transaction(() => {
        db.prepare('DELETE FROM invoice_lines WHERE invoice_id=?').run(inv.id);
        for (const l of out) db.prepare('INSERT INTO invoice_lines(invoice_id,label,base_ht,vat,qty,unit,unit_price,item_id,cost_unit) VALUES(?,?,?,?,?,?,?,?,?)').run(inv.id, l.label, l.base_ht, l.vat, l.qty, l.unit, l.unit_price, l.item_id, l.cost_unit);
        db.prepare('UPDATE invoices SET total_ht=?, total_tva=?, total_ttc=? WHERE id=?').run(ht, tva, round2(ht + tva), inv.id);
      })();
    }
    const sets = []; const args = [];
    if (req.body.claim_ref !== undefined) { sets.push('claim_ref=?'); args.push(String(req.body.claim_ref || '').trim() || null); }
    if (req.body.intervention_date !== undefined) { sets.push('intervention_date=?'); args.push(/^\d{4}-\d{2}-\d{2}$/.test(req.body.intervention_date || '') ? req.body.intervention_date : null); }
    if (req.body.title !== undefined && String(req.body.title).trim()) { sets.push('title=?'); args.push(String(req.body.title).trim()); }
    if (sets.length) db.prepare(`UPDATE invoices SET ${sets.join(',')} WHERE id=?`).run(...args, inv.id);
    res.json(loadInvoice(inv.id));
  });
  app.post('/api/invoices/:id/send', async (req, res) => {
    const inv = loadInvoice(req.params.id); if (!inv) return fail(res, 404, 'Introuvable');
    if (inv.status !== 'brouillon') return fail(res, 400, 'Cette facture a déjà été envoyée.');
    if (!inv.contact.email) return fail(res, 400, "Le client n'a pas d'adresse e-mail.");
    const S = getSettings();
    const label = inv.kind === 'avoir' ? 'avoir' : inv.kind === 'acompte' ? "facture d'acompte" : 'facture';
    const due = inv.kind === 'avoir' ? '' : Number(S.payment_days || 0) > 0 ? `, à régler avant le ${new Date(inv.due_at).toLocaleDateString('fr-FR')}` : ', payable à réception';
    const o = outbox('email_facture', inv.contact.email, `${inv.title} — ${S.company_name}`,
      `Bonjour ${inv.contact.name},\n\nVeuillez trouver votre ${label} de ${eur(inv.total_ttc)} TTC${inv.quotes.length ? ` (devis ${quoteRefsLabel(inv.quotes)})` : ''}${due}.\n\n${inv.kind === 'avoir' ? `Cet avoir annule${inv.credit_src ? ' (en tout ou partie) la facture ' + inv.credit_src.number : ''}. Motif : ${inv.reason}.\n\nIl sera déduit de vos prochaines factures ou remboursé par virement.` : `La facture est jointe à ce message en PDF${inv.claim_ref ? ` ; elle mentionne votre référence sinistre ${inv.claim_ref}, pour votre assurance` : ''}.${inv.total_ttc > 0 && S.company_iban ? `\n\nRèglement par virement : IBAN ${S.company_iban}, en rappelant le numéro de facture.` : ''}`}\n\nCordialement,\n${S.company_name}`, `invoice:${inv.id}`, inv.id);
    if (req.body?.now) { try { await approveOutbox(o); } catch (e) { return fail(res, e.status || 502, e.message); } }
    res.json(db.prepare('SELECT * FROM outbox WHERE id=?').get(o));
  });
  app.post('/api/invoices/:id/paid', (req, res) => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id); if (inv.status !== 'envoyee') return fail(res, 400, "Seule une facture envoyée peut être marquée comme payée.");
    const METHODS = ['especes', 'cb', 'cheque', 'virement', 'autre']; const method = METHODS.includes(req.body.method) ? req.body.method : null;
    db.prepare("UPDATE invoices SET status='payee', paid_at=?, payment_method=? WHERE id=?").run(req.body.date || new Date().toISOString().slice(0, 10), method, inv.id);
    const p = projectOf(inv.project_id); log('devis', `Facture ${inv.number} payée (${eur(inv.total_ttc)})${method ? ' — ' + { especes: 'espèces', cb: 'carte bancaire', cheque: 'chèque', virement: 'virement', autre: 'autre mode' }[method] : ''}`, { contact_id: p.contact_id, project_id: p.id }); res.json({ ok: true });
  });
  app.delete('/api/invoices/:id', (req, res) => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id); if (inv.status !== 'brouillon') return fail(res, 400, 'Une facture émise ne se supprime pas (numérotation continue).');
    db.prepare('DELETE FROM invoices WHERE id=?').run(inv.id); res.json({ ok: true });
  });
  app.get('/api/invoices/:id/pdf', (req, res) => { const inv = loadInvoice(req.params.id); if (!inv) return res.sendStatus(404); pdfHeaders(res, inv.number || `facture-brouillon-${inv.id}`); renderInvoicePdf(inv, res); });
  app.get('/api/invoices/:id/facturx.xml', (req, res) => { const inv = loadInvoice(req.params.id); if (!inv?.number) return res.status(404).json({ error: 'Facture non émise.' }); res.type('application/xml').attachment(`${inv.number}-factur-x.xml`).send(buildFacturX(inv, getSettings())); });
  app.get('/api/public/invoices/:token/pdf', (req, res) => {
    const id = db.prepare('SELECT id FROM invoices WHERE public_token=?').get(req.params.token)?.id; const inv = id && loadInvoice(id); if (!inv) return res.sendStatus(404);
    pdfHeaders(res, inv.number || 'facture'); renderInvoicePdf(inv, res);
  });

  return { onQuoteSigned, afterApprove };
}
