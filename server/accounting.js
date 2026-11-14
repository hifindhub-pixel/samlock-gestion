// Connecteur comptable : un format neutre (toCanonical) + des adaptateurs interchangeables.
// Ajouter Tiime/Pennylane/autre = ajouter une entrée dans PROVIDERS, rien d'autre ne change.
import { PassThrough } from 'node:stream';
import { db, getSettings, round2 } from './db.js';
import { loadInvoice } from './billing.js';
import { renderInvoicePdf } from './pdf2.js';

db.exec(`
CREATE TABLE IF NOT EXISTS accounting_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, provider TEXT NOT NULL,
  status TEXT NOT NULL, external_id TEXT, error TEXT, synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(invoice_id, provider)
);
CREATE TABLE IF NOT EXISTS accounting_map (
  provider TEXT NOT NULL, kind TEXT NOT NULL, local_id INTEGER NOT NULL, external_id TEXT NOT NULL,
  PRIMARY KEY(provider, kind, local_id)
);`);

export const toCanonical = (inv, appUrl) => ({
  number: inv.number, kind: inv.kind, title: inv.title, date: (inv.issued_at || '').slice(0, 10), due: inv.due_at, paid_at: inv.paid_at,
  customer: { local_id: inv.contact.id, name: inv.contact.company || inv.contact.name, email: inv.contact.email, address: inv.contact.address, postal: inv.contact.postal, city: inv.contact.city, siret: inv.contact.siret },
  lines: inv.lines.map((l) => ({ label: l.label, ht: l.base_ht, vat: l.vat })),
  totals: { ht: inv.total_ht, tva: inv.total_tva, ttc: inv.total_ttc }, pdf_url: `${appUrl}/api/public/invoices/${inv.public_token}/pdf`,
});

const pdfBuffer = (inv) => new Promise((resolve, reject) => {
  const pt = new PassThrough(); const chunks = [];
  pt.on('data', (c) => chunks.push(c)); pt.on('end', () => resolve(Buffer.concat(chunks))); pt.on('error', reject);
  renderInvoicePdf(inv, pt);
});

/* ---- Adaptateur Pennylane API v2 (documentation : pennylane.readme.io)
   ⚠ Écrit d'après la doc publique, NON testé : à valider avec le Sandbox Pennylane et un jeton (PENNYLANE_TOKEN).
   Pennylane n'est pas idempotent : on ne renvoie jamais une facture déjà synchronisée. */
const pennylane = {
  label: 'Pennylane (API v2)', kind: 'api',
  ready: () => !!process.env.PENNYLANE_TOKEN,
  async push(inv, c) {
    const base = process.env.PENNYLANE_URL || 'https://app.pennylane.com/api/external/v2'; const H = { Authorization: `Bearer ${process.env.PENNYLANE_TOKEN}` };
    const call = async (path, opt = {}) => {
      const r = await fetch(base + path, { ...opt, headers: { ...H, ...(opt.headers || {}) } }); const t = await r.text();
      if (!r.ok) throw new Error(`Pennylane ${r.status} sur ${path} : ${t.slice(0, 300)}`); return t ? JSON.parse(t) : {};
    };
    // 1. Client (créé une fois, puis mémorisé)
    let cid = db.prepare("SELECT external_id FROM accounting_map WHERE provider='pennylane' AND kind='customer' AND local_id=?").get(c.customer.local_id)?.external_id;
    if (!cid) {
      const body = { name: c.customer.name, emails: c.customer.email ? [c.customer.email] : [], billing_address: { address: c.customer.address || '', postal_code: c.customer.postal || '', city: c.customer.city || '', country_alpha2: 'FR' } };
      const r = await call('/company_customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      cid = String(r.id); db.prepare("INSERT OR REPLACE INTO accounting_map VALUES('pennylane','customer',?,?)").run(c.customer.local_id, cid);
    }
    // 2. PDF puis 3. import de la facture
    const fd = new FormData(); fd.append('file', new Blob([await pdfBuffer(inv)], { type: 'application/pdf' }), `${inv.number}.pdf`);
    const att = await call('/file_attachments', { method: 'POST', body: fd });
    const vatCode = (v) => ({ 20: 'FR_200', 10: 'FR_100', 5.5: 'FR_55', 0: 'exempt' }[Number(v)] || 'FR_200');
    const r = await call('/customer_invoices/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_attachment_id: att.id, customer_id: Number(cid), date: c.date, deadline: c.due, invoice_number: c.number, currency_amount_before_tax: String(c.totals.ht), currency_amount: String(c.totals.ttc), currency_tax: String(c.totals.tva),
        invoice_lines: c.lines.map((l) => ({ label: l.label, quantity: 1, raw_currency_unit_price: String(l.ht), unit: 'forfait', vat_rate: vatCode(l.vat), currency_amount: String(round2(l.ht * (1 + l.vat / 100))), currency_tax: String(round2(l.ht * l.vat / 100)) })) }),
    });
    return String(r.id || '');
  },
};

/* ---- Adaptateur webhook : pour Tiime (aucune API publique trouvée) via Make/Zapier/n8n, ou tout autre outil. */
const webhook = {
  label: 'Webhook (Make, Zapier… → Tiime)', kind: 'api',
  ready: () => !!getSettings().accounting_webhook_url,
  async push(_inv, c) {
    const r = await fetch(getSettings().accounting_webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
    if (!r.ok) throw new Error(`Webhook ${r.status}`); return '';
  },
};

export const PROVIDERS = {
  export: { label: 'Export FEC / CSV (import manuel)', kind: 'file', ready: () => true },
  pennylane, webhook,
};

export async function syncInvoice(id, appUrl) {
  const S = getSettings(); const prov = PROVIDERS[S.accounting_provider];
  if (!prov?.push) throw Object.assign(new Error('Aucun connecteur en ligne sélectionné : utilisez l\'export FEC / CSV.'), { status: 400 });
  if (!prov.ready()) throw Object.assign(new Error(`${prov.label} n'est pas configuré.`), { status: 400 });
  const inv = loadInvoice(id);
  if (inv?.kind === 'avoir' && S.accounting_provider === 'pennylane') throw Object.assign(new Error('Les avoirs ne sont pas encore transmis automatiquement à Pennylane : utilisez l\'export FEC / CSV.'), { status: 400 });
  if (!inv || inv.status === 'brouillon') throw Object.assign(new Error('Seule une facture envoyée peut être transmise.'), { status: 400 });
  if (db.prepare("SELECT 1 FROM accounting_sync WHERE invoice_id=? AND provider=? AND status='ok'").get(id, S.accounting_provider)) throw Object.assign(new Error('Déjà transmise à ce connecteur.'), { status: 400 });
  try {
    const ext = await prov.push(inv, toCanonical(inv, appUrl));
    db.prepare("INSERT INTO accounting_sync(invoice_id,provider,status,external_id) VALUES(?,?, 'ok',?) ON CONFLICT(invoice_id,provider) DO UPDATE SET status='ok', external_id=excluded.external_id, error=NULL, synced_at=datetime('now')").run(id, S.accounting_provider, ext);
  } catch (e) {
    db.prepare("INSERT INTO accounting_sync(invoice_id,provider,status,error) VALUES(?,?, 'error',?) ON CONFLICT(invoice_id,provider) DO UPDATE SET status='error', error=excluded.error, synced_at=datetime('now')").run(id, S.accounting_provider, String(e.message));
    throw Object.assign(e, { status: 502 });
  }
}

/* ---- Exports comptables (format tableur et FEC). Comptes par défaut à adapter par l'expert-comptable. */
const ACC = { sales: '706000', client: '411000', bank: '512000', vat: { 20: '44571200', 10: '44571100', 5.5: '44571055', 0: '44571000' } };
const fr = (n) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
const ymd = (s) => (s || '').slice(0, 10).replaceAll('-', '');
const csvCell = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };

function periodInvoices(from, to) {
  return db.prepare("SELECT id FROM invoices WHERE status IN ('envoyee','payee') AND substr(issued_at,1,10) BETWEEN ? AND ? ORDER BY issued_at, id").all(from, to).map((r) => loadInvoice(r.id));
}
export function exportCsv(from, to) {
  const head = ['Date', 'N° facture', 'Type', 'Client', 'SIRET', 'Intervention', 'HT', 'TVA', 'TTC', 'Échéance', 'Statut', 'Date paiement'];
  const rows = periodInvoices(from, to).map((i) => [i.issued_at.slice(0, 10), i.number, i.kind, i.contact.company || i.contact.name, i.contact.siret || '', i.project.title, fr(i.total_ht), fr(i.total_tva), fr(i.total_ttc), i.due_at, i.status === 'payee' ? 'Payée' : 'Envoyée', i.paid_at || '']);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}
export function exportFec(from, to) {
  const S = getSettings(); const siren = (S.company_siret || '').replace(/\D/g, '').slice(0, 9) || '000000000';
  const head = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
  const out = [head.join('\t')]; let n = 0;
  const line = (j, jl, num, date, cn, cl, aux, auxl, ref, lib, d0, c0) => { const d = (d0 > 0 ? d0 : 0) + (c0 < 0 ? -c0 : 0); const c = (c0 > 0 ? c0 : 0) + (d0 < 0 ? -d0 : 0); out.push([j, jl, num, ymd(date), cn, cl, aux, auxl, ref, ymd(date), lib, fr(d), fr(c), '', '', ymd(date), '', ''].join('\t')); };
  const aux = (i) => ['C' + String(i.contact.id).padStart(5, '0'), i.contact.company || i.contact.name];
  for (const i of periodInvoices(from, to)) {
    n++; const [ax, al] = aux(i); const lib = `${i.title || 'Facture'} ${i.number}`.slice(0, 100);
    line('VT', 'Journal des ventes', n, i.issued_at, ACC.client, 'Clients', ax, al, i.number, lib, i.total_ttc, 0);
    const vats = i.lines.map((l) => ({ ...l, tva: l.vat ? round2(l.base_ht * l.vat / 100) : 0 }));
    const ht = round2(i.lines.reduce((a, l) => a + l.base_ht, 0)); const sumV = round2(vats.reduce((a, l) => a + l.tva, 0));
    const gap = round2(i.total_ttc - ht - sumV); // écart d'arrondi : absorbé par la dernière ligne de TVA pour équilibrer l'écriture
    const lastV = vats.map((l) => l.tva > 0).lastIndexOf(true);
    vats.forEach((l, k) => { if (k === lastV) l.tva = round2(l.tva + gap); });
    for (const l of vats) { line('VT', 'Journal des ventes', n, i.issued_at, ACC.sales, 'Prestations de services', '', '', i.number, lib, 0, l.base_ht); if (l.tva) line('VT', 'Journal des ventes', n, i.issued_at, ACC.vat[l.vat] || ACC.vat[20], `TVA collectée ${l.vat} %`, '', '', i.number, lib, 0, l.tva); }
  }
  const paid = db.prepare("SELECT id FROM invoices WHERE status='payee' AND paid_at BETWEEN ? AND ? ORDER BY paid_at, id").all(from, to).map((r) => loadInvoice(r.id));
  for (const i of paid) {
    n++; const [ax, al] = aux(i);
    line('BQ', 'Journal de banque', n, i.paid_at, ACC.bank, 'Banque', '', '', i.number, `Règlement ${i.number}`, i.total_ttc, 0);
    line('BQ', 'Journal de banque', n, i.paid_at, ACC.client, 'Clients', ax, al, i.number, `Règlement ${i.number}`, 0, i.total_ttc);
  }
  return { text: out.join('\r\n'), name: `${siren}FEC${to.replaceAll('-', '')}.txt` };
}
