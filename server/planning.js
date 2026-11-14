// Planning des interventions + pointage des heures (la main-d'œuvre pointée alimente les dépenses réelles de l’intervention).
import { db, getSettings, round2 } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT,
  rate REAL NOT NULL DEFAULT 0,            -- coût horaire chargé (€/h)
  color TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
  title TEXT NOT NULL, date TEXT NOT NULL, end_date TEXT,
  start_time TEXT, end_time TEXT, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS timesheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  date TEXT NOT NULL, hours REAL NOT NULL, rate REAL NOT NULL DEFAULT 0, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_ts_date ON timesheets(date);
`);

const isDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; };
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });
const PALETTE = ['#FF6D1A', '#1f1f1f', '#5b7c99', '#8a6d9f', '#b5535a', '#4f8f6f', '#a08a3c'];
export const hoursBetween = (a, b) => { if (!isTime(a) || !isTime(b)) return 0; const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return Math.max(0, round2((h2 * 60 + m2 - h1 * 60 - m1) / 60)); };

export function mountPlanning(app, { log }) {
  /* ---- Équipe ---- */
  app.get('/api/workers', (_req, res) => res.json(db.prepare('SELECT * FROM workers ORDER BY active DESC, name').all()));
  const cleanWorker = (b) => {
    if (!String(b.name || '').trim()) throw err('Indiquez un nom.');
    const rate = Number(String(b.rate ?? '').replace(',', '.')); if (!Number.isFinite(rate) || rate < 0) throw err('Taux horaire invalide.');
    return { name: String(b.name).trim(), role: String(b.role || '').trim() || null, rate: round2(rate), active: b.active === 0 || b.active === false ? 0 : 1 };
  };
  app.post('/api/workers', (req, res) => {
    try {
      const w = cleanWorker({ rate: getSettings().default_labor_rate, ...req.body }); const n = db.prepare('SELECT COUNT(*) n FROM workers').get().n;
      const id = db.prepare('INSERT INTO workers(name,role,rate,color) VALUES(?,?,?,?)').run(w.name, w.role, w.rate, PALETTE[n % PALETTE.length]).lastInsertRowid;
      res.json(db.prepare('SELECT * FROM workers WHERE id=?').get(id));
    } catch (e) { fail(res, e); }
  });
  app.put('/api/workers/:id', (req, res) => {
    try {
      const cur = db.prepare('SELECT * FROM workers WHERE id=?').get(req.params.id); if (!cur) return res.sendStatus(404);
      const w = cleanWorker({ ...cur, ...req.body });
      db.prepare('UPDATE workers SET name=?,role=?,rate=?,active=? WHERE id=?').run(w.name, w.role, w.rate, w.active, cur.id);
      res.json(db.prepare('SELECT * FROM workers WHERE id=?').get(cur.id));
    } catch (e) { fail(res, e); }
  });
  app.delete('/api/workers/:id', (req, res) => {
    const used = db.prepare('SELECT COUNT(*) n FROM timesheets WHERE worker_id=?').get(req.params.id).n;
    if (used) return res.status(400).json({ error: 'Des heures sont pointées pour cette personne : désactivez-la plutôt que de la supprimer.' });
    db.prepare('DELETE FROM workers WHERE id=?').run(req.params.id); res.json({ ok: true });
  });

  /* ---- Planning ---- */
  const eventRows = (from, to) => db.prepare(`SELECT e.*, p.title AS project_title, p.city AS project_city, w.name AS worker_name, w.color AS worker_color
    FROM events e LEFT JOIN projects p ON p.id=e.project_id LEFT JOIN workers w ON w.id=e.worker_id
    WHERE e.date<=? AND COALESCE(e.end_date,e.date)>=? ORDER BY e.date, COALESCE(e.start_time,'99'), e.id`).all(to, from);
  app.get('/api/planning', (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : new Date().toISOString().slice(0, 10);
    const to = isDate(req.query.to) ? req.query.to : from;
    // interventions des sous-traitants (ordres de mission envoyés ou acceptés) : lecture seule
    const subs = db.prepare(`SELECT a.id, a.project_id, a.start_date AS date, a.end_date, a.status, c.name AS sub_name, c.company AS sub_company, c.trade, p.title AS project_title
      FROM assignments a JOIN contacts c ON c.id=a.contact_id JOIN projects p ON p.id=a.project_id
      WHERE a.start_date IS NOT NULL AND a.start_date<>'' AND a.start_date<=? AND COALESCE(NULLIF(a.end_date,''),a.start_date)>=? AND a.status<>'a_envoyer'`).all(to, from);
    res.json({ events: eventRows(from, to), subs, workers: db.prepare('SELECT * FROM workers WHERE active=1 ORDER BY name').all() });
  });
  const cleanEvent = (b) => {
    if (!String(b.title || '').trim()) throw err('Indiquez un intitulé.');
    if (!isDate(b.date)) throw err('Date invalide.');
    const end = b.end_date && isDate(b.end_date) ? b.end_date : null; if (end && end < b.date) throw err('La date de fin précède le début.');
    if ((b.start_time && !isTime(b.start_time)) || (b.end_time && !isTime(b.end_time))) throw err('Heure invalide (format HH:MM).');
    const st = isTime(b.start_time) ? b.start_time : null, et = isTime(b.end_time) ? b.end_time : null; if (st && et && et <= st) throw err("L'heure de fin doit suivre l'heure de début.");
    return { project_id: Number(b.project_id) || null, worker_id: Number(b.worker_id) || null, title: String(b.title).trim(), date: b.date, end_date: end, start_time: st, end_time: et, note: String(b.note || '').trim() || null };
  };
  const loadEvent = (id) => eventRows('0000-01-01', '9999-12-31').find((e) => e.id === Number(id));
  app.post('/api/planning', (req, res) => {
    try {
      const e = cleanEvent(req.body);
      const id = db.prepare('INSERT INTO events(project_id,worker_id,title,date,end_date,start_time,end_time,note) VALUES(?,?,?,?,?,?,?,?)').run(e.project_id, e.worker_id, e.title, e.date, e.end_date, e.start_time, e.end_time, e.note).lastInsertRowid;
      res.json(loadEvent(id));
    } catch (e) { fail(res, e); }
  });
  app.put('/api/planning/:id', (req, res) => {
    try {
      const cur = loadEvent(req.params.id); if (!cur) return res.sendStatus(404);
      const e = cleanEvent({ ...cur, ...req.body });
      db.prepare('UPDATE events SET project_id=?,worker_id=?,title=?,date=?,end_date=?,start_time=?,end_time=?,note=? WHERE id=?').run(e.project_id, e.worker_id, e.title, e.date, e.end_date, e.start_time, e.end_time, e.note, cur.id);
      res.json(loadEvent(cur.id));
    } catch (e) { fail(res, e); }
  });
  app.delete('/api/planning/:id', (req, res) => { db.prepare('DELETE FROM events WHERE id=?').run(req.params.id); res.json({ ok: true }); });

  /* ---- Pointage ---- */
  const tsRows = (where, args) => db.prepare(`SELECT t.*, w.name AS worker_name, w.color AS worker_color, p.title AS project_title FROM timesheets t JOIN workers w ON w.id=t.worker_id JOIN projects p ON p.id=t.project_id ${where} ORDER BY t.date DESC, t.id DESC`).all(...args);
  app.get('/api/timesheets', (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : '0000-01-01', to = isDate(req.query.to) ? req.query.to : '9999-12-31';
    const rows = req.query.project_id ? tsRows('WHERE t.date BETWEEN ? AND ? AND t.project_id=?', [from, to, Number(req.query.project_id)]) : tsRows('WHERE t.date BETWEEN ? AND ?', [from, to]);
    res.json({ rows, total_hours: round2(rows.reduce((s, r) => s + r.hours, 0)), total_cost: round2(rows.reduce((s, r) => s + r.hours * r.rate, 0)) });
  });
  app.post('/api/timesheets', (req, res) => {
    try {
      const b = req.body; const p = db.prepare('SELECT * FROM projects WHERE id=?').get(b.project_id); if (!p) throw err('Choisissez une intervention.');
      const w = db.prepare('SELECT * FROM workers WHERE id=?').get(b.worker_id); if (!w) throw err('Choisissez une personne.');
      if (!isDate(b.date)) throw err('Date invalide.');
      const hours = Number(String(b.hours ?? '').replace(',', '.')); if (!(hours > 0 && hours <= 24)) throw err('Nombre d\'heures invalide (entre 0 et 24).');
      const day = db.prepare('SELECT COALESCE(SUM(hours),0) h FROM timesheets WHERE worker_id=? AND date=?').get(w.id, b.date).h;
      if (day + hours > 24) throw err(`${w.name} a déjà ${day} h pointées ce jour-là.`);
      const id = db.prepare('INSERT INTO timesheets(project_id,worker_id,date,hours,rate,note) VALUES(?,?,?,?,?,?)').run(p.id, w.id, b.date, round2(hours), w.rate, String(b.note || '').trim() || null).lastInsertRowid;
      log('note', `Pointage : ${w.name}, ${round2(hours)} h le ${b.date.split('-').reverse().join('/')}`, { contact_id: p.contact_id, project_id: p.id });
      res.json(tsRows('WHERE t.id=?', [id])[0]);
    } catch (e) { fail(res, e); }
  });
  app.delete('/api/timesheets/:id', (req, res) => { db.prepare('DELETE FROM timesheets WHERE id=?').run(req.params.id); res.json({ ok: true }); });
}
