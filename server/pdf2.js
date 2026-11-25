import path from 'node:path';
import { brandHeader, idLine, setupFonts } from './brand.js';
import PDFDocument from 'pdfkit';
import { db, getSettings, round2, DATA_DIR } from './db.js';
import { buildFacturX, FX_XMP } from './facturx.js';

const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0).replace(/[  ]/g, ' ');
const num = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n || 0).replace(/[  ]/g, ' ');
const dateFr = (d) => (d ? new Date(d.length <= 10 ? d + 'T12:00:00Z' : d.replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR') : '');

const price2 = (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0).replace(/[\u202f\u00a0]/g, ' ');
export { price2, eur, num, dateFr };

/**
 * En-tête commun : logo + coordonnées de l'émetteur à gauche, type de document, numéro et dates à droite.
 * `meta` = [[libellé, valeur], …] (dates, validité, échéance…). Le contenu commence à y = 134.
 */
export function start(stream, title, number, meta, pdfa) {
  const S = getSettings(); const accent = S.accent || '#FF6D1A';
  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, ...(pdfa ? { subset: 'PDF/A-3b', pdfVersion: '1.7' } : {}), info: { Title: `${title} ${number || ''}`, Author: S.company_name } });
  setupFonts(doc);
  doc.pipe(stream);
  const L = 42, W = doc.page.width - 84;
  doc.rect(0, 0, doc.page.width, 6).fill(accent);
  brandHeader(doc, S, L, 30);
  // émetteur (colonne gauche, sous le logo)
  doc.font('Nunito-Bold').fontSize(9).fillColor('#111827').text(S.company_name, L, 76, { width: W / 2 });
  doc.font('Nunito').fontSize(8.5).fillColor('#4b5563').text(S.company_address, L, 88, { width: W / 2 }).text(`${S.company_phone}  ·  ${S.company_email}`, L, 99, { width: W / 2 });
  // titre + numéro (colonne droite)
  doc.font('Serif-Bold').fontSize(22).fillColor(accent).text(title.toUpperCase(), L, 28, { width: W, align: 'right', lineBreak: false });
  doc.font('Nunito-Bold').fontSize(11).fillColor('#111827').text(number ? `N° ${number}` : 'Brouillon', L, 55, { width: W, align: 'right', lineBreak: false });
  let my = 74;
  for (const [k, v] of (meta || []).filter(([, v]) => v)) {
    doc.font('Nunito').fontSize(8.5).fillColor('#6b7280').text(k, L + W - 200, my, { width: 100, lineBreak: false });
    doc.font('Nunito-Bold').fontSize(8.5).fillColor('#111827').text(String(v), L + W - 110, my, { width: 110, align: 'right', lineBreak: false });
    my += 12;
  }
  doc.moveTo(L, 120).lineTo(L + W, 120).lineWidth(0.6).strokeColor('#e5e7eb').stroke();
  doc.x = L; doc.y = 134;
  return { doc, S, accent, L, W };
}

/** Pied de page : filet, mentions légales de l'émetteur, référence du document et pagination. */
export function footer(doc, S, L, W, label) {
  const r = doc.bufferedPageRange();
  const legal = `${S.company_name} · ${idLine(S)} · TVA ${S.company_vat_number} · ${S.company_address}`;
  for (let i = 0; i < r.count; i++) {
    doc.switchToPage(i); doc.page.margins.bottom = 0;
    const y = doc.page.height - 46;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.4).strokeColor('#e5e7eb').stroke();
    doc.font('Nunito').fontSize(7).fillColor('#9ca3af').text(legal, L, y + 7, { width: W, align: 'center', lineBreak: false });
    doc.text(`${label}  ·  Page ${i + 1}/${r.count}`, L, y + 18, { width: W, align: 'center', lineBreak: false });
  }
  doc.end();
}

const cardH = (doc, w, lines) => {
  doc.font('Nunito-Bold').fontSize(10); const h0 = doc.heightOfString(lines[0] || ' ', { width: w - 26 });
  doc.font('Nunito').fontSize(9); const rest = lines.slice(1).filter(Boolean).join('\n');
  return 30 + h0 + (rest ? doc.heightOfString(rest, { width: w - 26 }) + 2 : 0) + 8;
};
/** Une carte d'information (client, lieu…) avec liseré de couleur. Hauteur imposée ou calculée. */
export function box(doc, x, y, w, h, title, lines, accent = '#FF6D1A') {
  const H = h || cardH(doc, w, lines);
  doc.roundedRect(x, y, w, H, 3).fill('#f8f9fb');
  doc.rect(x, y, 3, H).fill(accent);
  doc.fillColor('#6b7280').font('Nunito-Bold').fontSize(7.5).text(title, x + 14, y + 10, { characterSpacing: 0.6, lineBreak: false });
  doc.fillColor('#111827').font('Nunito-Bold').fontSize(10).text(lines[0] || '', x + 14, y + 23, { width: w - 26 });
  doc.font('Nunito').fontSize(9).fillColor('#374151').text(lines.slice(1).filter(Boolean).join('\n'), x + 14, doc.y + 2, { width: w - 26 });
  return H;
}
/** Deux cartes côte à côte, de même hauteur. Retourne la hauteur occupée + marge. */
export function boxPair(doc, L, W, y, t1, l1, t2, l2, accent) {
  const w = W / 2 - 8;
  const h = Math.max(70, cardH(doc, w, l1), cardH(doc, w, l2));
  box(doc, L, y, w, h, t1, l1, accent); box(doc, L + W / 2 + 8, y, w, h, t2, l2, accent);
  return h + 18;
}
/** Colonnes du tableau de lignes (identiques pour devis et factures). */
export const tableCols = (L, W) => ({ label: L, qty: L + W - 247, unit: L + W - 207, pu: L + W - 177, vat: L + W - 112, total: L + W - 82 });
/** Bloc des totaux (HT, TVA par taux, TTC) aligné à droite ; retourne le y suivant. */
export function totalsBlock(doc, L, W, y, rows, ttcLabel, ttc, accent) {
  const bx = L + W - 230;
  for (const [a, b] of rows) {
    doc.font('Nunito').fontSize(9.5).fillColor('#374151').text(a, bx, y, { width: 120, lineBreak: false }).fillColor('#111827').text(b, bx + 110, y, { width: 120, align: 'right', lineBreak: false }); y += 15;
  }
  doc.moveTo(bx, y + 1).lineTo(bx + 230, y + 1).lineWidth(0.6).strokeColor('#d1d5db').stroke(); y += 7;
  doc.roundedRect(bx, y, 230, 28, 3).fill(accent);
  doc.fillColor('#fff').font('Nunito-Bold').fontSize(12).text(ttcLabel, bx + 12, y + 8, { width: 100, lineBreak: false }).text(ttc, bx + 110, y + 8, { width: 108, align: 'right', lineBreak: false });
  return y + 28 + 14;
}

/* ------------------------------------------------------------------ Facture */
const METHODS = { cb: 'carte bancaire', carte: 'carte bancaire', especes: 'espèces', espèces: 'espèces', cheque: 'chèque', chèque: 'chèque', virement: 'virement' };
export function renderInvoicePdf(inv, stream) {
  const avoir = inv.kind === 'avoir';
  const meta = [['Date d’émission', dateFr(inv.issued_at || inv.created_at)], ['Date d’intervention', inv.intervention_date ? dateFr(inv.intervention_date) : ''], [avoir ? '' : 'Échéance', avoir ? '' : (inv.status === 'payee' ? 'Acquittée' : (inv.due_at ? dateFr(inv.due_at) : 'À réception'))]];
  const { doc, S, accent, L, W } = start(stream, avoir ? 'Avoir' : 'Facture', inv.number, meta, !!inv.number);
  const c = inv.contact; let y = 134;
  const sid = c.siret ? `${String(c.siret).replace(/\D/g, '').length === 9 ? 'SIREN' : 'SIRET'} ${c.siret}` : null;
  y += boxPair(doc, L, W, y, 'CLIENT', [c.company || c.name, c.company ? c.name : null, c.address, [c.postal, c.city].filter(Boolean).join(' '), sid], 'LIEU D’INTERVENTION', [inv.project.address, inv.project.city].filter(Boolean), accent);
  doc.font('Nunito-Bold').fontSize(11).fillColor('#111827').text(inv.title, L, y, { width: W }); y = doc.y + 3;
  if (avoir) {
    doc.font('Nunito').fontSize(9).fillColor('#4b5563').text(`Avoir sur la facture ${inv.credit_src?.number || ''}${inv.credit_src?.issued_at ? ' du ' + dateFr(inv.credit_src.issued_at) : ''}. Motif : ${inv.reason || ''}`, L, y, { width: W }); y = doc.y + 3;
  }
  if (inv.quotes?.length) {
    const txt = inv.quotes.map((q) => `${q.kind === 'avenant' ? 'avenant' : 'devis'} n° ${q.number}${q.signed_at ? ` accepté le ${dateFr(q.signed_at)}` : ''}`).join(' · ');
    doc.font('Nunito').fontSize(9).fillColor('#4b5563').text(`Facture relative au ${txt}`, L, y, { width: W }); y = doc.y + 3;
  }
  if (inv.claim_ref) { doc.font('Nunito').fontSize(9).fillColor('#4b5563').text(`Référence dossier / sinistre : ${inv.claim_ref}`, L, y, { width: W }); y = doc.y; }
  y += 10;
  const cx = tableCols(L, W);
  const head = () => {
    doc.rect(L, y, W, 22).fill(accent); doc.fillColor('#fff').font('Nunito-Bold').fontSize(8);
    doc.text('Désignation', L + 10, y + 7); doc.text('Qté', cx.qty, y + 7, { width: 35, align: 'right' }); doc.text('Unité', cx.unit + 4, y + 7, { width: 30 });
    doc.text('P.U. HT', cx.pu, y + 7, { width: 60, align: 'right' }); doc.text('TVA', cx.vat, y + 7, { width: 30, align: 'right' }); doc.text('Total HT', cx.total, y + 7, { width: 70, align: 'right' });
    y += 28;
  };
  head();
  let zebra = false;
  for (const l of inv.lines) {
    const dw = cx.qty - L - 22;
    doc.font('Nunito').fontSize(9); const h = doc.heightOfString(l.label, { width: dw });
    if (y + h + 12 > doc.page.height - 70) { doc.addPage(); y = 50; head(); }
    const neg = l.base_ht < 0;
    if (zebra) doc.rect(L, y - 4, W, h + 10).fill('#fafafa');
    zebra = !zebra;
    doc.fillColor(neg ? '#6b7280' : '#111827').font(neg ? 'Nunito-Italic' : 'Nunito').fontSize(9).text(l.label, L + 10, y, { width: dw });
    const ny = doc.y;
    const q = Number(l.qty); const showQ = !neg && q && !(q === 1 && (l.unit === 'u' || !l.unit) && l.unit_price == null);
    if (showQ) doc.text(num(q), cx.qty, y, { width: 35, align: 'right' }).text(l.unit || 'u', cx.unit + 4, y, { width: 30 }).text(price2(l.unit_price ?? l.base_ht / (q || 1)), cx.pu, y, { width: 60, align: 'right' });
    doc.text(`${num(l.vat)} %`, cx.vat, y, { width: 30, align: 'right' }).font(neg ? 'Nunito-Italic' : 'Nunito-Bold').text(price2(l.base_ht), cx.total, y, { width: 70, align: 'right' });
    y = ny + 8; doc.moveTo(L, y - 4).lineTo(L + W, y - 4).lineWidth(0.4).strokeColor('#e5e7eb').stroke();
  }
  if (y > doc.page.height - 200) { doc.addPage(); y = 50; }
  y += 10;
  const byRate = {}; for (const l of inv.lines) byRate[l.vat] = (byRate[l.vat] || 0) + l.base_ht;
  const rates = Object.keys(byRate).sort();
  const trows = [['Total HT', eur(inv.total_ht)]];
  if (rates.length > 1) for (const r of rates) trows.push([`TVA ${num(r)} %`, eur(round2(byRate[r] * r / 100))]);
  else trows.push([rates.length ? `TVA ${num(rates[0])} %` : 'Total TVA', eur(inv.total_tva)]);
  y = totalsBlock(doc, L, W, y, trows, avoir ? 'Avoir TTC' : 'Total TTC', eur(inv.total_ttc), accent);
  if (inv.kind === 'avoir') {
    doc.roundedRect(L, y, W, 40, 4).lineWidth(0.8).strokeColor('#d1d5db').stroke();
    doc.fillColor('#111827').font('Nunito').fontSize(9).text('Cet avoir sera déduit de vos prochaines factures ou remboursé par virement.', L + 10, y + 14, { width: W - 20 });
    y += 54;
  } else if (inv.status === 'payee') {
    const m = METHODS[(inv.payment_method || '').toLowerCase()] || inv.payment_method || '';
    doc.roundedRect(L, y, W, 44, 4).lineWidth(1).strokeColor('#15803d').stroke();
    doc.fillColor('#15803d').font('Nunito-Bold').fontSize(11).text('FACTURE ACQUITTÉE', L + 12, y + 9);
    doc.font('Nunito').fontSize(9).fillColor('#111827').text(`Réglée${inv.paid_at ? ` le ${dateFr(inv.paid_at)}` : ''}${m ? ` par ${m}` : ''}. Merci pour votre confiance.`, L + 12, y + 25, { width: W - 24 });
    y += 58;
  } else {
    const hasIban = !!(S.company_iban || '').trim();
    doc.roundedRect(L, y, W, hasIban ? 62 : 48, 4).lineWidth(0.8).strokeColor('#d1d5db').stroke();
    doc.fillColor('#6b7280').font('Nunito-Bold').fontSize(8).text('RÈGLEMENT', L + 10, y + 9);
    const due = inv.due_at ? `avant le ${dateFr(inv.due_at)}` : 'à réception';
    doc.fillColor('#111827').font('Nunito').fontSize(9).text(`Paiement ${due} — carte bancaire, espèces, chèque ou virement.\n${hasIban ? `IBAN ${S.company_iban}${S.company_bic ? `   ·   BIC ${S.company_bic}` : ''}\n` : ''}Référence à rappeler : ${inv.number || 'brouillon'}`, L + 10, y + 22);
    y += hasIban ? 76 : 62;
  }
  if (inv.kind !== 'avoir') {
    doc.font('Nunito').fontSize(7.5).fillColor('#6b7280').text(`Pénalités de retard : 3 fois le taux d'intérêt légal. Indemnité forfaitaire de recouvrement : 40 €. Pas d'escompte pour paiement anticipé.${inv.lines.some((l) => Number(l.vat) === 10) ? ' TVA à taux réduit (10 %) : travaux d’amélioration, de transformation ou d’entretien dans un local d’habitation achevé depuis plus de 2 ans, sur attestation du client.' : ''}`, L, y, { width: W });
  }
  if (inv.number) { doc.appendXML(FX_XMP()); doc.file(Buffer.from(buildFacturX(inv, S), 'utf-8'), { name: 'factur-x.xml', type: 'text/xml', description: 'Factur-X (EN 16931)', relationship: 'Alternative' }); }
  footer(doc, S, L, W, inv.number || 'Facture brouillon');
}

/* ------------------------------------------------------------------ Bon d’intervention */
export function renderPvPdf(pv, project, contact, quotes, sig, stream) {
  const ref = `BI-${String(pv.id).padStart(4, '0')}`;
  const { doc, S, accent, L, W } = start(stream, 'Bon d’intervention', ref, [['Date d’intervention', dateFr(pv.date_reception)]]);
  let y = 134;
  y += boxPair(doc, L, W, y, 'CLIENT', [contact.company || contact.name, contact.company ? contact.name : null, contact.address, [contact.postal, contact.city].filter(Boolean).join(' ')], 'LIEU D’INTERVENTION', [project.title, project.address, project.city].filter(Boolean), accent);
  doc.font('Nunito-Bold').fontSize(11).fillColor('#111827').text('Prestations réalisées', L, y); y = doc.y + 6;
  for (const q of quotes) { doc.font('Nunito').fontSize(9.5).fillColor('#374151').text(`• ${q.kind === 'avenant' ? 'Avenant' : 'Devis'} ${q.number || ''}${q.title ? ' — ' + q.title : ''}`, L, y); y = doc.y + 3; }
  if (!quotes.length) { doc.font('Nunito').fontSize(9.5).fillColor('#374151').text(`• ${project.title}`, L, y); y = doc.y + 3; }
  y += 10;
  doc.font('Nunito').fontSize(9.5).fillColor('#111827').text(`Le client reconnaît que l’intervention décrite ci-dessus a été réalisée le ${dateFr(pv.date_reception)} et que le matériel posé fonctionne à la fin de l’intervention. La signature vaut accord sur les prestations effectuées et rend la facture exigible.`, L, y, { width: W });
  y = doc.y + 14;
  doc.font('Nunito-Bold').fontSize(11).fillColor('#111827').text('Observations / réserves', L, y); y = doc.y + 6;
  doc.font('Nunito').fontSize(9.5).fillColor(pv.reserves ? '#b45309' : '#15803d').text(pv.reserves || 'Aucune observation : intervention terminée à la satisfaction du client.', L, y, { width: W }); y = doc.y + 24;
  doc.roundedRect(L, y, W / 2 - 8, 90, 4).lineWidth(0.8).strokeColor('#9ca3af').stroke();
  doc.fillColor('#111827').font('Nunito-Bold').fontSize(8.5).text('Le client', L + 10, y + 8);
  if (sig) doc.fillColor('#15803d').font('Nunito-Bold').fontSize(9).text(`Signé électroniquement par ${sig.signer_name}\nle ${dateFr(sig.signed_at)}\nEmpreinte ${sig.doc_hash.slice(0, 20)}…`, L + 10, y + 26, { width: W / 2 - 28 });
  doc.roundedRect(L + W / 2 + 8, y, W / 2 - 8, 90, 4).lineWidth(0.8).strokeColor('#9ca3af').stroke();
  doc.fillColor('#111827').font('Nunito-Bold').fontSize(8.5).text(`Pour ${S.company_name}`, L + W / 2 + 18, y + 8);
  footer(doc, S, L, W, ref);
}

/* ------------------------------------------------------------------ Récapitulatif sous-traitant (jamais de prix client) */
export function renderRecapPdf(a, project, contact, sub, info, photos, stream) {
  const { doc, S, accent, L, W } = start(stream, 'Ordre de mission', `OM-${String(a.id).padStart(4, '0')}`, [['Établi le', dateFr(a.created_at)]]);
  let y = 134;
  y += boxPair(doc, L, W, y, 'SOUS-TRAITANT', [sub.company || sub.name, sub.trade, sub.phone, sub.email], 'LIEU D’INTERVENTION', [project.title, project.address, project.city].filter(Boolean), accent);
  const infoRows = [['Client', `${contact.name}${contact.phone ? ' — ' + contact.phone : ''}`], ['Accès', [info.access_code && `Code : ${info.access_code}`, info.floor && `Étage : ${info.floor}`, info.parking && `Stationnement : ${info.parking}`].filter(Boolean).join('  ·  ') || '—'], ['Intervention', `${a.start_date ? 'du ' + dateFr(a.start_date) : ''} ${a.end_date ? 'au ' + dateFr(a.end_date) : ''}`.trim() || 'À convenir'], ['Contraintes', info.constraints || '—'], ['Contact SAMLOCK', `${S.company_name} — ${S.company_phone}`]];
  for (const [k, v] of infoRows) { doc.font('Nunito-Bold').fontSize(8).fillColor('#6b7280').text(k.toUpperCase(), L, y, { width: 90 }); doc.font('Nunito').fontSize(9.5).fillColor('#111827').text(v, L + 100, y, { width: W - 100 }); y = doc.y + 6; }
  y += 8;
  doc.rect(L, y, W, 20).fill(accent); doc.fillColor('#fff').font('Nunito-Bold').fontSize(8).text('Prestation à réaliser', L + 8, y + 6).text('Qté', L + W - 176, y + 6, { width: 50, align: 'right' }).text('Montant convenu HT', L + W - 116, y + 6, { width: 104, align: 'right' }); y += 24;
  for (const it of JSON.parse(a.items)) {
    doc.fillColor('#111827').font('Nunito').fontSize(9.5).text(it.label, L + 8, y, { width: W - 200 });
    if (it.description) doc.fillColor('#6b7280').fontSize(8).text(it.description, L + 8, doc.y, { width: W - 200 });
    const ny = doc.y; doc.fillColor('#111827').fontSize(9.5).text(`${num(it.qty)} ${it.unit}`, L + W - 176, y, { width: 50, align: 'right' }).font('Nunito-Bold').text(eur(it.amount), L + W - 116, y, { width: 104, align: 'right' });
    y = ny + 7; doc.moveTo(L, y - 3).lineTo(L + W, y - 3).lineWidth(0.4).strokeColor('#e5e7eb').stroke();
  }
  y += 8; doc.font('Nunito-Bold').fontSize(11).fillColor('#111827').text('Total convenu HT', L + W - 260, y, { width: 150, align: 'right' }).text(eur(a.total), L + W - 116, y, { width: 104, align: 'right' }); y += 30;
  doc.font('Nunito').fontSize(8).fillColor('#6b7280').text("L'acceptation en ligne de cet ordre vaut bon de commande. Facture à adresser à " + S.company_name + ' avec votre attestation de vigilance en cours de validité.', L, y, { width: W });
  footer(doc, S, L, W, `OM-${String(a.id).padStart(4, '0')}`);
}

/* ------------------------------------------------------------------ Rapport d’intervention */
export function renderReportPdf(r, project, contact, photos, stream) {
  const { doc, S, accent, L, W } = start(stream, 'Rapport d’intervention', `RC-${String(r.id).padStart(4, '0')}`, [['Date de visite', dateFr(r.date)]]);
  let y = 134;
  y += boxPair(doc, L, W, y, 'CLIENT', [contact.company || contact.name, contact.company ? contact.name : null, contact.phone], 'LIEU D’INTERVENTION', [project.title, project.address, project.city].filter(Boolean), accent);
  const rows = [['Date', dateFr(r.date)], ['Météo', r.weather], ['Équipe présente', r.workforce], ['Rédigé par', r.author]].filter(([, v]) => v);
  for (const [k, v] of rows) { doc.font('Nunito-Bold').fontSize(8).fillColor('#6b7280').text(k.toUpperCase(), L, y, { width: 100 }); doc.font('Nunito').fontSize(9.5).fillColor('#111827').text(v, L + 110, y, { width: W - 110 }); y = doc.y + 5; }
  y += 6;
  const block = (title, text, color = '#111827') => {
    if (!text) return;
    if (y > doc.page.height - 140) { doc.addPage(); y = 50; }
    doc.font('Nunito-Bold').fontSize(11).fillColor(accent).text(title, L, y); y = doc.y + 4;
    doc.font('Nunito').fontSize(9.5).fillColor(color).text(text, L, y, { width: W, lineGap: 2 }); y = doc.y + 12;
  };
  block('Avancement des travaux', r.summary); block('Points d\'attention', r.issues, '#b45309');
  const ok = photos.filter((p) => /^image\/(jpeg|png)$/.test(p.mime || ''));
  if (ok.length) {
    if (y > doc.page.height - 200) { doc.addPage(); y = 50; }
    doc.font('Nunito-Bold').fontSize(11).fillColor(accent).text('Photos', L, y); y = doc.y + 8;
    const cw = (W - 12) / 2, ch = 165; let col = 0;
    for (const p of ok) {
      if (y + ch + 18 > doc.page.height - 60) { doc.addPage(); y = 50; col = 0; }
      const x = L + col * (cw + 12);
      try { doc.image(path.join(DATA_DIR, 'uploads', p.filename), x, y, { fit: [cw, ch], align: 'center', valign: 'center' }); } catch { doc.roundedRect(x, y, cw, ch, 4).fill('#f3f4f6'); }
      if (p.caption || p.room) doc.font('Nunito').fontSize(8).fillColor('#6b7280').text([p.room, p.caption].filter(Boolean).join(' — '), x, y + ch + 3, { width: cw });
      col++; if (col === 2) { col = 0; y += ch + 22; }
    }
  }
  footer(doc, S, L, W, `RC-${String(r.id).padStart(4, '0')}`);
}
