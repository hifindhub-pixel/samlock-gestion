// Accès unique protégé : page de connexion, cookie de session signé, expiration après inactivité, blocage après échecs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';

const USER = process.env.APP_USER || 'samlock';
const PASS = process.env.APP_PASSWORD || '';
const IDLE_MS = (Number(process.env.SESSION_HOURS) || 8) * 3600e3;
const COOKIE = 'samlock_session';
export const authRequired = () => !!PASS;

// Clé de signature persistante (les sessions survivent à un redémarrage).
const keyFile = path.join(DATA_DIR, 'session.key');
let KEY;
try { KEY = fs.readFileSync(keyFile); } catch { KEY = crypto.randomBytes(32); fs.writeFileSync(keyFile, KEY, { mode: 0o600 }); }

const sign = (s) => crypto.createHmac('sha256', KEY).update(s).digest('base64url');
const eq = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(); const y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
const makeToken = () => { const exp = String(Date.now() + IDLE_MS); return `${exp}.${sign(exp)}`; };
const readCookie = (req) => (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1];
const valid = (tok) => { if (!tok) return false; const [exp, sig] = tok.split('.'); return !!sig && eq(sig, sign(exp)) && Number(exp) > Date.now(); };
const setCookie = (req, res, tok, maxAge) => {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append('Set-Cookie', `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
};

// Limitation légère : 10 échecs → pause d'1 minute (par adresse IP). Se réinitialise aussi au redémarrage.
const fails = new Map();
const ipOf = (req) => req.ip;
const lockedFor = (ip) => { const f = fails.get(ip); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0; };

const OPEN = [/^\/api\/public\//, /^\/api\/auth\//];

export function mountAuth(app) {
  app.get('/api/auth/me', (req, res) => res.json({ auth_required: authRequired(), logged_in: !authRequired() || valid(readCookie(req)) }));
  app.post('/api/auth/login', async (req, res) => {
    if (!authRequired()) return res.json({ ok: true });
    const ip = ipOf(req); const wait = lockedFor(ip);
    if (wait) return res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${wait} min.` });
    await new Promise((r) => setTimeout(r, 400)); // ralentit les essais automatisés
    const ok = eq(req.body.user || '', USER) & eq(req.body.password || '', PASS);
    if (!ok) {
      const f = fails.get(ip) || { n: 0, until: 0 }; f.n++; if (f.n >= 10) { f.until = Date.now() + 60e3; f.n = 0; } fails.set(ip, f);
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    }
    fails.delete(ip); setCookie(req, res, makeToken(), IDLE_MS / 1000); res.json({ ok: true });
  });
  app.post('/api/auth/logout', (req, res) => { setCookie(req, res, '', 0); res.json({ ok: true }); });

  // Toutes les autres routes /api exigent une session ; la session est prolongée à chaque usage (expiration = inactivité).
  app.use('/api', (req, res, next) => {
    if (!authRequired() || OPEN.some((r) => r.test(req.originalUrl))) return next();
    const tok = readCookie(req);
    if (!valid(tok)) return res.status(401).json({ error: 'Session expirée, reconnectez-vous.', auth: true });
    if (Number(tok.split('.')[0]) - Date.now() < IDLE_MS - 60e3) setCookie(req, res, makeToken(), IDLE_MS / 1000);
    next();
  });
}
