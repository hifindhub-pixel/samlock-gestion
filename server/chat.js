// Assistant IA SAMLOCK (texte ou dictée) : répond aux questions sur l'activité et prépare des BROUILLONS de devis ou de factures.
// Règles : jamais d'envoi, jamais de validation, jamais de prix inventé. Tout brouillon est à relire dans l'appli.
// Coût maîtrisé : un petit modèle trie la demande ; le modèle précis n'intervient que pour chiffrer un brouillon.
import { db, getSettings, round2 } from './db.js';
import { claude, err } from './ai-core.js';
import { QUOTE_TOOL_DEF, INVOICE_TOOL, SYSTEM_DEVIS_TEXT, createDraft, createInvoiceDraft } from './agent.js';

const eur = (n) => `${round2(n || 0)} €`;
const d10 = (s) => (s || '').slice(0, 10);

function snapshot(quoteTotals) {
  const L = [];
  const today = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  L.push(`Date : ${today}`);
  const contacts = db.prepare("SELECT id,kind,name,company,email,phone,address,city FROM contacts ORDER BY id DESC LIMIT 250").all();
  L.push(`\nCONTACTS (${contacts.length}) : type | nom | société | tél | email | ville`);
  for (const c of contacts) L.push([c.kind, c.name, c.company || '', c.phone || '', c.email || '', c.city || ''].join(' | '));
  const quotes = db.prepare("SELECT q.id,q.number,q.status,q.title,q.created_at,q.sent_at,q.signed_at,p.title ptitle,c.name cname FROM quotes q JOIN projects p ON p.id=q.project_id JOIN contacts c ON c.id=p.contact_id WHERE q.imported=0 AND q.kind='devis' ORDER BY q.id DESC LIMIT 100").all();
  L.push(`\nDEVIS (${quotes.length}) : numéro | statut | client | objet | HT | TTC | créé | envoyé | signé`);
  for (const q of quotes) { let t = {}; try { t = quoteTotals(q.id) || {}; } catch { /* devis vide */ } L.push([q.number || 'brouillon', q.status, q.cname, q.ptitle, eur(t.ht), eur(t.ttc), d10(q.created_at), d10(q.sent_at), d10(q.signed_at)].join(' | ')); }
  const inv = db.prepare("SELECT i.number,i.kind,i.status,i.total_ht,i.total_ttc,i.issued_at,i.due_at,i.paid_at,c.name cname FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id ORDER BY i.id DESC LIMIT 200").all();
  L.push(`\nFACTURES (${inv.length} dernières) : numéro | type | statut | client | HT | TTC | émise | échéance | payée`);
  for (const i of inv) L.push([i.number || 'brouillon', i.kind, i.status, i.cname, eur(i.total_ht), eur(i.total_ttc), d10(i.issued_at), d10(i.due_at), d10(i.paid_at)].join(' | '));
  const stock = db.prepare('SELECT label,stock_qty,stock_min,stock_target,unit FROM catalog_items WHERE track_stock=1 AND archived=0 ORDER BY label').all();
  L.push(`\nSTOCK (${stock.length} articles suivis) : désignation | quantité | seuil mini | cible | unité`);
  for (const s of stock) L.push([s.label, s.stock_qty, s.stock_min || '', s.stock_target || '', s.unit].join(' | '));
  const cat = db.prepare('SELECT id,label,unit,price_ht FROM catalog_items WHERE archived=0 ORDER BY category,label LIMIT 700').all();
  L.push(`\nCATALOGUE (${cat.length}) : id | désignation | unité | prix HT`);
  for (const c of cat) L.push(`${c.id} | ${c.label} | ${c.unit} | ${c.price_ht} €`);
  return L.join('\n');
}

const RULES = `Tu es l'assistant de gestion de SAMLOCK, serrurerie et dépannage à Montpellier. Tu réponds en français, de façon courte et concrète, au dirigeant. Le message peut venir d'une dictée vocale : orthographe approximative, noms propres déformés.
Règles absolues :
- Questions sur l'activité : réponds uniquement avec les DONNÉES fournies. N'invente aucun chiffre, client, date ni quantité. Si l'information manque (ou dépasse les dernières lignes fournies), dis-le. Pour un calcul, donne le détail.
- Tu ne peux rien envoyer, valider, supprimer ni modifier. Tu peux seulement PRÉPARER un brouillon avec les outils : creer_brouillon_devis (devis à proposer à un client) ou creer_brouillon_facture (intervention déjà faite, facturée sans devis).
- N'appelle un outil que si la demande est claire (client + prestations). Sinon pose UNE question courte. Si le nom du client correspond à plusieurs contacts ou à aucun et que c'est ambigu, demande de préciser.
- Pour un brouillon : n'invente jamais un prix ; reprends le prix dit à voix haute, sinon le prix du catalogue ; pour une facture, un prix absent bloque.
- Montants en euros. Pas de formules de politesse inutiles.`;

export function mountChat(app, { quoteTotals, token, log }) {
  app.post('/api/chat', async (req, res) => {
    try {
      const S = getSettings();
      const raw = Array.isArray(req.body.messages) ? req.body.messages : [];
      const messages = raw.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-16).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      if (!messages.length || messages[messages.length - 1].role !== 'user') throw err('Posez votre question.');
      const system = [{ type: 'text', text: RULES }, { type: 'text', text: `DONNÉES :\n${snapshot(quoteTotals)}`, cache_control: { type: 'ephemeral' } }];
      const tools = [
        { name: QUOTE_TOOL_DEF.name, description: "Prépare un BROUILLON de devis (rien n'est envoyé). À utiliser quand on demande de faire / préparer un devis.", input_schema: QUOTE_TOOL_DEF.input_schema },
        { name: INVOICE_TOOL.name, description: INVOICE_TOOL.description + " Brouillon à relire ; rien n'est envoyé.", input_schema: INVOICE_TOOL.input_schema },
      ];
      // 1) tri par le petit modèle : répond, ou choisit un outil
      const first = await claude({ kind: 'chat', model: S.chat_model || 'claude-haiku-5-5', max_tokens: 1200, system, messages, tools });
      const use = (first.content || []).find((c) => c.type === 'tool_use');
      const text1 = (first.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      if (!use) return res.json({ reply: text1 || "Je n'ai pas pu formuler de réponse. Reformulez la question." });

      // 2) brouillon : le modèle précis refait la structuration (prix, quantités, correspondance catalogue)
      const tool = tools.find((t) => t.name === use.name);
      const forced = await claude({ kind: use.name === INVOICE_TOOL.name ? 'facture' : 'devis', model: S.agent_model || 'claude-sonnet-5-5', max_tokens: 4000,
        system: [{ type: 'text', text: (use.name === INVOICE_TOOL.name ? SYSTEM_DEVIS_TEXT.replace(/prépares le brouillon de devis/, "prépares le brouillon de facture (intervention déjà réalisée)") : SYSTEM_DEVIS_TEXT) }, system[1]],
        messages, tools: [tool], tool_choice: { type: 'tool', name: tool.name } });
      const out = (forced.content || []).find((c) => c.type === 'tool_use')?.input;
      if (!out) throw err("Je n'ai pas pu structurer le brouillon. Précisez : client, prestations, prix.", 502);
      const warn = (r) => (r.warnings?.length ? `\n⚠️ ${r.warnings.join('\n⚠️ ')}` : '');
      if (use.name === INVOICE_TOOL.name) {
        const r = createInvoiceDraft(out, { log });
        return res.json({ reply: `Brouillon de facture prêt : ${r.lines} ligne(s), ${eur(r.total_ttc)} TTC.${r.created_contact ? '\nNouveau client ajouté (prospect).' : ''}${warn(r)}\nÀ relire et valider : rien n'est envoyé.`,
          action: { type: 'facture', label: 'Ouvrir la facture', url: `/dossier/${r.project_id}?tab=fact`, ...r } });
      }
      const r = createDraft(out, { token, log });
      return res.json({ reply: `Brouillon de devis prêt : ${r.lines} ligne(s)${r.to_price ? `, dont ${r.to_price} à chiffrer` : ''}.${r.created_contact ? '\nNouveau client ajouté (prospect).' : ''}${warn(r)}\nÀ relire : rien n'est envoyé au client.`,
        action: { type: 'devis', label: 'Ouvrir le devis', url: `/devis/${r.quote_id}`, ...r } });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}
