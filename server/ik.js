// Indemnités kilométriques (barème fiscal) calculées sur les factures : trajet siège → lieu d'intervention.
//  - distance routière : adresse → coordonnées (API Adresse de l'État) puis itinéraire (OSRM) ; à défaut, vol d'oiseau × coefficient ;
//  - le barème est annuel et progressif : chaque facture reçoit la part d'IK qu'elle ajoute au cumul de l'année (donc exact au centime en fin d'année) ;
//  - tout est recalculé à la volée : une nouvelle facture émise modifie aussitôt le cumul, un avoir qui annule une facture la retire.
import ExcelJS from 'exceljs';
import { db, getSettings, round2 } from './db.js';

const GEO = () => process.env.IK_GEOCODER_URL || 'https://api-adresse.data.gouv.fr/search/';
const ROUTER = () => process.env.IK_ROUTER_URL || 'https://router.project-osrm.org/route/v1/driving';

/* ---------------------------------------------------------------- Barème (arrêté du 27 mars 2023, inchangé pour les revenus 2023, 2024 et 2025) */
// [coef jusqu'au 1er seuil, coef du palier 2, constante du palier 2, coef au-delà du 2e seuil]
const CAR = { 3: [0.529, 0.316, 1065, 0.370], 4: [0.606, 0.340, 1330, 0.407], 5: [0.636, 0.357, 1395, 0.427], 6: [0.665, 0.374, 1457, 0.447], 7: [0.697, 0.394, 1515, 0.470] };
const MOTO = { 2: [0.395, 0.099, 891, 0.248], 5: [0.468, 0.082, 1158, 0.275], 6: [0.606, 0.079, 1583, 0.343] };
const CYCLO = [0.315, 0.079, 711, 0.198];
export const BAREME_LABEL = 'Barème kilométrique fiscal (arrêté du 27 mars 2023, reconduit)';

export function bareme({ vehicle = 'voiture', cv = 5, electric = false }, d) {
  d = Math.max(0, Number(d) || 0);
  let c; let t1; let t2;
  if (vehicle === 'moto') { c = cv <= 2 ? MOTO[2] : cv <= 5 ? MOTO[5] : MOTO[6]; t1 = 3000; t2 = 6000; }
  else if (vehicle === 'cyclo') { c = CYCLO; t1 = 3000; t2 = 6000; }
  else { c = CAR[Math.min(7, Math.max(3, Math.round(cv)))]; t1 = 5000; t2 = 20000; }
  const v = d <= t1 ? d * c[0] : d <= t2 ? d * c[1] + c[2] : d * c[3];
  return v * (electric ? 1.2 : 1);
}
export const ikSettings = (S = getSettings()) => ({ vehicle: S.ik_vehicle || 'voiture', cv: Number(S.ik_cv) || 5, electric: S.ik_electric === '1', roundTrip: S.ik_round_trip !== '0', origin: S.ik_origin || S.company_address, factor: Number(S.ik_route_factor) || 1.25, enabled: S.ik_enabled !== '0' });

/* ---------------------------------------------------------------- Distance */
async function fetchJson(url, ms = 7000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'samlock-gestion/1.0', Accept: 'application/json' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}
const normAddr = (a) => String(a || '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function geocode(addr) {
  const key = normAddr(addr); if (!key) return null;
  const hit = db.prepare('SELECT * FROM geocode_cache WHERE addr=?').get(key);
  if (hit) return hit.lat == null ? null : hit;
  const j = await fetchJson(`${GEO()}?q=${encodeURIComponent(addr)}&limit=1`);
  const f = j?.features?.[0];
  if (!f?.geometry?.coordinates) return null;           // introuvable : on ne le mémorise pas (l'adresse peut être corrigée)
  const [lon, lat] = f.geometry.coordinates; const label = f.properties?.label || addr;
  db.prepare('INSERT OR REPLACE INTO geocode_cache(addr,lat,lon,label) VALUES(?,?,?,?)').run(key, lat, lon, label);
  return { addr: key, lat, lon, label };
}
const rad = (x) => (x * Math.PI) / 180;
export const haversineKm = (a, b) => { const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };

/** Distance simple (aller) en km entre deux adresses : { km, method: 'route' | 'estimation' }. */
export async function distanceKm(from, to, factor = 1.25) {
  const [a, b] = [await geocode(from), await geocode(to)];
  if (!a) throw new Error(`Adresse de départ introuvable : « ${from} »`);
  if (!b) throw new Error(`Adresse d'intervention introuvable : « ${to} »`);
  try {
    const j = await fetchJson(`${ROUTER()}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
    const m = j?.routes?.[0]?.distance; if (!(m >= 0)) throw new Error('itinéraire vide');
    return { km: Math.round(m / 100) / 10, method: 'route' };
  } catch { return { km: Math.round(haversineKm(a, b) * factor * 10) / 10, method: 'estimation' }; }
}

/** Adresse du lieu d'intervention d'une facture (à défaut : adresse du client). */
export function destinationOf(invoiceId) {
  const r = db.prepare('SELECT p.address pa, p.city pc, c.address ca, c.postal cp, c.city cc FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id WHERE i.id=?').get(invoiceId);
  if (!r) return '';
  const pa = [r.pa, r.pc].filter(Boolean).join(', ');
  return pa.trim().length > 3 && r.pa ? pa : [r.ca, r.cp, r.cc].filter(Boolean).join(' ');
}

const inflight = new Map();
/** Calcule (ou relit) le trajet d'une facture. Les saisies manuelles ne sont jamais écrasées sans `force`. */
export function ensureTrip(invoiceId, { force = false } = {}) {
  if (inflight.has(invoiceId)) return inflight.get(invoiceId);
  const p = (async () => {
    const S = ikSettings(); const dest = destinationOf(invoiceId);
    const cur = db.prepare('SELECT * FROM ik_trips WHERE invoice_id=?').get(invoiceId);
    if (cur?.manual && !force) return cur;
    if (cur && !force && cur.km_one_way != null && cur.destination === dest && cur.origin === S.origin) return cur;
    const save = (o) => { db.prepare('INSERT OR REPLACE INTO ik_trips(invoice_id,origin,destination,km_one_way,km_total,method,manual,error,computed_at) VALUES(?,?,?,?,?,?,?,?,datetime(\'now\'))').run(invoiceId, S.origin, dest, o.km ?? null, o.km == null ? null : round2(o.km * (S.roundTrip ? 2 : 1)), o.method || null, 0, o.error || null); return db.prepare('SELECT * FROM ik_trips WHERE invoice_id=?').get(invoiceId); };
    if (!dest.trim()) return save({ error: "Adresse d'intervention manquante : renseignez-la sur l'intervention." });
    try { const d = await distanceKm(S.origin, dest, S.factor); return save({ km: d.km, method: d.method }); }
    catch (e) { return save({ error: e.name === 'AbortError' ? 'Service de calcul injoignable' : e.message }); }
  })().finally(() => inflight.delete(invoiceId));
  inflight.set(invoiceId, p); return p;
}

/* ---------------------------------------------------------------- Cumul annuel */
const counted = (year) => db.prepare(`SELECT i.id, i.number, i.issued_at, i.kind, i.status, i.total_ttc, p.title ptitle, p.id project_id, c.name cname, c.company ccompany
  FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id
  WHERE i.status IN ('envoyee','payee') AND i.kind<>'avoir' AND substr(i.issued_at,1,4)=?
    AND NOT EXISTS (SELECT 1 FROM invoices a WHERE a.credit_of=i.id AND a.kind='avoir' AND -a.total_ttc >= i.total_ttc - 0.01)
  ORDER BY i.issued_at, i.id`).all(String(year));

export function ikYear(year) {
  const S = ikSettings(); const V = { vehicle: S.vehicle, cv: S.cv, electric: S.electric };
  const invs = counted(year); const trips = new Map(db.prepare('SELECT * FROM ik_trips').all().map((t) => [t.invoice_id, t]));
  let cum = 0; let prev = 0; const rows = []; const month = {}; let missing = 0;
  for (const i of invs) {
    const t = trips.get(i.id);
    const km = t?.km_total != null ? t.km_total : null;
    if (km == null) missing++;
    let ik = null;
    if (km != null) { cum = round2(cum + km); const amount = bareme(V, cum); ik = round2(amount - prev); prev = amount; }
    const m = String(i.issued_at).slice(0, 7); const mm = (month[m] ||= { m, km: 0, ik: 0, n: 0 });
    if (km != null) { mm.km = round2(mm.km + km); mm.ik = round2(mm.ik + ik); mm.n++; }
    rows.push({ invoice_id: i.id, number: i.number, issued_at: i.issued_at, client: i.ccompany || i.cname, project_id: i.project_id, project_title: i.ptitle, destination: t?.destination || destinationOf(i.id), km_one_way: t?.km_one_way ?? null, km_total: km, method: t?.method || null, manual: !!t?.manual, error: t?.error || null, ik, cum_km: km != null ? cum : null });
  }
  const total = round2(bareme(V, cum));
  return { year: Number(year), settings: S, rows, missing, totals: { km: round2(cum), ik: total, count: rows.filter((r) => r.km_total != null).length, avg_per_km: cum ? round2(total / cum) : 0 }, by_month: Object.values(month).sort((a, b) => a.m.localeCompare(b.m)) };
}

/** IK d'une facture, en direct (même si elle n'est pas encore émise : on montre ce qu'elle ajouterait au cumul). */
export function ikForInvoice(invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId); if (!inv) return null;
  const S = ikSettings(); const t = db.prepare('SELECT * FROM ik_trips WHERE invoice_id=?').get(invoiceId);
  const base = { enabled: S.enabled, trip: t || null, km_total: t?.km_total ?? null, ik: null, status: 'inconnu' };
  if (!S.enabled || inv.kind === 'avoir') return { ...base, enabled: S.enabled && inv.kind !== 'avoir' };
  const year = inv.issued_at ? String(inv.issued_at).slice(0, 4) : String(new Date().getFullYear());
  const y = ikYear(year); const row = y.rows.find((r) => r.invoice_id === invoiceId);
  if (row) return { ...base, status: 'comptee', ik: row.ik, km_total: row.km_total, cum_km: row.cum_km };
  if (t?.km_total != null) { const V = { vehicle: S.vehicle, cv: S.cv, electric: S.electric }; return { ...base, status: 'previsionnelle', ik: round2(bareme(V, y.totals.km + t.km_total) - bareme(V, y.totals.km)) }; }
  return { ...base, status: t?.error ? 'erreur' : 'calcul' };
}

/** Calcule en tâche de fond les trajets manquants de l'année. */
export function backfillTrips(year) {
  const ids = counted(year).map((i) => i.id).filter((id) => { const t = db.prepare('SELECT km_total FROM ik_trips WHERE invoice_id=?').get(id); return !t || t.km_total == null; });
  (async () => { for (const id of ids) { try { await ensureTrip(id); } catch { /* erreur déjà consignée */ } } })();
  return ids.length;
}

/* ---------------------------------------------------------------- Déplacement facturé selon la distance */
export function travelBracket(km, S = getSettings()) {
  let br = []; try { br = JSON.parse(S.travel_brackets || '[]'); } catch { /* défaut */ }
  br.sort((a, b) => a.max - b.max);
  const hit = br.find((b) => km <= b.max) || null;
  return hit ? { ...hit, item: db.prepare('SELECT * FROM catalog_items WHERE ref=? AND archived=0').get(hit.ref) || null } : { max: null, ref: null, item: null, beyond: true };
}

export function mountIk(app, { log }) {
  app.get('/api/ik', (req, res) => {
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : String(new Date().getFullYear());
    const pending = backfillTrips(year);
    const y = ikYear(year); y.pending = pending;
    y.years = [...new Set([String(new Date().getFullYear()), ...db.prepare("SELECT DISTINCT substr(issued_at,1,4) y FROM invoices WHERE issued_at IS NOT NULL").all().map((r) => r.y)])].sort().reverse();
    y.bareme = BAREME_LABEL;
    res.json(y);
  });
  app.get('/api/invoices/:id/ik', async (req, res) => {
    const id = Number(req.params.id); const S = ikSettings();
    if (S.enabled) { const t = db.prepare('SELECT * FROM ik_trips WHERE invoice_id=?').get(id); if (!t || (t.km_total == null && !t.manual)) ensureTrip(id).catch(() => {}); }
    const out = ikForInvoice(id); out ? res.json(out) : res.status(404).json({ error: 'Introuvable' });
  });
  app.post('/api/invoices/:id/ik/recompute', async (req, res) => {
    const id = Number(req.params.id); if (!db.prepare('SELECT 1 FROM invoices WHERE id=?').get(id)) return res.status(404).json({ error: 'Introuvable' });
    await ensureTrip(id, { force: true }); res.json(ikForInvoice(id));
  });
  app.put('/api/invoices/:id/ik', (req, res) => {
    const id = Number(req.params.id); const km = Number(String(req.body.km_one_way ?? '').replace(',', '.'));
    if (!db.prepare('SELECT 1 FROM invoices WHERE id=?').get(id)) return res.status(404).json({ error: 'Introuvable' });
    if (!(km >= 0) || km > 2000) return res.status(400).json({ error: 'Distance invalide.' });
    const S = ikSettings();
    db.prepare("INSERT OR REPLACE INTO ik_trips(invoice_id,origin,destination,km_one_way,km_total,method,manual,error,computed_at) VALUES(?,?,?,?,?,'manuel',1,NULL,datetime('now'))").run(id, S.origin, destinationOf(id), round2(km), round2(km * (S.roundTrip ? 2 : 1)));
    log?.('note', `Distance de déplacement corrigée à la main : ${km} km`);
    res.json(ikForInvoice(id));
  });
  app.delete('/api/invoices/:id/ik', async (req, res) => { const id = Number(req.params.id); db.prepare('DELETE FROM ik_trips WHERE invoice_id=?').run(id); await ensureTrip(id, { force: true }); res.json(ikForInvoice(id)); });

  /** Distance d'une adresse (pour le devis : déplacement facturé au client selon la tranche). */
  app.get('/api/ik/distance', async (req, res) => {
    const S = ikSettings(); const to = String(req.query.address || '').trim();
    if (!to) return res.status(400).json({ error: 'Adresse manquante.' });
    try { const d = await distanceKm(S.origin, to, S.factor); const b = travelBracket(d.km); res.json({ ...d, origin: S.origin, bracket: b.beyond ? null : { max: b.max, ref: b.ref, item: b.item }, beyond: !!b.beyond }); }
    catch (e) { res.status(502).json({ error: e.name === 'AbortError' ? 'Service de calcul de distance injoignable.' : e.message }); }
  });

  app.get('/api/ik/export.xlsx', async (req, res) => {
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : String(new Date().getFullYear());
    const y = ikYear(year); const S = getSettings();
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(`IK ${year}`);
    const veh = { voiture: 'Voiture', moto: 'Moto (> 50 cm³)', cyclo: 'Cyclomoteur (< 50 cm³)' }[y.settings.vehicle];
    ws.addRow([`${S.company_name} — Registre des indemnités kilométriques ${year}`]).font = { bold: true, size: 14 };
    ws.addRow([`Véhicule : ${veh}, ${y.settings.cv} CV${y.settings.electric ? ', 100 % électrique (+ 20 %)' : ''} — ${y.settings.roundTrip ? 'trajets aller-retour' : 'trajets aller simple'} depuis ${y.settings.origin}`]);
    ws.addRow([`${BAREME_LABEL}. Chaque facture reçoit la part d'IK qu'elle ajoute au cumul annuel.`]); ws.addRow([]);
    const head = ws.addRow(['Date', 'Facture', 'Client', "Lieu d'intervention", 'Km aller', 'Km total', 'Cumul km', 'Calcul', 'IK (€)']);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6D1A' } }; });
    for (const r of y.rows) ws.addRow([String(r.issued_at).slice(0, 10), r.number, r.client, r.destination, r.km_one_way, r.km_total, r.cum_km, r.method === 'manuel' ? 'saisie manuelle' : r.method === 'estimation' ? 'estimation' : r.method ? 'itinéraire routier' : r.error || 'en attente', r.ik]);
    const t = ws.addRow(['TOTAL', '', '', '', '', y.totals.km, '', '', y.totals.ik]); t.font = { bold: true };
    [5, 6, 7].forEach((c) => { ws.getColumn(c).numFmt = '#,##0.0'; }); ws.getColumn(9).numFmt = '#,##0.00 "€"';
    [12, 16, 28, 44, 10, 10, 10, 18, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="registre-ik-samlock-${year}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  });
}
