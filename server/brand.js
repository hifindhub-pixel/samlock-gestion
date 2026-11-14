import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Identité visuelle SAMLOCK (Brand board) : logos, polices, couleurs.
const here = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS = path.join(here, 'assets');
export const BRAND = { orange: '#FF6D1A', ink: '#1f1f1f', cream: '#FFF3EA', sand: '#FFD9BF' };
export const LOGOS = ['symbol-dark', 'symbol-light', 'horizontal-dark', 'horizontal-light', 'stacked-dark', 'stacked-light'];
export const logoFile = (name) => (LOGOS.includes(name) ? path.join(ASSETS, `${name}.png`) : null);

/** Polices du Brand board : Archivo Black (titres) + Nunito (texte). À appeler juste après new PDFDocument. */
export function setupFonts(doc) {
  const f = (n) => path.join(ASSETS, 'fonts', n);
  doc.registerFont('Nunito', f('Nunito.woff')); doc.registerFont('Nunito-Bold', f('Nunito-Bold.woff')); doc.registerFont('Nunito-Italic', f('Nunito-Italic.woff'));
  doc.registerFont('Script', f('Script.woff')); doc.registerFont('Serif', f('Serif.woff')); doc.registerFont('Serif-Bold', f('Serif-Bold.woff'));
}

/** En-tête de document : logo horizontal (orange sur fond blanc). Laisse doc.y sous l'en-tête. */
export function brandHeader(doc, S, x, y) {
  const h = 38;
  try { doc.image(logoFile('horizontal-dark'), x, y - 4, { height: h }); doc.x = x; doc.y = y - 4 + h + 4; }
  catch { doc.fillColor('#111827').font('Serif-Bold').fontSize(18).text(S.company_name, x, y); }
}

/** « SAS · SIREN 937 628 287 · capital … » ou « SIRET … » selon le nombre de chiffres saisis. */
export const idLine = (S) => {
  const n = (S.company_siret || '').replace(/\D/g, '').length;
  return [S.company_legal_form, `${n === 9 ? 'SIREN' : 'SIRET'} ${S.company_siret}`, S.company_capital && `capital ${S.company_capital}`].filter(Boolean).join(' · ');
};
