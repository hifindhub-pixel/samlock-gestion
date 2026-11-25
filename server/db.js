import Database from './sqlite-shim.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'samlock.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'prospect',      -- prospect | client | sous_traitant | fournisseur | apporteur
  name TEXT NOT NULL,
  company TEXT,
  email TEXT, phone TEXT,
  address TEXT, postal TEXT, city TEXT,
  source TEXT, referrer TEXT,
  notes TEXT,
  siret TEXT, trade TEXT,
  decennale_until TEXT, urssaf_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  address TEXT, city TEXT,
  stage TEXT NOT NULL DEFAULT 'prospect',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                          -- note | stage | devis | mail | prix
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT, label TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'u',
  category TEXT,
  supplier_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  cost_material REAL NOT NULL DEFAULT 0,
  labor_hours REAL NOT NULL DEFAULT 0,
  labor_rate REAL NOT NULL DEFAULT 0,
  cost_sub REAL NOT NULL DEFAULT 0,
  price_ht REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 10,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  price_ht REAL NOT NULL, cost_total REAL NOT NULL,
  note TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  public_token TEXT UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'devis',          -- devis | avenant
  parent_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'brouillon',    -- brouillon | envoye | vu | signe | refuse | expire
  title TEXT,
  intro TEXT, notes TEXT,
  validity_days INTEGER NOT NULL DEFAULT 30,
  deposit_rate REAL NOT NULL DEFAULT 30,
  photo_auth INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT, signed_at TEXT
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Nouvelle pièce',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  item_id INTEGER REFERENCES catalog_items(id) ON DELETE SET NULL,
  label TEXT NOT NULL DEFAULT '',
  description TEXT,
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'u',
  vat REAL NOT NULL DEFAULT 10,
  cost_material REAL NOT NULL DEFAULT 0,
  labor_hours REAL NOT NULL DEFAULT 0,
  labor_rate REAL NOT NULL DEFAULT 0,
  cost_sub REAL NOT NULL DEFAULT 0,
  price_ht REAL NOT NULL DEFAULT 0,
  to_price INTEGER NOT NULL DEFAULT 0          -- 1 = "à chiffrer" (aucun prix inventé)
);

CREATE TABLE IF NOT EXISTS price_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,                         -- partagé par lot (un e-mail = un lien)
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  line_id INTEGER REFERENCES lines(id) ON DELETE SET NULL,
  supplier_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  label TEXT NOT NULL, unit TEXT, qty REAL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'a_envoyer',    -- a_envoyer | envoyee | repondue | validee | refusee
  answer_ref TEXT, answer_label TEXT, answer_price REAL, answer_delay TEXT, answer_comment TEXT,
  answer_file TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pr_token ON price_requests(token);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                          -- email_devis | email_prix | email_ss_traitant | ...
  to_addr TEXT, subject TEXT, body TEXT,
  ref_type TEXT, ref_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | sent | rejected | failed
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
`);


// --- Phase 2 : signature, interventions, fichiers, sous-traitants, PV, factures
db.exec(`
CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL, doc_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | signed
  signer_name TEXT, signer_email TEXT,
  otp_hash TEXT, otp_expires TEXT, otp_attempts INTEGER NOT NULL DEFAULT 0,
  signed_at TEXT, ip TEXT, user_agent TEXT, doc_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(doc_type, doc_id)
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'photo',           -- photo | document
  tag TEXT,                                     -- avant | pendant | apres
  room TEXT, caption TEXT,
  filename TEXT NOT NULL, orig_name TEXT, mime TEXT, size INTEGER,
  shared INTEGER NOT NULL DEFAULT 0,            -- visible du client (espace client, phase 3)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'a_envoyer',     -- a_envoyer | envoye | accepte | refuse
  items TEXT NOT NULL DEFAULT '[]',             -- [{line_id,label,description,qty,unit,amount}]
  total REAL NOT NULL DEFAULT 0,
  start_date TEXT, end_date TEXT, message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT, accepted_by TEXT
);
CREATE TABLE IF NOT EXISTS pv (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'brouillon',     -- brouillon | envoye | signe
  date_reception TEXT, reserves TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  signed_at TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                           -- acompte | situation | solde
  status TEXT NOT NULL DEFAULT 'brouillon',     -- brouillon | envoyee | payee
  title TEXT,
  total_ht REAL NOT NULL DEFAULT 0, total_tva REAL NOT NULL DEFAULT 0, total_ttc REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  issued_at TEXT, due_at TEXT, paid_at TEXT
);
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  label TEXT NOT NULL, base_ht REAL NOT NULL, vat REAL NOT NULL
);
`);
for (const [col, def] of [['credit_of', 'INTEGER'], ['reason', 'TEXT']]) if (!db.prepare('PRAGMA table_info(invoices)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE invoices ADD COLUMN ${col} ${def}`);
if (!db.prepare('PRAGMA table_info(invoices)').all().some((c) => c.name === 'quote_refs')) db.exec('ALTER TABLE invoices ADD COLUMN quote_refs TEXT');
for (const [col, def] of [['retention_pct', 'REAL NOT NULL DEFAULT 0'], ['aid_label', 'TEXT'], ['aid_amount', 'REAL NOT NULL DEFAULT 0']]) if (!db.prepare('PRAGMA table_info(quotes)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE quotes ADD COLUMN ${col} ${def}`);
if (!db.prepare('PRAGMA table_info(projects)').all().some((c) => c.name === 'info')) db.exec("ALTER TABLE projects ADD COLUMN info TEXT");


// --- SAMLOCK : stocks, indemnités kilométriques, factures détaillées, suivi des sous-traitants
const addCol = (table, col, def) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };
for (const [col, def] of [['track_stock', 'INTEGER NOT NULL DEFAULT 0'], ['stock_qty', 'REAL NOT NULL DEFAULT 0'], ['stock_min', 'REAL NOT NULL DEFAULT 0'], ['stock_target', 'REAL NOT NULL DEFAULT 0'], ['stock_location', 'TEXT'], ['brand', 'TEXT']]) addCol('catalog_items', col, def);
for (const [col, def] of [['qty', 'REAL NOT NULL DEFAULT 1'], ['unit', "TEXT NOT NULL DEFAULT 'u'"], ['unit_price', 'REAL'], ['item_id', 'INTEGER'], ['cost_unit', 'REAL NOT NULL DEFAULT 0']]) addCol('invoice_lines', col, def);
for (const [col, def] of [['payment_method', 'TEXT'], ['claim_ref', 'TEXT'], ['intervention_date', 'TEXT']]) addCol('invoices', col, def);
addCol('catalog_items', 'supplier_ref', 'TEXT');
addCol('quotes', 'imported', 'INTEGER NOT NULL DEFAULT 0');
addCol('contacts', 'client_type', "TEXT NOT NULL DEFAULT 'particulier'");
for (const [col, def] of [['done_at', 'TEXT'], ['paid_at', 'TEXT'], ['paid_amount', 'REAL'], ['paid_method', 'TEXT'], ['sub_invoice_ref', 'TEXT'], ['done_note', 'TEXT']]) addCol('assignments', col, def);
db.exec(`
-- Consommation de l'assistant IA (tokens et coût estimé en euros)
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_eur REAL NOT NULL DEFAULT 0
);
-- « Bylk » : stock sorti par des factures ensuite supprimées (non remis en stock, suivi à part)
CREATE TABLE IF NOT EXISTS stock_bylk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  qty REAL NOT NULL,
  invoice_number TEXT, client TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  qty REAL NOT NULL,                              -- signé : + entrée, − sortie
  kind TEXT NOT NULL,                             -- entree | sortie | inventaire | perte | retour
  unit_cost REAL,
  supplier_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  ref_type TEXT, ref_id INTEGER,                  -- invoice:12 …
  note TEXT,
  stock_after REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Pièces consommées par un article vendu (prestation « fourniture et pose ») : la facture fait sortir ces pièces du stock.
CREATE TABLE IF NOT EXISTS item_parts (
  item_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  qty REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (item_id, part_id)
);
CREATE INDEX IF NOT EXISTS idx_moves_item ON stock_moves(item_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_move_auto ON stock_moves(ref_type, ref_id, item_id) WHERE ref_type IS NOT NULL AND kind IN ('sortie','retour');
CREATE TABLE IF NOT EXISTS ik_trips (
  invoice_id INTEGER PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  origin TEXT, destination TEXT,
  km_one_way REAL, km_total REAL,
  method TEXT,                                    -- route | estimation | manuel
  manual INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  computed_at TEXT
);
CREATE TABLE IF NOT EXISTS geocode_cache (addr TEXT PRIMARY KEY, lat REAL, lon REAL, label TEXT);
`);

export const DEFAULT_SETTINGS = {
  treasury_opening: '',
  treasury_opening_date: '',
  company_iban: 'FR7610057192390002073440314',
  company_bic: 'CMCIFRPPXXX',
  company_legal_form: 'SASU',
  company_capital: '1 000 €',
  payment_days: '0',
  company_name: 'SAMLOCK',
  company_address: '48 rue Claude Balbastre, 34070 Montpellier',
  company_phone: '06 70 96 00 53',
  company_email: 'contact@samlock.fr',
  company_website: 'https://samlock.fr',
  company_siret: '944 495 233',
  company_vat_number: 'FR87944495233',
  company_insurance: '',
  default_labor_rate: '60',
  default_margin: '40',
  margin_alert: '25',
  vat_default: '10',
  deposit_rate: '0',
  quote_validity_days: '30',
  accent: '#FF6D1A',
  smtp_host: 'smtp.hostinger.com',
  smtp_port: '465',
  smtp_user: 'contact@samlock.fr',
  smtp_pass: '',
  imap_host: 'imap.hostinger.com', imap_user: 'contact@samlock.fr', imap_pass: '',
  stripe_secret: '', stripe_webhook_secret: '', auto_reminders: '1',
  anthropic_api_key: '', agent_model: 'claude-sonnet-5-5', chat_model: 'claude-haiku-5-5', ai_budget_month: '10',
  whatsapp_token: '', whatsapp_phone_id: '', whatsapp_verify_token: '', whatsapp_app_secret: '', whatsapp_allowed: '',
  accounting_provider: 'export',
  accounting_webhook_url: '',
  social_hashtags: '#serrurier #montpellier #serrurerie #dépannage #ouverturedeporte',
  // Indemnités kilométriques (barème fiscal) : calculées sur chaque facture émise, trajet siège → lieu d'intervention.
  ik_enabled: '1',
  ik_origin: '48 rue Claude Balbastre, 34070 Montpellier',
  ik_vehicle: 'voiture',          // voiture | moto | cyclo
  ik_cv: '5',                     // puissance fiscale (CV)
  ik_electric: '0',               // véhicule 100 % électrique : +20 %
  ik_round_trip: '1',             // 1 = aller-retour
  ik_route_factor: '1.25',        // coefficient route/vol d'oiseau quand l'itinéraire n'est pas joignable
  // Déplacement facturé selon la distance (références du catalogue)
  travel_brackets: JSON.stringify([{ max: 30, ref: 'DEP-30' }, { max: 50, ref: 'DEP-50' }, { max: 100, ref: 'DEP-100' }]),
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSettings(obj) {
  const st = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const tx = db.transaction((o) => { for (const [k, v] of Object.entries(o)) if (k in DEFAULT_SETTINGS) st.run(k, String(v ?? '')); });
  tx(obj);
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Calculs d'un devis : le seul endroit où l'on additionne (interne + PDF). */
export function computeLine(l) {
  const qty = Number(l.qty) || 0;
  const mat = qty * (Number(l.cost_material) || 0);
  const lab = qty * (Number(l.labor_hours) || 0) * (Number(l.labor_rate) || 0);
  const sub = qty * (Number(l.cost_sub) || 0);
  const cost = mat + lab + sub;
  const total = round2(qty * (Number(l.price_ht) || 0));
  const profit = total - cost;
  return { mat: round2(mat), lab: round2(lab), sub: round2(sub), cost: round2(cost), total, profit: round2(profit), margin_pct: total > 0 && cost > 0 ? (profit / total) * 100 : null };
}

export function computeQuote(sections, lines) {
  const tot = { mat: 0, lab: 0, sub: 0, cost: 0, total: 0, profit: 0, vat: {}, ht: 0, tva: 0, ttc: 0 };
  const perSection = {};
  for (const l of lines) {
    const c = computeLine(l);
    for (const k of ['mat', 'lab', 'sub', 'cost', 'total', 'profit']) tot[k] += c[k];
    tot.vat[l.vat] = round2((tot.vat[l.vat] || 0) + c.total);
    const s = (perSection[l.section_id] ||= { mat: 0, lab: 0, sub: 0, cost: 0, total: 0, profit: 0 });
    for (const k of ['mat', 'lab', 'sub', 'cost', 'total', 'profit']) s[k] += c[k];
  }
  for (const k of ['mat', 'lab', 'sub', 'cost', 'total', 'profit']) tot[k] = round2(tot[k]);
  tot.ht = tot.total;
  tot.tva = round2(Object.entries(tot.vat).reduce((a, [rate, base]) => a + base * (Number(rate) / 100), 0));
  tot.ttc = round2(tot.ht + tot.tva);
  tot.costed = tot.cost > 0; // coûts non renseignés (ex. devis repris de Vertuoza) : pas de marge affichée
  tot.margin_pct = tot.total > 0 && tot.costed ? (tot.profit / tot.total) * 100 : null;
  for (const s of Object.values(perSection)) for (const k of Object.keys(s)) s[k] = round2(s[k]);
  return { totals: tot, sections: perSection };
}
