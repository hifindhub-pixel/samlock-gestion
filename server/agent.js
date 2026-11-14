// Assistant IA (Claude) : brouillon de devis depuis un texte dicté, lecture des factures fournisseurs, et passerelle WhatsApp.
// Règles : l'IA ne fait que PRÉPARER (brouillon de devis, champs pré-remplis). Rien ne part chez un client sans validation humaine,
// et aucun prix n'est inventé : un article absent du catalogue devient une ligne « à chiffrer ».
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSettings, DATA_DIR, round2 } from './db.js';
import { ouvrageDescription } from './ouvrages.js';

db.exec(`CREATE TABLE IF NOT EXISTS wa_messages (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);

const err = (m, status = 400) => Object.assign(new Error(m), { status });
export const apiKey = () => getSettings().anthropic_api_key || process.env.ANTHROPIC_API_KEY || '';
export const agentReady = () => !!apiKey();

/** Appel à l'API Messages (outil forcé → réponse structurée). */
export async function callClaude({ system, content, tool, max_tokens = 4000 }) {
  const key = apiKey(); if (!key) throw err("L'assistant IA n'est pas activé : renseignez votre clé API dans Réglages.", 400);
  const S = getSettings(); const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  let r;
  try {
    r = await fetch(`${base}/v1/messages`, {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: S.agent_model || 'claude-sonnet-5-5', max_tokens, system, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content }] }),
    });
  } catch (e) { throw err(`Service IA injoignable (${e.name === 'TimeoutError' ? 'délai dépassé' : e.message}).`, 502); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(r.status === 401 ? 'Clé API refusée par le service IA : vérifiez-la dans Réglages.' : `Service IA : ${j.error?.message || r.status}`, r.status === 401 ? 400 : 502);
  const use = (j.content || []).find((c) => c.type === 'tool_use');
  if (!use) throw err("L'assistant n'a pas pu structurer sa réponse. Reformulez ou précisez la demande.", 502);
  return use.input;
}

/* ------------------------------------------------------------------ Devis depuis un texte */
const QUOTE_TOOL = {
  name: 'creer_brouillon_devis',
  description: 'Crée le brouillon de devis décrit par l\'artisan.',
  input_schema: {
    type: 'object',
    properties: {
      client_name: { type: 'string', description: 'Nom du client tel que cité (personne ou société). Vide si non cité.' },
      client_phone: { type: 'string' }, client_email: { type: 'string' },
      address: { type: 'string', description: 'Adresse des travaux si citée' }, city: { type: 'string' },
      project_title: { type: 'string', description: 'Intitulé court de l\'intervention, ex. « Ouverture de porte + changement de cylindre »' },
      lines: {
        type: 'array', items: {
          type: 'object', properties: {
            catalog_id: { type: ['integer', 'null'], description: "Id de l'article du catalogue si la correspondance est claire, sinon null" },
            label: { type: 'string', description: 'Désignation (reprise du catalogue si catalog_id)' },
            room: { type: 'string', description: 'Pièce ou lot (ex. Salle de bains). Vide si non précisé.' },
            qty: { type: 'number' }, unit: { type: 'string', description: 'm², ml, u, forfait…' },
            description: { type: 'string', description: 'Précision utile (optionnel)' },
            amount: { type: ['number', 'null'], description: "Prix EXACTEMENT tel que l'artisan l'a énoncé pour cette prestation. null s'il n'en a pas donné. Ne jamais en déduire un." },
            amount_kind: { type: 'string', enum: ['unitaire_ht', 'unitaire_ttc', 'total_ht', 'total_ttc'], description: "Nature du prix énoncé : par unité (« 45 € le m² ») ou pour toute la ligne (« 600 € pour la niche »), HT ou TTC. Sans précision sur HT/TTC, supposer HT." },
          }, required: ['label', 'qty'],
        },
      },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Points à vérifier : quantité supposée, article ambigu, information manquante…' },
    },
    required: ['project_title', 'lines'],
  },
};

const SYSTEM_DEVIS = `Tu es l'assistant de SAMLOCK, entreprise de rénovation du bâtiment. L'artisan te dicte ou écrit les informations d'une intervention ; tu prépares le brouillon de devis.
Règles strictes :
- Utilise en priorité les articles du catalogue fourni (indique leur catalog_id) quand la correspondance est claire. Sinon catalog_id = null : la ligne sera « à chiffrer ».
- N'invente jamais de prix, de quantité ni d'information. Si une quantité manque, mets 1 et signale-le dans warnings.
- Si l'artisan énonce un prix, reporte-le dans amount avec sa nature (amount_kind), sans calcul ni arrondi de ta part. S'il n'en cite pas, amount = null : jamais de prix déduit ou estimé.
- Une ligne par prestation, désignation concise et professionnelle, en français.
- Regroupe par pièce (champ room) quand l'artisan les distingue.
- Ne crée pas de lignes pour ce qui n'a pas été demandé.`;

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function catalogContext() {
  const rows = db.prepare('SELECT id,label,unit,price_ht,category FROM catalog_items WHERE archived=0 ORDER BY category,label LIMIT 600').all();
  return rows.map((r) => `${r.id} | ${r.label} | ${r.unit} | ${r.price_ht} € HT`).join('\n');
}

function resolveProject(out, projectId) {
  if (projectId) { const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId); if (!p) throw err('Intervention introuvable.', 404); return { project: p, created: false }; }
  const name = String(out.client_name || '').trim(); if (!name) throw err("Le nom du client n'a pas été compris : précisez-le (« devis pour M. Martin… ») ou choisissez une affaire existante.");
  const n = norm(name);
  const cands = db.prepare("SELECT * FROM contacts WHERE kind NOT IN ('fournisseur','sous_traitant','apporteur')").all().filter((c) => { const a = norm(c.name), b = norm(c.company); return a === n || b === n || (n.length > 3 && (a.includes(n) || n.includes(a) && a.length > 3)); });
  let contact = cands.length === 1 ? cands[0] : null; let created = false;
  if (!contact) {
    const id = db.prepare("INSERT INTO contacts(kind,name,phone,email,address,city,source) VALUES('prospect',?,?,?,?,?,'Assistant IA')").run(name, out.client_phone || null, out.client_email || null, out.address || null, out.city || null).lastInsertRowid;
    contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(id); created = true;
  }
  const title = String(out.project_title || 'Travaux').trim();
  let project = db.prepare("SELECT * FROM projects WHERE contact_id=? AND lower(title)=lower(?) AND stage IN ('prospect','visite_technique','devis_envoye')").get(contact.id, title);
  if (!project) { const id = db.prepare('INSERT INTO projects(contact_id,title,address,city,stage) VALUES(?,?,?,?,?)').run(contact.id, title, out.address || contact.address || null, out.city || contact.city || null, 'prospect').lastInsertRowid; project = db.prepare('SELECT * FROM projects WHERE id=?').get(id); }
  return { project, contact, created };
}

/** Crée le brouillon à partir de la sortie structurée du modèle. Jamais envoyé : il apparaît dans « Devis » en brouillon. */
export function createDraft(out, { projectId, token, log }) {
  const S = getSettings(); const lines = Array.isArray(out.lines) ? out.lines.slice(0, 80) : [];
  if (!lines.length) throw err("Aucune prestation n'a été identifiée : décrivez les travaux (pièce, ouvrage, surface).");
  const { project, created } = resolveProject(out, projectId);
  const qid = db.prepare('INSERT INTO quotes(project_id,kind,public_token,validity_days,deposit_rate,title) VALUES(?,?,?,?,?,?)').run(project.id, 'devis', token(), Number(S.quote_validity_days), Number(S.deposit_rate), project.title).lastInsertRowid;
  const sections = new Map(); let pos = 0; let toPrice = 0; let priced = 0; const warnings = [...(out.warnings || [])];
  const section = (room) => {
    const t = String(room || '').trim() || 'Travaux';
    if (!sections.has(t)) sections.set(t, db.prepare('INSERT INTO sections(quote_id,title,position) VALUES(?,?,?)').run(qid, t, pos++).lastInsertRowid);
    return sections.get(t);
  };
  const ins = db.prepare('INSERT INTO lines(quote_id,section_id,position,item_id,label,description,qty,unit,vat,cost_material,labor_hours,labor_rate,cost_sub,price_ht,to_price) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  let n = 0;
  for (const l of lines) {
    const qty = Number(l.qty) > 0 ? Number(l.qty) : 1; const sid = section(l.room);
    const it = l.catalog_id ? db.prepare('SELECT * FROM catalog_items WHERE id=? AND archived=0').get(Number(l.catalog_id)) : null;
    const desc = [l.description, it && ouvrageDescription(it.id)].filter(Boolean).join('\n') || null;
    const vat = it ? it.vat : Number(S.vat_default);
    // Prix énoncé par l'artisan : converti en prix unitaire HT (jamais inventé).
    let said = null; const a = Number(l.amount);
    if (l.amount != null && Number.isFinite(a) && a > 0) {
      const kind = ['unitaire_ht', 'unitaire_ttc', 'total_ht', 'total_ttc'].includes(l.amount_kind) ? l.amount_kind : 'unitaire_ht';
      let u = kind.startsWith('total') ? a / qty : a; if (kind.endsWith('ttc')) { u = u / (1 + vat / 100); warnings.push(`« ${l.label} » : prix TTC converti en HT avec une TVA de ${vat} %, à vérifier.`); }
      said = round2(u);
    }
    if (it) {
      if (said != null && Math.abs(said - it.price_ht) > 0.004) warnings.push(`« ${it.label} » : prix dicté ${said} € HT au lieu de ${it.price_ht} € au catalogue.`);
      ins.run(qid, sid, n++, it.id, it.label, desc, qty, it.unit, it.vat, it.cost_material, it.labor_hours, it.labor_rate, it.cost_sub, said ?? it.price_ht, 0);
    } else if (said != null) { priced++; ins.run(qid, sid, n++, null, String(l.label || 'Prestation').trim(), desc, qty, String(l.unit || 'u'), vat, 0, 0, Number(S.default_labor_rate), 0, said, 0); }
    else { toPrice++; ins.run(qid, sid, n++, null, String(l.label || 'Prestation').trim(), desc, qty, String(l.unit || 'u'), vat, 0, 0, Number(S.default_labor_rate), 0, 0, 1); }
  }
  if (priced) warnings.push(`${priced} ligne(s) hors catalogue au prix dicté : coût de revient non renseigné, marge non calculée.`);
  if (toPrice) warnings.push(`${toPrice} ligne(s) sans prix : à chiffrer.`);
  log('devis', `Brouillon de devis préparé par l'assistant IA (${n} ligne(s))`, { contact_id: project.contact_id, project_id: project.id });
  return { quote_id: qid, project_id: project.id, contact_id: project.contact_id, lines: n, to_price: toPrice, warnings, created_contact: created };
}

export async function draftFromText(text, opts) {
  const t = String(text || '').trim(); if (t.length < 8) throw err('Décrivez les travaux (client, pièces, prestations, surfaces).');
  if (t.length > 6000) throw err('Texte trop long (6000 caractères maximum).');
  const out = await callClaude({ system: SYSTEM_DEVIS, tool: QUOTE_TOOL, content: `CATALOGUE (id | désignation | unité | prix) :\n${catalogContext()}\n\nDEMANDE DE L'ARTISAN :\n${t}` });
  return createDraft(out, opts);
}

/* ------------------------------------------------------------------ Facture fournisseur */
const EXPENSE_TOOL = {
  name: 'extraire_facture_fournisseur', description: "Extrait les informations d'une facture d'achat.",
  input_schema: {
    type: 'object', properties: {
      supplier: { type: 'string', description: "Nom du fournisseur (émetteur de la facture)" }, invoice_ref: { type: 'string', description: 'Numéro de facture' },
      date: { type: 'string', description: 'Date de facture AAAA-MM-JJ' }, label: { type: 'string', description: 'Objet en quelques mots (ex. Carrelage 60×60, enduit)' },
      amount_ht: { type: 'number' }, vat_rate: { type: 'number', description: 'Taux de TVA principal en % (20, 10, 5.5)' }, amount_ttc: { type: 'number' },
      kind: { type: 'string', enum: ['fourniture', 'sous_traitance', 'autre'] }, notes: { type: 'string', description: 'Doute ou information illisible' },
    }, required: ['supplier'],
  },
};
export async function scanExpense(file) {
  const buf = fs.readFileSync(path.join(DATA_DIR, 'uploads', file.filename)); const data = buf.toString('base64'); const mt = file.mimetype;
  const block = mt === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: mt, data } }
    : /^image\/(jpeg|png|gif|webp)$/.test(mt) ? { type: 'image', source: { type: 'base64', media_type: mt, data } } : null;
  if (!block) throw err('Format non pris en charge : envoyez un PDF ou une photo (JPEG, PNG).');
  const out = await callClaude({ system: "Tu lis des factures d'achat d'une entreprise du bâtiment (SAMLOCK est le CLIENT, jamais le fournisseur). Extrais uniquement ce qui est écrit sur le document ; n'invente rien. Montants en euros, nombres décimaux.", tool: EXPENSE_TOOL, max_tokens: 1000,
    content: [block, { type: 'text', text: 'Extrais les informations de cette facture.' }] });
  const warn = [];
  const ht = Number(out.amount_ht), ttc = Number(out.amount_ttc), rate = out.vat_rate != null ? Number(out.vat_rate) : null;
  if (out.amount_ht != null && out.amount_ttc != null && rate != null && Math.abs(round2(ht * (1 + rate / 100)) - ttc) > 0.05) warn.push('Les montants HT, TVA et TTC ne concordent pas : vérifiez-les.');
  if (out.notes) warn.push(out.notes);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(out.date || '') ? out.date : null;
  return { supplier: out.supplier || '', invoice_ref: out.invoice_ref || '', date, label: out.label || '', amount_ht: Number.isFinite(ht) ? ht : null, vat: rate, kind: out.kind || 'fourniture', warnings: warn };
}

/* ------------------------------------------------------------------ WhatsApp (Meta Cloud API) */
const digits = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length === 10 && d[0] === '0' ? '33' + d.slice(1) : d; }; // 06 11… → 33611…
const GRAPH = () => (process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
export async function sendWhatsApp(to, body) {
  const S = getSettings(); if (!S.whatsapp_token || !S.whatsapp_phone_id) return false;
  try {
    const r = await fetch(`${GRAPH()}/${S.whatsapp_phone_id}/messages`, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', authorization: `Bearer ${S.whatsapp_token}` }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } }) });
    return r.ok;
  } catch { return false; }
}

export function mountAgent(app, { token, log, upload, APP_URL }) {
  app.get('/api/agent/status', (_q, res) => res.json({ ready: agentReady(), whatsapp: !!(getSettings().whatsapp_token && getSettings().whatsapp_phone_id && getSettings().whatsapp_app_secret) }));
  app.post('/api/agent/devis', async (req, res) => {
    try { res.json(await draftFromText(req.body.text, { projectId: Number(req.body.project_id) || null, token, log })); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/agent/scan-expense', upload.single('file'), async (req, res) => {
    try { if (!req.file) throw err('Joignez la facture (PDF ou photo).'); res.json(await scanExpense(req.file)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
    finally { if (req.file) try { fs.unlinkSync(path.join(DATA_DIR, 'uploads', req.file.filename)); } catch { /* déjà supprimé */ } }
  });

  // Webhook WhatsApp : public (hors connexion) mais protégé par la signature Meta et la liste de numéros autorisés.
  app.get('/api/public/whatsapp', (req, res) => {
    const S = getSettings();
    if (req.query['hub.mode'] === 'subscribe' && S.whatsapp_verify_token && req.query['hub.verify_token'] === S.whatsapp_verify_token) return res.status(200).send(String(req.query['hub.challenge']));
    res.sendStatus(403);
  });
  app.post('/api/public/whatsapp', (req, res) => {
    const S = getSettings();
    const secret = S.whatsapp_app_secret; const sig = String(req.get('x-hub-signature-256') || '');
    if (!secret || !req.rawBody) return res.sendStatus(403);
    const want = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    const a = Buffer.from(sig), b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(403);
    res.sendStatus(200); // Meta exige une réponse rapide : le traitement continue en arrière-plan
    const allowed = String(S.whatsapp_allowed || '').split(/[,;\n]+/).map(digits).filter(Boolean);
    for (const entry of req.body.entry || []) for (const ch of entry.changes || []) for (const m of ch.value?.messages || []) {
      const from = digits(m.from); if (!allowed.includes(from)) continue;
      if (db.prepare('SELECT 1 FROM wa_messages WHERE id=?').get(m.id)) continue; db.prepare('INSERT INTO wa_messages(id) VALUES(?)').run(m.id);
      (async () => {
        if (m.type !== 'text') return void sendWhatsApp(from, "Je ne sais pas encore lire les messages vocaux ou les pièces jointes. Envoyez-moi le texte (vous pouvez le dicter avec le micro du clavier) : client, pièces, prestations, surfaces.");
        try {
          const r = await draftFromText(m.text?.body, { token, log });
          await sendWhatsApp(from, `✅ Brouillon de devis prêt (${r.lines} ligne(s)${r.to_price ? `, dont ${r.to_price} à chiffrer` : ''}).${r.created_contact ? '\nNouveau client créé.' : ''}${r.warnings.length ? '\n⚠️ ' + r.warnings.join('\n⚠️ ') : ''}\n\nÀ relire et valider : ${APP_URL}/devis/${r.quote_id}\nRien n'est envoyé au client sans votre validation.`);
        } catch (e) { await sendWhatsApp(from, `Je n'ai pas pu préparer le devis : ${e.message}`); }
      })();
    }
  });
}
