// Signature électronique intégrée (gratuite) : lien personnel + code à usage unique reçu par e-mail + journal de preuve.
// Tout passe par ce module : pour passer à DocuSeal, Documenso ou Yousign, il suffit de remplacer ces trois fonctions.
import crypto from 'node:crypto';
import { db } from './db.js';

export const PROVIDER = 'interne';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function getSignature(docType, docId) {
  return db.prepare('SELECT * FROM signatures WHERE doc_type=? AND doc_id=?').get(docType, docId);
}

/** Génère un code à 6 chiffres valable 15 minutes. Le code n'est jamais stocké en clair. */
export function startSignature(docType, docId, email) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = `${salt}:${sha(salt + code)}`;
  const exp = new Date(Date.now() + 15 * 60000).toISOString();
  const cur = getSignature(docType, docId);
  if (cur?.status === 'signed') throw Object.assign(new Error('Ce document est déjà signé.'), { status: 400 });
  if (cur) db.prepare('UPDATE signatures SET otp_hash=?, otp_expires=?, otp_attempts=0, signer_email=? WHERE id=?').run(hash, exp, email, cur.id);
  else db.prepare('INSERT INTO signatures(doc_type,doc_id,otp_hash,otp_expires,signer_email) VALUES(?,?,?,?,?)').run(docType, docId, hash, exp, email);
  return code;
}

/** Vérifie le code puis scelle la signature (nom, adresse IP, navigateur, date, empreinte du contenu). */
export function verifyAndSign(docType, docId, { name, code, ip, ua, hash }) {
  const s = getSignature(docType, docId);
  if (!s || !s.otp_hash) throw Object.assign(new Error("Demandez d'abord un code."), { status: 400 });
  if (s.status === 'signed') throw Object.assign(new Error('Ce document est déjà signé.'), { status: 400 });
  if (s.otp_attempts >= 5) throw Object.assign(new Error('Trop d\'essais. Demandez un nouveau code.'), { status: 429 });
  if (new Date(s.otp_expires) < new Date()) throw Object.assign(new Error('Code expiré. Demandez un nouveau code.'), { status: 400 });
  const [salt, h] = s.otp_hash.split(':');
  if (sha(salt + String(code || '').trim()) !== h) {
    db.prepare('UPDATE signatures SET otp_attempts=otp_attempts+1 WHERE id=?').run(s.id);
    throw Object.assign(new Error('Code incorrect.'), { status: 400 });
  }
  db.prepare("UPDATE signatures SET status='signed', signer_name=?, signed_at=datetime('now'), ip=?, user_agent=?, doc_hash=?, otp_hash=NULL WHERE id=?").run(name.trim(), ip, ua, hash, s.id);
  return getSignature(docType, docId);
}
