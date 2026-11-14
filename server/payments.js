// Paiement en ligne par carte (Stripe Checkout) : lien « Payer » dans les e-mails de facture.
// Aucune donnée bancaire ne transite par l'application. La facture est marquée payée à réception du webhook Stripe signé.
import crypto from 'node:crypto';
import { db, getSettings } from './db.js';

const API = process.env.STRIPE_API_BASE || 'https://api.stripe.com';
const cfg = () => { const S = getSettings(); return { key: (S.stripe_secret || process.env.STRIPE_SECRET_KEY || '').trim(), whsec: (S.stripe_webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || '').trim() }; };
export const paymentsEnabled = () => /^(sk|rk)_/.test(cfg().key);

/** Ligne à ajouter dans un e-mail de facture (vide si le paiement en ligne n'est pas configuré). */
export const payLine = (appUrl, token) => (paymentsEnabled() ? `\n\nPayer en ligne par carte bancaire : ${appUrl}/payer/${token}` : '');

const form = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? form(v, pre ? `${pre}[${k}]` : k) : [[pre ? `${pre}[${k}]` : k, String(v)]]));

async function createSession(inv, appUrl) {
  const S = getSettings(); const { key } = cfg();
  const cents = Math.round(inv.total_ttc * 100);
  const params = new URLSearchParams(form({
    mode: 'payment', locale: 'fr', client_reference_id: String(inv.id),
    success_url: `${appUrl}/payer/merci`, cancel_url: `${appUrl}/payer/${inv.public_token}`,
    customer_email: inv.email || undefined,
    metadata: { invoice_id: String(inv.id), number: inv.number || '' },
    payment_intent_data: { description: `${inv.number} — ${S.company_name || 'SAMLOCK'}`, metadata: { invoice_id: String(inv.id) } },
    line_items: { 0: { quantity: 1, price_data: { currency: 'eur', unit_amount: cents, product_data: { name: `Facture ${inv.number}`, description: inv.title || undefined } } } },
  }));
  const r = await fetch(`${API}/v1/checkout/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(j.error?.message || `Stripe : erreur ${r.status}`);
  return j.url;
}

const page = (title, msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;background:#f7f6f0;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#fff;border:1px solid #e6e3d8;border-radius:16px;padding:32px;max-width:420px;text-align:center"><h2 style="margin:0 0 8px;color:#FF6D1A">${title}</h2><p style="color:#57534e">${msg}</p></div>`;

export function mountPayments(app, { log, APP_URL }) {
  app.get('/payer/merci', (_req, res) => res.type('html').send(page('Merci !', 'Votre paiement a bien été pris en compte. Vous recevrez une confirmation de votre banque.')));
  app.get('/payer/:token', async (req, res) => {
    try {
      const inv = db.prepare('SELECT i.*, c.email FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id WHERE i.public_token=?').get(req.params.token);
      if (!inv || !inv.number) return res.status(404).type('html').send(page('Facture introuvable', 'Ce lien n\'est plus valide.'));
      if (inv.status === 'payee') return res.type('html').send(page('Déjà réglée', `La facture ${inv.number} est déjà payée. Merci !`));
      if (inv.status !== 'envoyee' || inv.total_ttc <= 0) return res.status(400).type('html').send(page('Paiement indisponible', 'Cette facture ne peut pas être réglée en ligne.'));
      if (!paymentsEnabled()) return res.status(503).type('html').send(page('Paiement indisponible', 'Le paiement en ligne n\'est pas activé. Merci de régler par virement (coordonnées sur la facture).'));
      res.redirect(303, await createSession(inv, APP_URL));
    } catch (e) { console.warn('stripe', e.message); res.status(502).type('html').send(page('Paiement indisponible', 'Le service de paiement ne répond pas. Réessayez dans un instant ou réglez par virement.')); }
  });

  app.get('/api/payments/status', (_req, res) => res.json({ enabled: paymentsEnabled(), webhook: !!cfg().whsec }));

  // Webhook Stripe : signature vérifiée (HMAC-SHA256, tolérance 5 min)
  app.post('/api/public/stripe/webhook', (req, res) => {
    const { whsec } = cfg(); const raw = req.rawBody;
    if (!whsec || !raw) return res.status(400).json({ error: 'Webhook non configuré.' });
    const h = String(req.headers['stripe-signature'] || '');
    const t = /t=(\d+)/.exec(h)?.[1]; const sigs = [...h.matchAll(/v1=([0-9a-f]+)/g)].map((m) => m[1]);
    if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return res.status(400).json({ error: 'Signature invalide.' });
    const exp = crypto.createHmac('sha256', whsec).update(`${t}.${raw.toString('utf8')}`).digest('hex');
    if (!sigs.some((s) => s.length === exp.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp)))) return res.status(400).json({ error: 'Signature invalide.' });
    const ev = req.body;
    if (ev?.type === 'checkout.session.completed' && ev.data?.object?.payment_status === 'paid') {
      const id = Number(ev.data.object.metadata?.invoice_id);
      const inv = id && db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
      const paid = Math.round(Number(ev.data.object.amount_total || 0));
      if (inv && inv.status === 'envoyee' && paid === Math.round(inv.total_ttc * 100)) {
        db.prepare("UPDATE invoices SET status='payee', paid_at=date('now') WHERE id=?").run(inv.id);
        const p = db.prepare('SELECT * FROM projects WHERE id=?').get(inv.project_id);
        log('devis', `Facture ${inv.number} payée en ligne par carte`, { contact_id: p.contact_id, project_id: p.id });
      }
    }
    res.json({ received: true });
  });
}
