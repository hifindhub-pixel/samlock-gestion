// Habillage des e-mails sortants : en-tête avec logo, corps lisible, signature professionnelle, mentions légales.
import { getSettings } from './db.js';
import { logoFile } from './brand.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:#FF6D1A;font-weight:600">${u.length > 60 ? 'Ouvrir le lien' : u}</a>`);

/** Texte brut de la signature (ajouté à la version texte de chaque e-mail). */
export function signatureText(S = getSettings()) {
  return ['', '--', S.company_name, S.company_phone, S.company_email, S.company_address].filter((x, i) => i < 2 || x).join('\n');
}

/**
 * @param {object} o  { body: texte brut (paragraphes séparés par une ligne vide), code?: code à 6 chiffres à mettre en évidence, preheader? }
 * @returns {{ html: string, text: string, attachments: object[] }}
 */
export function brandedMail({ body, code, preheader }) {
  const S = getSettings();
  const accent = S.accent || '#FF6D1A';
  const paras = String(body || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const para = (p) => `<p style="margin:0 0 14px;line-height:1.6;font-size:15px;color:#1f2937">${linkify(p).replace(/\n/g, '<br>')}</p>`;
  const codeHtml = code ? `<div style="margin:22px 0;text-align:center"><div style="display:inline-block;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;padding:14px 26px;font-size:32px;letter-spacing:8px;font-weight:700;color:${accent};font-family:Consolas,Menlo,monospace">${esc(code)}</div><div style="font-size:12.5px;color:#6b7280;margin-top:8px">Valable 15 minutes — ne le communiquez à personne.</div></div>` : '';
  const logo = logoFile('horizontal-dark');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:0;background:#f4f4f2;font-family:Segoe UI,Helvetica,Arial,sans-serif">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;color:transparent">${esc(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="height:5px;background:${accent};font-size:0">&nbsp;</td></tr>
<tr><td style="padding:26px 32px 8px">${logo ? `<img src="cid:samlock-logo" alt="${esc(S.company_name)}" height="40" style="display:block;height:40px;border:0">` : `<b style="font-size:20px;color:${accent}">${esc(S.company_name)}</b>`}</td></tr>
<tr><td style="padding:14px 32px 6px">${paras.map((p, i) => para(p) + (i === 1 ? codeHtml : '')).join('')}${paras.length < 2 ? codeHtml : ''}</td></tr>
<tr><td style="padding:6px 32px 26px">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-top:2px solid ${accent};margin-top:8px"><tr><td style="padding-top:14px;font-size:13.5px;line-height:1.55;color:#374151">
<b style="font-size:15px;color:${accent}">${esc(S.company_name)}</b><br>
${S.company_phone ? `Tél. ${esc(S.company_phone)}<br>` : ''}${S.company_email ? `<a href="mailto:${esc(S.company_email)}" style="color:#374151">${esc(S.company_email)}</a><br>` : ''}${S.company_address ? esc(S.company_address) : ''}
</td></tr></table></td></tr>
<tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 32px;font-size:11.5px;line-height:1.5;color:#6b7280">
${esc(S.company_name)} — ${esc(S.company_legal_form || '')} au capital de ${esc(S.company_capital || '')} — SIRET ${esc(S.company_siret || '')} — TVA ${esc(S.company_vat_number || '')}<br>
${S.company_insurance ? esc(S.company_insurance) : ''}
</td></tr></table></td></tr></table></body></html>`;
  const text = `${paras.join('\n\n')}${code ? `\n\nVotre code : ${code}` : ''}\n${signatureText(S)}`;
  return { html, text, attachments: logo ? [{ filename: 'logo.png', path: logo, cid: 'samlock-logo' }] : [] };
}
