import { start, footer, boxPair, tableCols, totalsBlock, price2 } from './pdf2.js';
import crypto from 'node:crypto';
import { db, computeQuote, computeLine, getSettings } from './db.js';

const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0).replace(/[  ]/g, ' ');
const num = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })
  .format(n || 0).replace(/[\u202f\u00a0]/g, ' ');
const dateFr = (d) => (d ? new Date(d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z')).toLocaleDateString('fr-FR') : '');

/**
 * PDF client : aucune donnée de coût, de marge ou de sous-traitance (B-19).
 */
export function renderQuotePdf(q, stream) {
  const title = q.kind === 'avenant' ? 'Avenant' : 'Devis';
  const { doc, S, accent, L, W } = start(stream, title, q.number, [['Date', dateFr(q.sent_at || q.created_at)], ['Validité', `${q.validity_days} jours`]]);
  const PAD = 0;
  let y = 134;
  const cl = [q.contact.company || q.contact.name, q.contact.company ? q.contact.name : null, q.contact.address, [q.contact.postal, q.contact.city].filter(Boolean).join(' '), q.contact.phone];
  const where = [q.project.title, q.project.address, q.project.city].filter(Boolean);
  if (where.length === 1) where.push('Adresse identique à celle du client');
  y += boxPair(doc, L, W, y, 'CLIENT', cl, 'LIEU D’INTERVENTION', where, accent);

  if (q.title) { doc.font('Nunito-Bold').fontSize(11).fillColor('#111827').text(q.title, L, y, { width: W }); y = doc.y + 4; }
  if (q.intro) { doc.font('Nunito').fontSize(9).fillColor('#374151').text(q.intro, L, y, { width: W }); y = doc.y + 8; }

  // --- Tableau
  const cols = tableCols(L, W);
  const header = () => {
    doc.rect(L, y, W, 22).fill(accent);
    doc.fillColor('#fff').font('Nunito-Bold').fontSize(8);
    doc.text('Désignation', cols.label + 10, y + 7);
    doc.text('Qté', cols.qty, y + 7, { width: 35, align: 'right' });
    doc.text('Unité', cols.unit + 4, y + 7, { width: 30 });
    doc.text('P.U. HT', cols.pu, y + 7, { width: 60, align: 'right' });
    doc.text('TVA', cols.vat, y + 7, { width: 30, align: 'right' });
    doc.text('Total HT', cols.total, y + 7, { width: 70, align: 'right' });
    y += 28;
  };
  const ensure = (h) => { if (y + h > doc.page.height - 62) { doc.addPage(); y = 50; header(); } };
  header();

  const { sections: perSection, totals } = computeQuote(q.sections, q.lines);
  for (const s of q.sections) {
    const lines = q.lines.filter((l) => l.section_id === s.id);
    if (!lines.length) continue;
    ensure(40);
    doc.rect(L, y - 2, W, 18).fill('#f3f4f6');
    doc.fillColor('#111827').font('Nunito-Bold').fontSize(9).text(s.title.toUpperCase(), L + 10, y + 3, { width: W - 130 });
    doc.text(price2(perSection[s.id]?.total), cols.total, y + 3, { width: 70, align: 'right' });
    y += 22;
    for (const l of lines) {
      const c = computeLine(l);
      doc.font('Nunito').fontSize(9);
      const labelH = doc.heightOfString(l.label, { width: cols.qty - cols.label - 22 });
      doc.fontSize(8);
      const descH = l.description ? doc.heightOfString(l.description, { width: cols.qty - cols.label - 22 }) : 0;
      ensure(labelH + descH + 10);
      doc.fillColor('#111827').font('Nunito').fontSize(9).text(l.label, cols.label + 10, y, { width: cols.qty - cols.label - 22 });
      if (l.description) doc.fillColor('#6b7280').fontSize(8).text(l.description, cols.label + 10, doc.y, { width: cols.qty - cols.label - 22 });
      const ny = doc.y;
      doc.fillColor('#111827').fontSize(9);
      if (l.to_price) {
        doc.fillColor('#b45309').font('Nunito-Italic').text('À chiffrer', cols.pu, y, { width: 130, align: 'right' });
      } else {
        doc.text(num(l.qty), cols.qty, y, { width: 35, align: 'right' }).text(l.unit, cols.unit + 4, y, { width: 30 })
          .text(price2(l.price_ht), cols.pu, y, { width: 60, align: 'right' }).text(`${num(l.vat)} %`, cols.vat, y, { width: 30, align: 'right' })
          .font('Nunito-Bold').text(price2(c.total), cols.total, y, { width: 70, align: 'right' });
      }
      y = ny + 6;
      doc.moveTo(L, y - 2).lineTo(L + W, y - 2).lineWidth(0.4).strokeColor('#e5e7eb').stroke();
    }
    y += 4;
  }

  // --- Totaux
  ensure(118);
  y += 8;
  const bx = L + W - 230;
  const trows = [['Total HT', eur(totals.ht)]];
  for (const [rate, base] of Object.entries(totals.vat).sort()) trows.push([`TVA ${num(rate)} %`, eur(base * Number(rate) / 100)]);
  y = totalsBlock(doc, L, W, y, trows, 'Total TTC', eur(totals.ttc), accent);
  if (Number(q.aid_amount) > 0) {
    const aid = Math.min(Number(q.aid_amount), totals.ttc);
    doc.fillColor('#111827').font('Nunito').fontSize(9.5).text(`Aide déduite — ${q.aid_label || 'Aide / prime'}`, bx - 20, y, { width: 150 }).text('- ' + eur(aid), bx + 110, y, { width: 120, align: 'right' }); y += 16;
    doc.font('Nunito-Bold').fontSize(10.5).text('Reste à charge du client', bx - 20, y, { width: 150 }).text(eur(totals.ttc - aid), bx + 110, y, { width: 120, align: 'right' }); y += 22;
  }
  doc.fillColor('#111827').font('Nunito').fontSize(9);
  if (Number(q.deposit_rate) > 0) doc.text(`Acompte à la commande : ${num(q.deposit_rate)} % soit ${eur(totals.ttc * q.deposit_rate / 100)} TTC`, L, y, { width: W - 240 });
  else doc.text('Règlement à l’issue de l’intervention.', L, y, { width: W - 240 });

  // --- Conditions + signature
  y = Math.max(doc.y, y) + 10;
  ensure(104);
  const cy = y;
  const condW = W - 250;
  doc.font('Nunito-Bold').fontSize(8).fillColor('#6b7280').text('CONDITIONS', L, cy);
  let ty = cy + 13;
  const cond = (k, v) => {
    doc.font('Nunito-Bold').fontSize(7.5).fillColor('#374151').text(k, L, ty, { width: 62 });
    doc.font('Nunito').fontSize(7.5).fillColor('#4b5563').text(v, L + 64, ty, { width: condW - 64 });
    ty = Math.max(doc.y, ty + 10) + 2.5;
  };
  if (q.notes) cond('Note', q.notes);
  cond('Validité', `${q.validity_days} jours`);
  cond('Règlement', 'carte bancaire, espèces, chèque ou virement');
  if (S.company_insurance) cond('Assurance', S.company_insurance);
  cond('TVA', '10 % pour un particulier (logement de plus de 2 ans), 20 % pour un professionnel.');
  doc.y = ty;
  doc.roundedRect(L + W - 230, cy, 230, 86, 4).lineWidth(0.8).strokeColor('#9ca3af').stroke();
  doc.font('Nunito-Bold').fontSize(8).fillColor('#111827').text('Bon pour accord', L + W - 220, cy + 8);
  doc.font('Nunito').fontSize(7.5).fillColor('#6b7280').text('Date et signature', L + W - 220, cy + 20, { width: 210 });
  const sigRow = db.prepare("SELECT * FROM signatures WHERE doc_type='quote' AND doc_id=? AND status='signed'").get(q.id);
  if (sigRow?.signer_name) {
    // Signature « manuscrite » : le nom du signataire en écriture cursive, avec la date de signature
    doc.fillColor('#1e3a8a').font('Script').fontSize(21).text(sigRow.signer_name, L + W - 220, cy + 30, { width: 210, height: 30, lineBreak: false, ellipsis: true });
    doc.moveTo(L + W - 218, cy + 58).lineTo(L + W - 30, cy + 58).lineWidth(0.5).strokeColor('#9ca3af').stroke();
  }
  if (q.status === 'signe') doc.fillColor('#15803d').font('Nunito-Bold').fontSize(8).text(`Signé électroniquement le ${dateFr(q.signed_at)}`, L + W - 220, cy + 68, { width: 210 });

  // --- Certificat de signature (devis signé électroniquement)
  const sig = db.prepare("SELECT * FROM signatures WHERE doc_type='quote' AND doc_id=? AND status='signed'").get(q.id);
  if (sig) {
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 6).fill('#15803d');
    doc.fillColor('#111827').font('Nunito-Bold').fontSize(18).text('Certificat de signature électronique', L, 50);
    doc.font('Nunito').fontSize(9.5).fillColor('#4b5563').text(`Document : ${q.kind === 'avenant' ? 'Avenant' : 'Devis'} ${q.number || ''} — ${q.title || q.project.title}`, L, doc.y + 6);
    const rows = [
      ['Signataire', sig.signer_name], ['Adresse e-mail vérifiée', sig.signer_email], ['Date et heure (UTC)', sig.signed_at],
      ['Méthode', 'Lien personnel + code à usage unique envoyé à l\'adresse e-mail du client'],
      ['Adresse IP', sig.ip || '—'], ['Navigateur', (sig.user_agent || '—').slice(0, 90)],
      ['Empreinte du contenu (SHA-256)', sig.doc_hash],
    ];
    let yy = doc.y + 24;
    for (const [k, v] of rows) { doc.font('Nunito-Bold').fontSize(8.5).fillColor('#6b7280').text(k.toUpperCase(), L, yy, { width: 150 }); doc.font('Nunito').fontSize(9.5).fillColor('#111827').text(String(v), L + 160, yy, { width: W - 160 }); yy = Math.max(doc.y, yy + 14) + 8; }
    doc.font('Nunito').fontSize(8).fillColor('#6b7280').text("Cette preuve atteste que le signataire a consulté le document, déclaré l'approuver et confirmé son identité par un code reçu à son adresse e-mail. L'empreinte permet de vérifier que le contenu du devis n'a pas été modifié depuis la signature.", L, yy + 10, { width: W });
  }

  footer(doc, S, L, W, q.number || 'Brouillon');
}

/** Empreinte déterministe du contenu contractuel d'un devis (stockée à la signature). */
export function quoteContentHash(q) {
  const payload = { number: q.number, kind: q.kind, title: q.title, client: q.contact.name, project: q.project.title, lines: q.lines.map((l) => [l.label, l.description || '', l.qty, l.unit, l.price_ht, l.vat, l.to_price]), total_ttc: computeQuote(q.sections, q.lines).totals.ttc };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
