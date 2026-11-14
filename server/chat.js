// Chat IA SAMLOCK : questions en langage naturel sur l'activité. LECTURE SEULE : l'assistant ne modifie rien,
// n'envoie rien et n'invente aucun chiffre ; il répond uniquement à partir d'un instantané des données de l'appli.
import { db, getSettings, round2 } from './db.js';
import { apiKey } from './agent.js';

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const eur = (n) => `${round2(n || 0)} €`;

function snapshot(quoteTotals) {
  const L = [];
  const today = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  L.push(`Date : ${today}`);
  const contacts = db.prepare('SELECT id,kind,name,company,email,phone,city,decennale_until,urssaf_until FROM contacts ORDER BY id DESC LIMIT 150').all();
  L.push(`\nCONTACTS (${contacts.length}) : id | type | nom | société | tél | email | ville | assurance RC | URSSAF`);
  for (const c of contacts) L.push([c.id, c.kind, c.name, c.company || '', c.phone || '', c.email || '', c.city || '', c.decennale_until || '', c.urssaf_until || ''].join(' | '));
  const projects = db.prepare('SELECT p.id,p.title,p.stage,p.city,c.name cname FROM projects p JOIN contacts c ON c.id=p.contact_id ORDER BY p.updated_at DESC LIMIT 120').all();
  L.push(`\nAFFAIRES (${projects.length}) : id | titre | étape | ville | client`);
  for (const p of projects) L.push([p.id, p.title, p.stage, p.city || '', p.cname].join(' | '));
  const quotes = db.prepare("SELECT q.id,q.number,q.kind,q.status,q.title,q.created_at,q.sent_at,q.signed_at,p.title ptitle,c.name cname FROM quotes q JOIN projects p ON p.id=q.project_id JOIN contacts c ON c.id=p.contact_id WHERE q.imported=0 ORDER BY q.id DESC LIMIT 120").all();
  L.push(`\nDEVIS/AVENANTS (${quotes.length}) : numéro | statut | client | intervention | HT | TTC | marge % | créé | envoyé | signé`);
  for (const q of quotes) { let t = {}; try { t = quoteTotals(q.id) || {}; } catch {} L.push([q.number || 'brouillon', q.status, q.cname, q.ptitle, eur(t.ht), eur(t.ttc), t.margin_pct ?? '', (q.created_at || '').slice(0, 10), (q.sent_at || '').slice(0, 10), (q.signed_at || '').slice(0, 10)].join(' | ')); }
  const inv = db.prepare("SELECT i.number,i.kind,i.status,i.total_ht,i.total_ttc,i.issued_at,i.due_at,i.paid_at,c.name cname FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id ORDER BY i.id DESC LIMIT 150").all();
  L.push(`\nFACTURES (${inv.length}) : numéro | type | statut | client | HT | TTC | émise | échéance | payée`);
  for (const i of inv) L.push([i.number || 'brouillon', i.kind, i.status, i.cname, eur(i.total_ht), eur(i.total_ttc), (i.issued_at || '').slice(0, 10), (i.due_at || '').slice(0, 10), (i.paid_at || '').slice(0, 10)].join(' | '));
  const tasks = db.prepare('SELECT title,due_at,done FROM tasks WHERE done=0 ORDER BY due_at IS NULL, due_at LIMIT 40').all();
  L.push(`\nTÂCHES À FAIRE (${tasks.length}) : titre | échéance`);
  for (const t of tasks) L.push(`${t.title} | ${t.due_at || ''}`);
  return L.join('\n');
}

export function mountChat(app, { quoteTotals }) {
  app.post('/api/chat', async (req, res) => {
    try {
      const key = apiKey(); if (!key) throw err("L'assistant IA n'est pas activé : renseignez votre clé API dans Paramètres.");
      const raw = Array.isArray(req.body.messages) ? req.body.messages : [];
      const messages = raw.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-16).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      if (!messages.length || messages[messages.length - 1].role !== 'user') throw err('Posez votre question.');
      const system = `Tu es l'assistant de gestion de SAMLOCK (entreprise du bâtiment). Tu réponds en français, de façon concise et concrète, aux questions du dirigeant sur son activité, uniquement à partir des DONNÉES ci-dessous. Règles : n'invente aucun chiffre, prix, client ni date ; si l'information n'est pas dans les données, dis-le. Tu es en lecture seule : tu ne peux ni créer, ni modifier, ni envoyer quoi que ce soit — si on te le demande, indique où le faire dans l'appli (Devis, Factures, Agenda, Validations…). Pour les calculs, donne le détail. Montants en euros.\n\nDONNÉES :\n${snapshot(quoteTotals)}`;
      const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
      let r;
      try {
        r = await fetch(`${base}/v1/messages`, { method: 'POST', signal: AbortSignal.timeout(90000),
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: getSettings().agent_model || 'claude-sonnet-5-5', max_tokens: 1500, system, messages }) });
      } catch (e) { throw err(`Service IA injoignable (${e.name === 'TimeoutError' ? 'délai dépassé' : e.message}).`, 502); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw err(r.status === 401 ? 'Clé API refusée par le service IA : vérifiez-la dans Paramètres.' : `Service IA : ${j.error?.message || r.status}`, r.status === 401 ? 400 : 502);
      const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      res.json({ reply: text || "Je n'ai pas pu formuler de réponse. Reformulez la question." });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}
