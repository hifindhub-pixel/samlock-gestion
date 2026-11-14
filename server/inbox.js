// Boîte mail en LECTURE SEULE (IMAP) : rattache les e-mails échangés aux fiches contacts.
// Aucun envoi, aucune suppression, aucun marquage « lu » : la boîte est ouverte en lecture seule.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db, getSettings } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder TEXT NOT NULL, uid INTEGER NOT NULL, direction TEXT NOT NULL,
  from_addr TEXT, to_addrs TEXT, subject TEXT, date TEXT, snippet TEXT, body TEXT, has_att INTEGER DEFAULT 0,
  UNIQUE(folder, uid)
);
CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date);
CREATE TABLE IF NOT EXISTS inbox_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const kvGet = (k) => db.prepare('SELECT value FROM inbox_kv WHERE key=?').get(k)?.value;
const kvSet = (k, v) => db.prepare('INSERT INTO inbox_kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

const DAYS_FIRST = 90, MAX_FIRST = 1500, MAX_SIZE = 6 * 1024 * 1024, BODY_MAX = 8000;

export function inboxConfig() {
  const S = getSettings();
  const user = S.imap_user || S.smtp_user; const pass = S.imap_pass || S.smtp_pass;
  let host = S.imap_host;
  if (!host && /smtp\.gmail\.com/i.test(S.smtp_host || '')) host = 'imap.gmail.com';
  if (!host && /@(gmail|googlemail)\.com$/i.test(user || '')) host = 'imap.gmail.com';
  return host && user && pass ? { host, port: 993, user, pass } : null;
}
const client = (c) => new ImapFlow({ host: c.host, port: c.port, secure: true, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 60000 });
const addrs = (a) => (a?.value || []).map((x) => (x.address || '').toLowerCase()).filter(Boolean);
const niceErr = (e) => {
  const m = String(e.responseText || e.message || e);
  if (/AUTHENTICATIONFAILED|Invalid credentials|authentication/i.test(m)) return "Connexion refusée : utilisez un mot de passe d'application Google (et non le mot de passe habituel) et vérifiez que l'accès IMAP est autorisé.";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT/.test(m)) return 'Serveur de messagerie injoignable (' + (e.code || m) + ').';
  return m;
};

let running = false;
export async function syncInbox() {
  const cfg = inboxConfig(); if (!cfg) throw Object.assign(new Error('Boîte mail non configurée.'), { status: 400 });
  if (running) return { added: 0, busy: true }; running = true;
  const c = client(cfg); c.on('error', () => {}); let added = 0;
  try {
    await c.connect();
    const boxes = await c.list();
    const sent = boxes.find((b) => b.specialUse === '\\Sent')?.path;
    const folders = [['INBOX', 'in'], ...(sent ? [[sent, 'out']] : [])];
    const me = cfg.user.toLowerCase();
    for (const [folder, direction] of folders) {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const key = 'last_uid:' + folder; const last = Number(kvGet(key) || 0); let maxUid = last; let uids;
        if (last) uids = (await c.search({ uid: `${last + 1}:*` }, { uid: true })).filter((u) => u > last);
        else { uids = await c.search({ since: new Date(Date.now() - DAYS_FIRST * 864e5) }, { uid: true }); uids = uids.slice(-MAX_FIRST); }
        for (const uid of uids) {
          maxUid = Math.max(maxUid, uid);
          const m = await c.fetchOne(String(uid), { source: true, size: true, uid: true }, { uid: true });
          if (!m?.source || (m.size || 0) > MAX_SIZE) continue;
          const p = await simpleParser(m.source, { skipImageLinks: true });
          const text = (p.text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
          const to = [...addrs(p.to), ...addrs(p.cc)];
          const r = db.prepare('INSERT OR IGNORE INTO emails(folder,uid,direction,from_addr,to_addrs,subject,date,snippet,body,has_att) VALUES(?,?,?,?,?,?,?,?,?,?)')
            .run(folder, uid, direction, addrs(p.from)[0] || '', to.filter((x) => x !== me).join(',') || to.join(','), p.subject || '(sans objet)',
              (p.date || new Date()).toISOString(), text.replace(/\s+/g, ' ').slice(0, 200), text.slice(0, BODY_MAX), (p.attachments || []).length ? 1 : 0);
          added += r.changes;
        }
        kvSet(key, maxUid);
      } finally { lock.release(); }
    }
    kvSet('last_sync', new Date().toISOString()); kvSet('last_error', '');
    return { added };
  } catch (e) { const m = niceErr(e); kvSet('last_error', m); throw Object.assign(new Error(m), { status: 502 }); }
  finally { running = false; try { await c.logout(); } catch { /* ignore */ } }
}

export function mountInbox(app) {
  app.get('/api/inbox/status', (_req, res) => res.json({ configured: !!inboxConfig(), last_sync: kvGet('last_sync') || null, last_error: kvGet('last_error') || null, count: db.prepare('SELECT COUNT(*) n FROM emails').get().n }));
  app.post('/api/inbox/sync', async (_req, res, next) => { try { res.json(await syncInbox()); } catch (e) { next(e); } });
  app.get('/api/contacts/:id/emails', (req, res) => {
    const c = db.prepare('SELECT email FROM contacts WHERE id=?').get(req.params.id); const e = (c?.email || '').trim().toLowerCase();
    if (!e) return res.json([]);
    res.json(db.prepare(`SELECT id,direction,from_addr,to_addrs,subject,date,snippet,body,has_att FROM emails WHERE lower(from_addr)=? OR (',' || to_addrs || ',') LIKE ? ORDER BY date DESC LIMIT 100`).all(e, `%,${e},%`));
  });
  const tick = () => { if (inboxConfig()) syncInbox().catch((e) => console.warn('inbox sync: ' + e.message)); };
  setInterval(tick, 10 * 60e3).unref(); setTimeout(tick, 20e3).unref();
}
