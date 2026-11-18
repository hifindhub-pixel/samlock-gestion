// Reprise des factures déjà émises sous Tiime (n° 1 à 433) et des trajets du fichier IK_SAMLOCK.xlsx.
// Idempotent : une facture déjà reprise (même n° Tiime) est mise à jour, jamais dupliquée.
import crypto from 'node:crypto';
import { db, round2 } from './db.js';
import { TIIME_INVOICES } from './invoices-data.js';

const PRO = /\b(sarl|sas|sasu|eurl|sci|sa|agence|group|groupe|immo|immobilier|syndic|conciergerie|gestion|fonci|hotel|hôtel|restaurant|boulangerie|pharmacie|cabinet|association|mairie|renovation|rénovation|matim|mateba)\b/i;
const isPro = (name) => PRO.test(name) || (name === name.toUpperCase() && /[A-Z]/.test(name));
const pad = (n) => String(n).padStart(4, '0');
export const tiimeNumber = (n, avoir) => `TIIME-${avoir ? 'AV-' : ''}${pad(Math.abs(n))}`;

function splitAddress(a) {
  if (!a) return { street: '', city: '' };
  const m = a.match(/^(.*?),?\s*(\d{5}\s+[^,]+)$/);
  return m ? { street: m[1].trim(), city: m[2].trim() } : { street: a, city: '' };
}

export function importTiimeInvoices() {
  const res = { created: 0, updated: 0, clients: 0, trips: 0, placeholders: 0 };
  const clientId = new Map();
  const getClient = (name, addr) => {
    const key = name.toLowerCase();
    if (clientId.has(key)) return clientId.get(key);
    let c = db.prepare('SELECT id FROM contacts WHERE lower(name)=? OR lower(company)=?').get(key, key);
    if (!c) {
      const a = splitAddress(addr); const cp = a.city.match(/^(\d{5})\s+(.*)$/);
      const id = db.prepare("INSERT INTO contacts(kind,name,address,postal,city,client_type,source) VALUES('client',?,?,?,?,?,'Tiime (reprise)')")
        .run(name, a.street || null, cp ? cp[1] : null, cp ? cp[2] : null, isPro(name) ? 'professionnel' : 'particulier').lastInsertRowid;
      c = { id }; res.clients++;
    }
    clientId.set(key, c.id); return c.id;
  };
  const idByNumber = new Map();
  db.exec('BEGIN');
  try {
    const rows = [...TIIME_INVOICES].sort((a, b) => a[0] - b[0]);
    for (const [n, date, client, status, ht, ttc, title, lines, addr, km, creditN] of rows) {
      const avoir = ht < 0; const number = tiimeNumber(n, avoir);
      const issued = `${date} 12:00:00`;
      const existing = db.prepare('SELECT id FROM invoices WHERE number=?').get(number);
      if (existing) {
        // coquille à 0 € créée avant l'export Tiime : remplacée par la vraie facture
        const ph = db.prepare("SELECT project_id FROM invoices WHERE id=? AND total_ttc=0 AND title LIKE 'Facture à compléter%'").get(existing.id);
        if (ph && lines.length) { db.prepare('DELETE FROM invoices WHERE id=?').run(existing.id); db.prepare('DELETE FROM projects WHERE id=?').run(ph.project_id); res.replaced = (res.replaced || 0) + 1; }
        else { idByNumber.set(`${avoir ? 'A' : 'F'}${n}`, existing.id); res.updated++; continue; }
      }
      const a = splitAddress(addr);
      const cid = getClient(client, addr);
      const pid = db.prepare("INSERT INTO projects(contact_id,title,address,city,stage) VALUES(?,?,?,?,'intervention_terminee')").run(cid, (title || `Intervention ${number}`).slice(0, 120), a.street || null, a.city || null).lastInsertRowid;
      const tva = round2(ttc - ht);
      const credit = avoir && creditN ? idByNumber.get(`F${creditN}`) || null : null;
      const iid = db.prepare(`INSERT INTO invoices(number,public_token,project_id,kind,status,title,total_ht,total_tva,total_ttc,created_at,issued_at,due_at,paid_at,credit_of,reason)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(number, crypto.randomBytes(16).toString('hex'), pid, avoir ? 'avoir' : 'solde', status, title || number, ht, tva, ttc, issued, issued, date, status === 'payee' ? issued : null, credit, avoir ? 'Reprise Tiime' : null).lastInsertRowid;
      idByNumber.set(`${avoir ? 'A' : 'F'}${n}`, iid);
      for (const [label, qty, pu, vat, lht] of lines) db.prepare('INSERT INTO invoice_lines(invoice_id,label,base_ht,vat,qty,unit,unit_price) VALUES(?,?,?,?,?,?,?)').run(iid, label, lht, vat, qty, 'u', pu);
      if (!lines.length) res.placeholders++;
      if (!avoir && km != null) {
        db.prepare("INSERT OR REPLACE INTO ik_trips(invoice_id,origin,destination,km_one_way,km_total,method,manual,error,computed_at) VALUES(?,?,?,?,?,'manuel',1,NULL,datetime('now'))")
          .run(iid, null, addr, km, round2(km * 2)); res.trips++;
      }
      res.created++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return res;
}

export function mountHistory(app) {
  // Reprise automatique des factures Tiime : au premier lancement, puis à chaque nouvelle version des données
  // (idempotent : les factures déjà présentes sont conservées, les fiches « à compléter » sont remplacées).
  const version = `v${TIIME_INVOICES.length}-${TIIME_INVOICES.reduce((a, d) => a + (d[7]?.length || 0), 0)}`;
  const seen = db.prepare("SELECT value FROM settings WHERE key='tiime_invoices_imported'").get();
  if ((!seen || !String(seen.value).includes(version)) && !process.env.SKIP_AFDB) {
    try { const r = importTiimeInvoices(); db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('tiime_invoices_imported',?)").run(`${new Date().toISOString()} ${version}`); console.log('Factures Tiime reprises :', JSON.stringify(r)); }
    catch (e) { console.error('Reprise des factures Tiime impossible :', e.message); }
  }
  // « Clé plate » non suivie + seuils de réapprovisionnement d'après les ventes (une seule fois).
  if (!process.env.SKIP_AFDB) {
    try {
      db.prepare("UPDATE catalog_items SET track_stock=0 WHERE supplier_ref='131097' AND label='Clé plate'").run();
      if (!db.prepare("SELECT 1 FROM settings WHERE key='stock_levels_init'").get()) {
        for (const r of db.prepare("SELECT c.id, -SUM(m.qty) AS sold FROM catalog_items c JOIN stock_moves m ON m.item_id=c.id WHERE c.track_stock=1 AND m.qty<0 AND c.stock_min=0 GROUP BY c.id HAVING sold>=3").all()) {
          const month = r.sold / 12, min = Math.max(1, Math.ceil(month * 1.5)), target = Math.max(min + 1, Math.ceil(month * 3));
          db.prepare('UPDATE catalog_items SET stock_min=?, stock_target=? WHERE id=?').run(min, target, r.id);
        }
        db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('stock_levels_init',?)").run(new Date().toISOString());
      }
    } catch (e) { console.error('Seuils de stock :', e.message); }
  }
  app.post('/api/import-tiime-invoices', (req, res) => { try { res.json(importTiimeInvoices()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
}
