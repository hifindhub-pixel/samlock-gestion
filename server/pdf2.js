import path from 'node:path';
import { brandHeader, idLine, setupFonts } from './brand.js';
import PDFDocument from 'pdfkit';
import { db, getSettings, round2, DATA_DIR } from './db.js';
import { buildFacturX, FX_XMP } from './facturx.js';

const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0).replace(/[  ]/g, ' ');
const num = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n || 0).replace(/[  ]/g, ' ');
const dateFr = (d) => (d ? new Date(d.length <= 10 ? d + 'T12:00:00Z' : d.replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR') : '');

export function start(stream, title, number, dateStr, sub, pdfa) {
  const S = getSettings(); const accent = S.accent || '#FF6D1A';
  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, ...(pdfa ? { subset: 'PDF/A-3b', pdfVersion: '1.7' } : {}), info: { Title: `${title} ${number || ''}`, Author: S.company_name } });
  setupFonts(doc);
  doc.pipe(stream);
  const L = 42, W = doc.page.width - 84;
  doc.rect(0, 0, doc.page.width, 6).fill(accent);
  brandHeader(doc, S, L, 34);
  doc.font('Nunito').fontSize(9).fillColor('#4b5563').text(S.company_address, L, doc.y + 2).text(`${S.company_phone}  ·  ${S.company_email}`).text(`${idLine(S)}  ·  TVA ${S.company_vat_number}`);
  doc.font('Serif-Bold').fontSize(20).fillColor(accent).text(title.toUpperCase(), L, 34, { width: W, align: 'right' });
  doc.font('Nunito').fontSize(10).fillColor('#111827').text(number ? `N° ${number}` : 'Brouillon', L, 60, { width: W, align: 'right' }).fillColor('#4b5563').fontSize(9).text(dateStr || '', { width: W, align: 'right' });
  if (sub) doc.text(sub, { width: W, align: 'right' });
  return { doc, S, accent, L, W };
}
export function footer(doc, S, L, W, label) {
  const r = doc.bufferedPageRange();
  for (let i = 0; i < r.count; i++) { doc.switchToPage(i); doc.page.margins.bottom = 0; doc.font('Nunito').fontSize(7.5).fillColor('#9ca3af').text(`${S.company_name} · ${label} · Page ${i + 1}/${r.count}`, L, doc.page.height - 32, { width: W, align: 'center', lineBreak: false }); }
  doc.end();
}
export function box(doc, x, y, w, h, title, lines) {
  doc.roundedRect(x, y, w, h, 4).fill('#f9fafb');
  doc.fillColor('#6b7280').font('Nunito-Bold').fontSize(7.5).text(title, x + 10, y + 9);
  doc.fillColor('#111827').font('Nunito-Bold').fontSize(10).text(lines[0] || '', x + 10, y + 22, { width: w - 20 });
  doc.font('Nunito').fontSize(9).fillColor('#374151').text(lines.slice(1).filter(Boolean).join('\n'), x + 10, doc.y + 1, { width: w - 20 });
}

/* ------------------------------------------------------------------ Facture */
const METHODS = { cb: 'carte bancaire', carte: 'carte bancaire', especes: 'espèces', espèces: 'espèces', cheque: 'chèque', chèque: 'chèque', virement: 'virement' };
export function renderInvoicePdf(inv, stream) {
  const { doc, S, accent, L, W } = start(stream, inv.kind === 'avoir' ? 'Avoir' : 'Facture', inv.number, `Date : ${dateFr(inv.issued_at || inv.created_at)}`, inv.kind === 'avoir' ? '' : (inv.status === 'payee' ? '' : `Échéance : ${dateFr(inv.due_at)}`), !!inv.number);
  const c = inv.contact; let y = 125;
  box(doc, L, y, W / 2 - 8, 78, 'CLIENT', [c.company || c.name, c.company ? c.name : null, c.address, [c.postal, c.city].filter(Boolean).join(' '), c.siret ? `${String(c.siret).replace(/\D/g, '').length === 9 ? 'SIREN' : 'SIRET'} ${c.siret}` : null]);
  box(doc, L + W / 2 + 8, y, W / 2 - 8, 78, 'LIEU D’INTERVENTION', [inv.project.title, inv.project.address, inv.project.city, inv.intervention_date ? `Intervention du ${dateFr(inv.intervention_date)}` : 'Prestation de services (dépannage / serrurerie)']);
  y += 98;
  doc.font('Nunito-Bold').fontSize(11).fillColor('#111827').text(inv.title, L, y, { width: W }); y = doc.y + 3;
  if (inv.kind === 'avoir') {
    doc.font('Nunito').fontSize(9).fillColor('#4b5563').text(`Avoir sur la facture ${inv.credit_src?.number || ''}${inv.credit_src?.issued_at ? ' du ' + dateFr(inv.credit_src.issued_at) : ''}. Motif : ${inv.reason || ''}`, L, y, { width: W }); y = doc.y + 3;
  }
  if (inv.quotes?.length) {
    const txt = inv.quotes.map((q) => `${q.kind === 'avenant' ? 'avenant' : 'devis'} n° ${q.number}${q.signed_at ? ` accepté le ${dateFr(q.signed_at)}` : ''}`).join(' · ');
    doc.font('Nunito').fontSize(9).fillColor('#4b5563').text(`Facture relative au ${txt}`, L, y, { width: W }); y = doc.y + 3;
  }
  if (inv.claim_ref) { doc.font('Nunito').fontSize(9).fillColor('#4b5563').text(`Référence dossier / sinistre : ${inv.claim_ref}`, L, y, { width: W }); y = doc.y; }
  y += 8;
  const cx = { qty: L + W - 262, unit: L + W - 222, pu: L + W - 196, vat: L + W - 132, total: L + W - 82 };
  const head = () => {
    doc.rect(L, y, W, 20).fill(accent); doc.fillColor('#fff').font('Nunito-Bold').fontSize(8);
    doc.text('Désignation', L + 8, y + 6); doc.text('Qté', cx.qty, y + 6, { width: 36, align: 'right' }); doc.text('P.U. HT', cx.pu, y + 6, { width: 60, align: 'right' });
    doc.text('TVA', cx.vat, y + 6, { width: 44, align: 'right' }); doc.text('Total HT', cx.total, y + 6, { width: 72, align: 'right' });
    y += 24;
  };
  head();
  for (const l of inv.lines) {
    const dw = cx.qty - L - 16;
    doc.font('Nunito').fontSize(9); const h = doc.heightOfString(l.label, { width: dw });
    if (y + h + 10 > doc.page.height - 70) { doc.addPage(); y = 50; head(); }
    const neg = l.base_ht < 0;
    doc.fillColor(neg ? '#6b7280' : '#111827').font(neg ? 'Nunito-Italic' : 'Nunito').fontSize(9).text(l.label, L + 8, y, { width: dw });
    const ny = doc.y;
    const q = Number(l.qty); const showQ = !neg && q && !(q === 1 && (l.unit === 'u' || !l.unit) && l.unit_price == null);
    if (showQ) doc.text(`${num(q)} ${l.unit && l.unit !== 'u' ? l.unit : ''}`.trim(), cx.qty - 14, y, { width: 50, align: 'right' }).text(num(l.unit_price ?? l.base_ht / (q || 1)), cx.pu, y, { width: 60, align: 'right' });
    doc.text(`${num(l.vat)} %`, cx.vat, y, { width: 44, align: 'right' }).font(neg ? 'Nunito-Italic' : 'Nunito-Bold').text(num(l.base_ht), cx.total, y, { width: 72, align: 'right' });
    y = ny + 7; doc.moveTo(L, y - 3).lineTo(L + W, y - 3).lineWidth(0.4).strokeColor('#e5e7eb').stroke();
  }
  if (y > doc.page.height - 190) { doc.addPage(); y = 50; }
  y += 8; const bx = L + W - 220;
  const row = (a, b, bold) => { doc.font(bold ? 'Nunito-Bold' : 'Nunito').fontSize(bold ? 11 : 9.5).fillColor('#111827').text(a, bx, y, { width: 110 }).text(b, bx + 100, y, { width: 108, align: 'right' }); y += bold ? 20 : 15; };
  row('Total HT', eur(inv.total_ht));
  const byRate = {}; for (const l of inv.lines) byRate[l.vat] = (byRate[l.vat] || 0) + l.base_ht;
  const rates = Object.keys(byRate);
  if (rates.length > 1) for (const r of rates.sort()) row(`TVA ${num(r)} %`, eur(round2(byRate[r] * r / 100)));
  else row(rates.length ? `TVA ${num(rates[0])} %` : 'Total TVA', eur(inv.total_tva));
  doc.roundedRect(bx - 6, y, 226, 26, 4).fill(accent); doc.fillColor('#fff').font('Nunito-Bold').fontSize(12).text(inv.kind === 'avoir' ? 'Avoir TTC' : 'Total TTC', bx + 4, y + 7, { width: 120 }).text(eur(inv.total_ttc), bx + 100, y + 7, { width: 108, align: 'right' }); y += 42;
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
  const { doc, S, accent, L, W } = start(stream, 'Bon d’intervention', ref, `Intervention du ${dateFr(pv.date_reception)}`);
  let y = 125;
  box(doc, L, y, W / 2 - 8, 78, 'CLIENT', [contact.company || contact.name, contact.company ? contact.name : null, contact.address, [contact.postal, contact.city].filter(Boolean).join(' ')]);
  box(doc, L + W / 2 + 8, y, W / 2 - 8, 78, 'LIEU D’INTERVENTION', [project.title, project.address, project.city]);
  y += 98;
  doc.font('Nunito-Bold').fontSize(11).fillColor('#111827').text('Prestations réalisées', L, y); y = doc.y + 6;
  for (const q of quotes) { doc.font('Nunito').fontSize(9.5).fillColor('#374151').text(`• ${q.kind === 'avenant' ? 'Avenant' : 'Devis'} ${q.number || ''} — ${q.title || ''}`, L, y); y = doc.y + 3; }
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
  const { doc, S, accent, L, W } = start(stream, 'Ordre de mission', `OM-${String(a.id).padStart(4, '0')}`, `Établi le ${dateFr(a.created_at)}`);
  let y = 125;
  box(doc, L, y, W / 2 - 8, 70, 'SOUS-TRAITANT', [sub.company || sub.name, sub.trade, sub.phone, sub.email]);
  box(doc, L + W / 2 + 8, y, W / 2 - 8, 70, 'LIEU D’INTERVENTION', [project.title, project.address, [project.city].filter(Boolean).join(' ')]);
  y += 86;
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
  const { doc, S, accent, L, W } = start(stream, 'Rapport d’intervention', `RC-${String(r.id).padStart(4, '0')}`, `Visite du ${dateFr(r.date)}`);
  let y = 125;
  box(doc, L, y, W / 2 - 8, 70, 'CLIENT', [contact.company || contact.name, contact.company ? contact.name : null, contact.phone]);
  box(doc, L + W / 2 + 8, y, W / 2 - 8, 70, 'LIEU D’INTERVENTION', [project.title, project.address, project.city]);
  y += 88;
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
