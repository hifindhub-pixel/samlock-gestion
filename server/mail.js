import nodemailer from 'nodemailer';
import { getSettings } from './db.js';
import { brandedMail } from './mail-template.js';

/** Transport : SMTP_URL (variable d'environnement) en priorité, sinon réglages saisis dans Paramètres → E-mail. */
function config() {
  const S = getSettings();
  if (process.env.SMTP_URL) return { transport: process.env.SMTP_URL, from: process.env.MAIL_FROM || `"${S.company_name}" <${S.company_email}>`, replyTo: S.company_email };
  if (!S.smtp_host || !S.smtp_user || !S.smtp_pass) return null;
  const port = Number(S.smtp_port) || 587;
  return {
    transport: { host: S.smtp_host, port, secure: port === 465, auth: { user: S.smtp_user, pass: S.smtp_pass }, connectionTimeout: 15000, greetingTimeout: 15000 },
    from: `"${S.company_name}" <${S.smtp_user}>`, replyTo: S.company_email,
  };
}
export const mailConfigured = () => !!config();

export async function sendMail({ to, subject, body, code, attachments = [], plain = false }) {
  const c = config();
  if (!c) {
    console.log(`\n[MAIL SIMULÉ] à ${to}\n  objet : ${subject}${attachments.length ? `\n  pièces jointes : ${attachments.map((a) => `${a.filename} (${a.content?.length || 0} o)`).join(', ')}` : ''}\n  ${body.split('\n').join('\n  ')}\n`);
    return { simulated: true };
  }
  const m = plain ? { text: body, attachments: [] } : brandedMail({ body, code });
  await nodemailer.createTransport(c.transport).sendMail({ from: c.from, replyTo: c.replyTo, to, subject, text: m.text || body, html: m.html, attachments: [...(m.attachments || []), ...attachments] });
  return { simulated: false };
}
