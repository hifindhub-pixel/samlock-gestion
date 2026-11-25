// Appel unique à l'API Claude pour tout l'assistant : clé, plafond mensuel de dépense, journal de consommation.
// Aucun prix de l'appli n'est jamais décidé ici : ce module ne fait que transporter la requête et compter le coût.
import { db, getSettings, round2 } from './db.js';

export const err = (m, status = 400) => Object.assign(new Error(m), { status });
export const apiKey = () => getSettings().anthropic_api_key || process.env.ANTHROPIC_API_KEY || '';
export const agentReady = () => !!apiKey();

// Tarifs publics en $ par million de jetons (entrée / sortie). Modèle inconnu → tarif prudent (le plus élevé connu).
const PRICES = [[/haiku/i, 0.10, 0.50], [/sonnet/i, 2, 10]];
const FALLBACK = [5, 25];
const USD_EUR = 0.92; // estimation fixe : le coût affiché est indicatif, la facture réelle est sur console.anthropic.com

export const priceOf = (model) => { const p = PRICES.find(([re]) => re.test(model || '')); return p ? [p[1], p[2]] : FALLBACK; };

export function monthSpent() {
  const r = db.prepare("SELECT COALESCE(SUM(cost_eur),0) s, COUNT(*) n FROM ai_usage WHERE at >= strftime('%Y-%m-01','now')").get();
  return { eur: round2(r.s), calls: r.n };
}
export function usageSummary() {
  const S = getSettings(); const m = monthSpent();
  const kinds = db.prepare("SELECT kind, COUNT(*) n, ROUND(SUM(cost_eur),4) eur FROM ai_usage WHERE at >= strftime('%Y-%m-01','now') GROUP BY kind ORDER BY eur DESC").all();
  return { ready: agentReady(), month_eur: m.eur, calls: m.calls, budget_eur: Number(S.ai_budget_month) || 0, by_kind: kinds };
}

function record(kind, model, usage = {}) {
  const [pin, pout] = priceOf(model);
  const tin = (usage.input_tokens || 0) + 1.25 * (usage.cache_creation_input_tokens || 0) + 0.1 * (usage.cache_read_input_tokens || 0);
  const tout = usage.output_tokens || 0;
  const eur = ((tin * pin + tout * pout) / 1e6) * USD_EUR;
  db.prepare('INSERT INTO ai_usage(kind,model,tokens_in,tokens_out,cost_eur) VALUES(?,?,?,?,?)').run(kind, model, Math.round(tin), tout, eur);
}

/** Requête Messages. `system` : texte ou tableau de blocs (un bloc peut porter cache_control pour réduire le coût des relectures). */
export async function claude({ kind, model, system, messages, tools, tool_choice, max_tokens = 1500 }) {
  const key = apiKey(); if (!key) throw err("L'assistant IA n'est pas activé : renseignez la clé API dans Paramètres.", 400);
  const S = getSettings(); const cap = Number(S.ai_budget_month) || 0;
  if (cap > 0) { const m = monthSpent(); if (m.eur >= cap) throw err(`Plafond mensuel de l'assistant atteint (${m.eur.toFixed(2)} € sur ${cap} €). Augmentez-le dans Paramètres si besoin.`, 429); }
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const body = { model, max_tokens, system, messages }; if (tools) body.tools = tools; if (tool_choice) body.tool_choice = tool_choice;
  let r;
  try {
    r = await fetch(`${base}/v1/messages`, { method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  } catch (e) { throw err(`Service IA injoignable (${e.name === 'TimeoutError' ? 'délai dépassé' : e.message}).`, 502); }
  const j = await r.json().catch(() => ({}));
  if (j.usage) record(kind, model, j.usage);
  if (!r.ok) {
    if (r.status === 401) throw err('Clé API refusée par le service IA : vérifiez-la dans Paramètres.', 400);
    if (r.status === 400 && /credit balance/i.test(j.error?.message || '')) throw err("Le crédit du compte Claude est épuisé : rechargez-le sur console.anthropic.com (Billing).", 402);
    if (r.status === 404) throw err(`Modèle « ${model} » introuvable : corrigez le nom du modèle dans Paramètres.`, 400);
    throw err(`Service IA : ${j.error?.message || r.status}`, 502);
  }
  return j;
}
