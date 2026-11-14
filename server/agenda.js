// Agenda SAMLOCK : tâches et rappels (saisie manuelle ou via l'assistant IA), notifications push sur téléphone (Web Push),
// et flux calendrier (.ics) à abonner dans Google Agenda / Apple Calendrier.
import crypto from 'node:crypto';
import * as webpush from 'web-push';
import { db, getSettings } from './db.js';
import { callClaude, agentReady } from './agent.js';

const TZ = 'Europe/Paris';
db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, notes TEXT,
  due_at TEXT, all_day INTEGER NOT NULL DEFAULT 0, remind_at TEXT, reminded_at TEXT,
  done INTEGER NOT NULL DEFAULT 0, done_at TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manuel', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS agenda_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const kvGet = (k) => db.prepare('SELECT value FROM agenda_kv WHERE key=?').get(k)?.value;
const kvSet = (k, v) => db.prepare('INSERT INTO agenda_kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const isDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; }; const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

/** Heure locale de Paris (date + HH:MM) → instant UTC ISO. Gère l'heure d'été. */
export function parisToUtc(date, time = '00:00') {
  const want = Date.parse(`${date}T${time}:00Z`); let t = want;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`); t += want - shown;
  }
  return new Date(t).toISOString();
}
const nowParis = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday }; };

function timing({ date, time, remind }) {
  if (!date) return { due_at: null, all_day: 0, remind_at: null };
  if (!isDate(date)) throw err('Date invalide.');
  const allDay = !isTime(time); const due = parisToUtc(date, allDay ? '00:00' : time);
  let remind_at = null;
  if (remind !== null && remind !== undefined && remind !== '' && Number.isFinite(Number(remind))) {
    remind_at = allDay ? parisToUtc(date, '08:00') : new Date(Date.parse(due) - Number(remind) * 60000).toISOString();
  }
  return { due_at: due, all_day: allDay ? 1 : 0, remind_at };
}
const rowOf = (id) => db.prepare(`SELECT t.*, p.title AS project_title, c.name AS contact_name, c.company AS contact_company FROM tasks t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN contacts c ON c.id=COALESCE(t.contact_id,p.contact_id) WHERE t.id=?`).get(id);

/* ---- Web Push ---- */
function vapid() {
  let pub = kvGet('vapid_public'), priv = kvGet('vapid_private');
  if (!pub || !priv) { const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey; kvSet('vapid_public', pub); kvSet('vapid_private', priv); }
  const S = getSettings(); webpush.setVapidDetails(`mailto:${S.company_email || 'contact@example.com'}`, pub, priv);
  return pub;
}
export async function pushAll(payload) {
  vapid(); let ok = 0;
  for (const r of db.prepare('SELECT * FROM push_subs').all()) {
    try { await webpush.sendNotification(JSON.parse(r.data), JSON.stringify(payload), { TTL: 3600 }); ok++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(r.endpoint); else console.error('Push :', e.statusCode || e.message); }
  }
  return ok;
}
const fmtWhen = (t) => (t.all_day ? 'aujourd’hui' : `à ${new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(t.due_at))}`);
let running = false;
export async function runReminders() {
  if (running) return; running = true;
  try {
    const now = new Date().toISOString();
    for (const t of db.prepare("SELECT * FROM tasks WHERE done=0 AND remind_at IS NOT NULL AND reminded_at IS NULL AND remind_at<=?").all(now)) {
      const stale = Date.parse(now) - Date.parse(t.remind_at) > 12 * 3600e3;
      const n = stale ? 0 : await pushAll({ title: `Rappel : ${t.title}`, body: t.due_at ? `À faire ${fmtWhen(t)}${t.notes ? ' — ' + t.notes.slice(0, 80) : ''}` : t.notes || '', url: '/agenda', tag: `task-${t.id}` });
      if (n > 0 || stale || db.prepare('SELECT COUNT(*) n FROM push_subs').get().n === 0) db.prepare('UPDATE tasks SET reminded_at=? WHERE id=?').run(now, t.id);
    }
  } catch (e) { console.error('Rappels :', e.message); } finally { running = false; }
}

/* ---- ICS ---- */
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
const icsUtc = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDay = (d) => d.replace(/-/g, '');
function buildIcs() {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SAMLOCK//Agenda//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:SAMLOCK — Agenda', `X-WR-TIMEZONE:${TZ}`];
  const stamp = icsUtc(new Date().toISOString());
  for (const t of db.prepare('SELECT * FROM tasks WHERE due_at IS NOT NULL').all()) {
    L.push('BEGIN:VEVENT', `UID:task-${t.id}@samlock`, `DTSTAMP:${stamp}`);
    if (t.all_day) { const d = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.parse(t.due_at) + 3600e3)); L.push(`DTSTART;VALUE=DATE:${icsDay(d)}`); }
    else { L.push(`DTSTART:${icsUtc(t.due_at)}`, `DTEND:${icsUtc(new Date(Date.parse(t.due_at) + 3600e3).toISOString())}`); }
    L.push(`SUMMARY:${icsEsc((t.done ? '✓ ' : '') + t.title)}`); if (t.notes) L.push(`DESCRIPTION:${icsEsc(t.notes)}`); L.push('END:VEVENT');
  }
  try {
    for (const e of db.prepare("SELECT e.*, p.title AS pt FROM events e LEFT JOIN projects p ON p.id=e.project_id WHERE e.date >= date('now','-30 day')").all()) {
      L.push('BEGIN:VEVENT', `UID:event-${e.id}@samlock`, `DTSTAMP:${stamp}`);
      if (e.start_time) { L.push(`DTSTART:${icsUtc(parisToUtc(e.date, e.start_time))}`, `DTEND:${icsUtc(parisToUtc(e.end_date || e.date, e.end_time || e.start_time))}`); }
      else { const end = new Date(Date.parse((e.end_date || e.date) + 'T00:00:00Z') + 86400e3).toISOString().slice(0, 10); L.push(`DTSTART;VALUE=DATE:${icsDay(e.date)}`, `DTEND;VALUE=DATE:${icsDay(end)}`); }
      L.push(`SUMMARY:${icsEsc(e.title + (e.pt ? ' — ' + e.pt : ''))}`); if (e.note) L.push(`DESCRIPTION:${icsEsc(e.note)}`); L.push('END:VEVENT');
    }
  } catch { /* planning absent */ }
  L.push('END:VCALENDAR'); return L.join('\r\n') + '\r\n';
}

/* ---- Assistant IA : tâches dictées ---- */
const TASK_TOOL = {
  name: 'creer_taches', description: "Crée les tâches / rappels demandés par l'artisan.",
  input_schema: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: {
    title: { type: 'string', description: 'Intitulé court et actionnable (ex. « Relancer M. Durand pour le devis »).' },
    date: { type: 'string', description: 'Date YYYY-MM-DD (heure de Paris). Vide si aucune date n\'est indiquée.' },
    time: { type: 'string', description: 'Heure HH:MM (24 h) si une heure est indiquée, sinon vide.' },
    remind_minutes_before: { type: 'integer', description: "Minutes avant l'échéance pour le rappel. Si l'utilisateur demande un rappel sans préciser : 30. S'il n'en demande pas : omettre." },
    client_hint: { type: 'string', description: 'Nom du client ou de l’intervention concerné, si cité.' }, notes: { type: 'string' } }, required: ['title'] } } }, required: ['tasks'] },
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function matchHint(hint) {
  const h = norm(hint); if (h.length < 3) return {};
  const c = db.prepare("SELECT id,name,company FROM contacts").all().filter((x) => norm(x.name).includes(h) || norm(x.company).includes(h) || (norm(x.name).length > 3 && h.includes(norm(x.name))));
  if (c.length === 1) return { contact_id: c[0].id };
  const p = db.prepare('SELECT id,title,contact_id FROM projects').all().filter((x) => norm(x.title).includes(h));
  return p.length === 1 ? { project_id: p[0].id, contact_id: p[0].contact_id } : {};
}

export function mountAgenda(app, { log, APP_URL }) {
  app.get('/api/tasks', (req, res) => {
    const st = req.query.status || 'all'; const w = st === 'open' ? 'WHERE t.done=0' : st === 'done' ? 'WHERE t.done=1' : '';
    res.json(db.prepare(`SELECT t.*, p.title AS project_title, c.name AS contact_name, c.company AS contact_company FROM tasks t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN contacts c ON c.id=COALESCE(t.contact_id,p.contact_id) ${w} ORDER BY t.done, COALESCE(t.due_at,'9999'), t.id`).all());
  });
  const save = (b, cur = null) => {
    const title = String(b.title ?? cur?.title ?? '').trim(); if (!title) throw err('Indiquez un intitulé.');
    const keepTiming = cur && b.date === undefined && b.time === undefined && b.remind === undefined;
    const tm = keepTiming ? { due_at: cur.due_at, all_day: cur.all_day, remind_at: cur.remind_at } : timing({ date: b.date, time: b.time, remind: b.remind });
    return { title, notes: (b.notes ?? cur?.notes ?? '') || null, ...tm, project_id: b.project_id === undefined ? cur?.project_id ?? null : b.project_id || null, contact_id: b.contact_id === undefined ? cur?.contact_id ?? null : b.contact_id || null };
  };
  app.post('/api/tasks', (req, res) => {
    try {
      const t = save(req.body);
      const id = db.prepare('INSERT INTO tasks(title,notes,due_at,all_day,remind_at,project_id,contact_id,source) VALUES(?,?,?,?,?,?,?,?)').run(t.title, t.notes, t.due_at, t.all_day, t.remind_at, t.project_id, t.contact_id, req.body.source === 'ia' ? 'ia' : 'manuel').lastInsertRowid;
      res.json(rowOf(id));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.put('/api/tasks/:id', (req, res) => {
    try {
      const cur = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id); if (!cur) return res.sendStatus(404);
      const t = save(req.body, cur);
      db.prepare('UPDATE tasks SET title=?,notes=?,due_at=?,all_day=?,remind_at=?,project_id=?,contact_id=?,reminded_at=CASE WHEN remind_at IS NOT ? THEN NULL ELSE reminded_at END WHERE id=?').run(t.title, t.notes, t.due_at, t.all_day, t.remind_at, t.project_id, t.contact_id, t.remind_at, cur.id);
      res.json(rowOf(cur.id));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/tasks/:id/done', (req, res) => {
    const done = req.body.done === false ? 0 : 1;
    db.prepare("UPDATE tasks SET done=?, done_at=CASE WHEN ?=1 THEN datetime('now') ELSE NULL END WHERE id=?").run(done, done, req.params.id); res.json(rowOf(req.params.id));
  });
  app.delete('/api/tasks/:id', (req, res) => { db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id); res.json({ ok: true }); });
  // Rappels à afficher dans l'application (secours si les notifications téléphone ne sont pas activées)
  app.get('/api/tasks/alerts', (_req, res) => {
    const now = new Date().toISOString(); const since = new Date(Date.now() - 6 * 3600e3).toISOString();
    res.json(db.prepare('SELECT id,title,due_at,all_day FROM tasks WHERE done=0 AND remind_at IS NOT NULL AND remind_at<=? AND remind_at>?').all(now, since));
  });

  app.post('/api/agent/tasks', async (req, res) => {
    try {
      if (!agentReady()) throw err("L'assistant IA n'est pas activé : renseignez votre clé API dans Réglages.");
      const text = String(req.body.text || '').trim(); if (text.length < 4) throw err('Décrivez la tâche ou le rappel.');
      const n = nowParis();
      const out = await callClaude({ tool: TASK_TOOL, max_tokens: 1500, content: text,
        system: `Tu es l'assistant agenda de SAMLOCK (entreprise du bâtiment). Nous sommes ${n.weekday} ${n.date}, il est ${n.time} (heure de Paris). Transforme la demande en tâches/rappels. Résous les dates relatives (« demain », « lundi prochain », « dans 3 jours ») en dates exactes. N'invente aucune date ni heure : si elles ne sont pas indiquées, laisse-les vides. Une demande peut contenir plusieurs tâches.` });
      const created = [];
      for (const x of (Array.isArray(out.tasks) ? out.tasks : []).slice(0, 10)) {
        if (!x || typeof x !== 'object' || typeof x.title !== 'string' || !x.title.trim()) continue;
        const rm = Number(x.remind_minutes_before); x.remind_minutes_before = Number.isFinite(rm) && x.remind_minutes_before != null ? Math.min(Math.max(rm, 0), 10080) : null;
        const date = isDate(x.date) ? x.date : ''; const link = matchHint(x.client_hint);
        const t = save({ title: x.title, notes: x.notes, date, time: date && isTime(x.time) ? x.time : '', remind: date && x.remind_minutes_before != null ? x.remind_minutes_before : null, ...link });
        const id = db.prepare('INSERT INTO tasks(title,notes,due_at,all_day,remind_at,project_id,contact_id,source) VALUES(?,?,?,?,?,?,?,?)').run(t.title, t.notes, t.due_at, t.all_day, t.remind_at, t.project_id, t.contact_id, 'ia').lastInsertRowid;
        created.push(rowOf(id));
      }
      if (!created.length) throw err("Aucune tâche n'a été comprise : reformulez.");
      res.json({ created });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  /* ---- Notifications téléphone ---- */
  app.get('/api/push/key', (_req, res) => res.json({ key: vapid(), subscribed: db.prepare('SELECT COUNT(*) n FROM push_subs').get().n }));
  app.post('/api/push/subscribe', (req, res) => {
    const s = req.body.subscription; if (!s?.endpoint || !s?.keys) return res.status(400).json({ error: 'Abonnement invalide.' });
    db.prepare('INSERT INTO push_subs(endpoint,data) VALUES(?,?) ON CONFLICT(endpoint) DO UPDATE SET data=excluded.data').run(s.endpoint, JSON.stringify(s)); res.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', (req, res) => { db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(req.body.endpoint || ''); res.json({ ok: true }); });
  app.post('/api/push/test', async (_req, res) => { const n = await pushAll({ title: 'SAMLOCK', body: 'Les notifications fonctionnent ✅', url: '/agenda', tag: 'test' }); res.json({ sent: n }); });

  /* ---- Flux calendrier ---- */
  const icsToken = () => { let t = kvGet('ics_token'); if (!t) { t = crypto.randomBytes(18).toString('hex'); kvSet('ics_token', t); } return t; };
  app.get('/api/agenda/ics-url', (_req, res) => res.json({ url: `${APP_URL}/api/public/agenda/${icsToken()}.ics` }));
  app.post('/api/agenda/ics-reset', (_req, res) => { kvSet('ics_token', crypto.randomBytes(18).toString('hex')); res.json({ url: `${APP_URL}/api/public/agenda/${icsToken()}.ics` }); });
  app.get('/api/public/agenda/:token.ics', (req, res) => {
    if (req.params.token !== kvGet('ics_token')) return res.sendStatus(404);
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' }).send(buildIcs());
  });

  setInterval(runReminders, 60 * 1000).unref?.(); setTimeout(runReminders, 8000);
}
