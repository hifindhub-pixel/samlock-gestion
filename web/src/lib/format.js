const nf = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const nf0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const money = (n) => (n == null || isNaN(n) ? '—' : nf.format(n));
export const money0 = (n) => (n == null || isNaN(n) ? '—' : nf0.format(n));
export const num = (n, d = 2) => (n == null || isNaN(n) ? '' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(n));
export const pct = (n, d = 1) => (n == null || isNaN(n) ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n)} %`);
const parse = (s) => (s ? new Date(s.includes('T') || s.length <= 10 ? s : s.replace(' ', 'T') + 'Z') : null);
export const dateFr = (s) => { const d = parse(s); return d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; };
export const ago = (s) => {
  const d = parse(s); if (!d) return '';
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "à l'instant"; if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24); if (j < 30) return `il y a ${j} j`;
  return dateFr(s);
};
export const daysUntil = (s) => (s ? Math.ceil((new Date(s).getTime() - Date.now()) / 864e5) : null);

export const STAGES = ['prospect', 'visite_technique', 'devis_envoye', 'devis_valide', 'intervention_en_cours', 'intervention_terminee', 'devis_refuse'];
export const STAGE = {
  prospect: { label: 'Demande', dot: 'bg-stone-400', chip: 'bg-stone-100 text-stone-700' },
  visite_technique: { label: 'À diagnostiquer', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700' },
  devis_envoye: { label: 'Devis envoyé', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800' },
  devis_valide: { label: 'Devis accepté', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
  devis_refuse: { label: 'Devis refusé', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700' },
  intervention_en_cours: { label: 'Intervention en cours', dot: 'bg-blue-600', chip: 'bg-blue-50 text-blue-700' },
  intervention_terminee: { label: 'Intervention terminée', dot: 'bg-teal-600', chip: 'bg-teal-50 text-teal-700' },
};
export const KINDS = { prospect: 'Prospects', client: 'Clients', sous_traitant: 'Sous-traitants', fournisseur: 'Fournisseurs', apporteur: 'Apporteurs' };
export const KIND1 = { prospect: 'Prospect', client: 'Client', sous_traitant: 'Sous-traitant', fournisseur: 'Fournisseur', apporteur: 'Apporteur' };
export const QSTATUS = {
  brouillon: { label: 'Brouillon', chip: 'bg-stone-100 text-stone-700' },
  envoye: { label: 'Envoyé', chip: 'bg-amber-50 text-amber-800' },
  vu: { label: 'Vu', chip: 'bg-sky-50 text-sky-700' },
  signe: { label: 'Signé', chip: 'bg-emerald-50 text-emerald-700' },
  refuse: { label: 'Refusé', chip: 'bg-rose-50 text-rose-700' },
  expire: { label: 'Expiré', chip: 'bg-stone-100 text-stone-500' },
};

/* Mêmes formules que le serveur (db.js). Utilisées pour l'affichage temps réel pendant la saisie. */
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function calcLine(l) {
  const q = Number(l.qty) || 0;
  const mat = q * (Number(l.cost_material) || 0);
  const lab = q * (Number(l.labor_hours) || 0) * (Number(l.labor_rate) || 0);
  const sub = q * (Number(l.cost_sub) || 0);
  const cost = mat + lab + sub;
  const total = r2(q * (Number(l.price_ht) || 0));
  return { mat, lab, sub, cost, total, profit: total - cost, margin: total > 0 && cost > 0 ? ((total - cost) / total) * 100 : null };
}
export function calcQuote(lines) {
  const t = { mat: 0, lab: 0, sub: 0, cost: 0, total: 0, profit: 0, vat: {}, tva: 0 };
  const sec = {};
  for (const l of lines) {
    const c = calcLine(l);
    for (const k of ['mat', 'lab', 'sub', 'cost', 'total', 'profit']) t[k] += c[k];
    t.vat[l.vat] = r2((t.vat[l.vat] || 0) + c.total);
    const s = (sec[l.section_id] ||= { mat: 0, lab: 0, sub: 0, cost: 0, total: 0, profit: 0 });
    for (const k of ['mat', 'lab', 'sub', 'cost', 'total', 'profit']) s[k] += c[k];
  }
  t.tva = r2(Object.entries(t.vat).reduce((a, [rate, base]) => a + base * (Number(rate) / 100), 0));
  t.ttc = r2(t.total + t.tva);
  t.costed = t.cost > 0;
  t.margin = t.total > 0 && t.costed ? (t.profit / t.total) * 100 : null;
  for (const s of Object.values(sec)) s.margin = s.total > 0 && s.cost > 0 ? (s.profit / s.total) * 100 : null;
  return { t, sec };
}
