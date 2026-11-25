import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, CheckCircle2, Copy, HandCoins, KeyRound, ShieldAlert, Wrench } from 'lucide-react';
import { get, post, del } from '../lib/api.js';
import { Badge, Btn, Card, Empty, Field, Input, Modal, NumInput, PageHeader, Select, useFetch, useToast, cn } from '../lib/ui.jsx';
import { money, dateFr } from '../lib/format.js';

const DOC = { ok: ['À jour', 'bg-emerald-50 text-emerald-700'], bientot: ['Expire bientôt', 'bg-amber-50 text-amber-700'], expire: ['Expiré', 'bg-rose-50 text-rose-700'], absent: ['Manquant', 'bg-rose-50 text-rose-700'] };
const MSTATUS = (m) => (m.paid_at ? ['Réglée', 'bg-emerald-50 text-emerald-700'] : m.done_at ? ['À régler', 'bg-amber-50 text-amber-700'] : m.status === 'accepte' ? ['En cours', 'bg-sky-50 text-sky-700'] : m.status === 'envoye' ? ['Envoyée', 'bg-stone-100 text-stone-600'] : [m.status, 'bg-stone-100 text-stone-600']);

const DocPill = ({ label, d }) => <span className="inline-flex items-center gap-1.5 text-[12px]"><span className="text-stone-500">{label}</span><Badge className={DOC[d.state][1]}>{DOC[d.state][0]}{d.until ? ` · ${dateFr(d.until)}` : ''}</Badge></span>;

function PortalPanel({ s }) {
  const toast = useToast(); const { data, reload } = useFetch(() => get(`/subcontractors/${s.id}/earnings`), [s.id]);
  const [pct, setPct] = useState(''); const [pay, setPay] = useState(null); const [open, setOpen] = useState(false);
  if (!data) return null;
  const T = data.totals; const link = data.portal_token ? `${window.location.origin}/equipe/${data.portal_token}` : null;
  const call = async (fn, msg) => { try { await fn(); await reload(); if (msg) toast(msg); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium text-[13.5px] inline-flex items-center gap-1.5"><KeyRound size={14} />Espace intervenant</div>
        {link ? <><code className="text-[12px] bg-stone-100 rounded px-2 py-1 max-w-[260px] truncate">{link}</code>
          <Btn size="sm" icon={Copy} onClick={() => { navigator.clipboard?.writeText(link); toast('Lien copié'); }}>Copier</Btn>
          <Btn size="sm" onClick={() => call(() => post(`/subcontractors/${s.id}/portal`, { regenerate: true }), 'Nouveau lien généré : l’ancien ne marche plus')}>Régénérer</Btn>
          <Btn size="sm" variant="danger" onClick={() => call(() => post(`/subcontractors/${s.id}/portal`, { disable: true }), 'Accès coupé')}>Couper l’accès</Btn></>
          : <Btn size="sm" variant="primary" onClick={() => call(() => post(`/subcontractors/${s.id}/portal`, {}), 'Accès créé')}>Créer son accès</Btn>}
        <div className="ml-auto flex items-center gap-2 text-[12.5px]">Sa part du gain réel :<Input className="w-16" value={pct === '' ? data.pct : pct} onChange={(e) => setPct(e.target.value)} />%<Btn size="sm" onClick={() => call(() => post(`/subcontractors/${s.id}/portal`, { commission_pct: pct === '' ? data.pct : pct }), 'Commission enregistrée')}>OK</Btn></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 text-[13px]">
        {[['Gain réel total', T.gain], [`Sa part (${data.pct} %)`, T.share], ['Part de SAMLOCK', T.samlock_share], ['À encaisser (clients)', T.share_due], ['Reste à lui reverser', T.to_reverse]].map(([l, v]) => <div key={l}><div className="text-[11.5px] text-stone-400">{l}</div><div className="num font-semibold">{money(v)}</div></div>)}
      </div>
      <div className="mt-2 flex gap-2"><Btn size="sm" onClick={() => setOpen(!open)}>{open ? 'Masquer' : 'Détail par intervention'} ({data.rows.length})</Btn><Btn size="sm" variant="primary" icon={HandCoins} onClick={() => setPay({ amount: T.to_reverse || '', date: new Date().toISOString().slice(0, 10), method: 'virement', note: '' })}>Enregistrer un reversement</Btn></div>
      {open && <div className="mt-2 overflow-x-auto"><table className="w-full text-[12.5px]"><thead><tr className="text-left text-stone-400"><th className="py-1">Intervention</th><th className="text-right">CA HT</th><th className="text-right">Marchandises</th><th className="text-right">Gain</th><th className="text-right">Sa part</th><th className="text-right">dont payé</th></tr></thead><tbody>
        {data.rows.map((r) => <tr key={r.project_id} className="border-t border-line"><td className="py-1.5"><Link className="hover:underline" to={`/dossier/${r.project_id}`}>{r.title}</Link><div className="text-stone-400">{r.client}</div></td><td className="text-right num">{money(r.revenue_ht)}</td><td className="text-right num">{money(r.goods)}{r.goods_source === 'estime' ? ' *' : ''}</td><td className="text-right num">{money(r.gain)}</td><td className="text-right num font-medium">{money(r.share)}</td><td className="text-right num">{money(r.share_paid)}</td></tr>)}
      </tbody></table><div className="text-[11.5px] text-stone-400 mt-1">* marchandises estimées d’après le catalogue ; saisissez les achats réels dans les dépenses de l’intervention pour les remplacer.</div></div>}
      {data.payouts.length > 0 && <div className="mt-2 text-[12.5px] text-stone-600">Reversements : {data.payouts.map((p) => <span key={p.id} className="mr-3">{dateFr(p.date)} · <b className="num">{money(p.amount)}</b> <button className="text-stone-300 hover:text-rose-600" onClick={() => call(() => del(`/subcontractors/payouts/${p.id}`))}>×</button></span>)}</div>}
      <Modal open={!!pay} onClose={() => setPay(null)} title="Reversement au sous-traitant" footer={<><Btn onClick={() => setPay(null)}>Annuler</Btn><Btn variant="primary" onClick={() => call(async () => { await post(`/subcontractors/${s.id}/payouts`, pay); setPay(null); }, 'Reversement enregistré')}>Enregistrer</Btn></>}>
        {pay && <div className="grid grid-cols-2 gap-3"><Field label="Montant"><NumInput value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} /></Field><Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field><Field label="Mode"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="virement">Virement</option><option value="especes">Espèces</option><option value="cheque">Chèque</option></Select></Field><Field label="Note"><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field></div>}
      </Modal>
    </div>
  );
}

export default function SousTraitants() {
  const toast = useToast();
  const { data, reload } = useFetch(() => get('/subcontractors'));
  const [pay, setPay] = useState(null); const [busy, setBusy] = useState(false);
  if (!data) return null;
  const t = data.totals;
  const run = async (fn, msg) => { setBusy(true); try { await fn(); await reload(); if (msg) toast(msg); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };

  return (
    <div className="pb-10">
      <PageHeader title="Sous-traitants" subtitle="Conformité, missions confiées et règlements. Un sous-traitant ne voit jamais votre prix de vente." actions={<Link to="/contacts"><Btn>Gérer les fiches</Btn></Link>} />
      <div className="px-8 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4"><div className="text-[12px] text-stone-500">À régler (HT)</div><div className={cn('text-xl font-semibold num', t.to_pay > 0 && 'text-amber-600')}>{money(t.to_pay)}</div></Card>
          <Card className="p-4"><div className="text-[12px] text-stone-500">Missions en cours</div><div className="text-xl font-semibold num">{t.open}</div></Card>
          <Card className="p-4"><div className="text-[12px] text-stone-500">Non conformes</div><div className={cn('text-xl font-semibold num', t.blocked && 'text-rose-600')}>{t.blocked}</div></Card>
          <Card className="p-4"><div className="text-[12px] text-stone-500">Documents à renouveler</div><div className="text-xl font-semibold num">{t.expiring}</div></Card>
        </div>

        {data.rows.length === 0 ? <Card><Empty icon={Wrench} title="Aucun sous-traitant">Ajoutez un contact de type « Sous-traitant » avec ses dates d’attestation URSSAF et d’assurance.</Empty></Card> :
          data.rows.map((s) => (
            <Card key={s.id} className="p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div><Link to={`/contacts/${s.id}`} className="font-semibold hover:underline">{s.company || s.name}</Link><div className="text-[12.5px] text-stone-500">{[s.company ? s.name : null, s.trade, s.phone].filter(Boolean).join(' · ')}</div></div>
                <div className="ml-auto flex flex-col items-end gap-1">
                  {s.compliance.ok ? <Badge className="bg-emerald-50 text-emerald-700"><BadgeCheck size={13} className="mr-1" />Conforme</Badge> : <Badge className="bg-rose-50 text-rose-700"><ShieldAlert size={13} className="mr-1" />Missions bloquées</Badge>}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3"><DocPill label="Assurance RC pro / décennale" d={s.compliance.rc} /><DocPill label="Attestation URSSAF" d={s.compliance.urssaf} /></div>
              <div className="flex gap-6 mt-3 text-[13px] text-stone-600"><span>{s.stats.count} mission{s.stats.count > 1 ? 's' : ''}</span><span>Déjà réglé : <b className="num">{money(s.stats.paid)}</b></span>{s.stats.to_pay > 0 && <span className="text-amber-700">À régler : <b className="num">{money(s.stats.to_pay)}</b></span>}</div>
              <PortalPanel s={s} />
              {s.missions.length > 0 && (
                <table className="w-full text-[13px] mt-3"><tbody>
                  {s.missions.slice(0, 8).map((m) => { const [l, c] = MSTATUS(m); return (
                    <tr key={m.id} className="border-t border-line">
                      <td className="py-2 pr-2"><Link to={`/dossier/${m.project_id}`} className="font-medium hover:underline">{m.project_title}</Link><div className="text-[12px] text-stone-400">{[m.project_address, m.project_city].filter(Boolean).join(', ')}</div></td>
                      <td className="text-right num whitespace-nowrap">{money(m.total)} HT</td>
                      <td className="px-3"><Badge className={c}>{l}</Badge></td>
                      <td className="text-right whitespace-nowrap">
                        {m.status === 'accepte' && !m.done_at && <Btn size="sm" icon={CheckCircle2} onClick={() => run(() => post(`/assignments/${m.id}/done`, {}), 'Mission marquée terminée')}>Terminée</Btn>}
                        {m.status === 'accepte' && m.done_at && !m.paid_at && <Btn size="sm" variant="primary" icon={HandCoins} onClick={() => setPay({ m, amount: m.total, vat: 0, method: 'virement', invoice_ref: m.sub_invoice_ref || '', date: new Date().toISOString().slice(0, 10) })}>Régler</Btn>}
                      </td>
                    </tr>); })}
                </tbody></table>)}
            </Card>))}
      </div>

      <Modal open={!!pay} onClose={() => setPay(null)} title="Règlement du sous-traitant" footer={<><Btn onClick={() => setPay(null)}>Annuler</Btn><Btn variant="primary" loading={busy} onClick={() => run(async () => { await post(`/assignments/${pay.m.id}/paid`, { amount: pay.amount, vat: pay.vat, method: pay.method, invoice_ref: pay.invoice_ref, date: pay.date }); setPay(null); }, 'Règlement enregistré (ajouté aux dépenses de l’intervention)')}>Enregistrer</Btn></>}>
        {pay && <div className="space-y-3">
          <div className="text-[13px] text-stone-600">{pay.m.project_title}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant HT"><NumInput value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} /></Field>
            <Field label="TVA"><Select value={pay.vat} onChange={(e) => setPay({ ...pay, vat: Number(e.target.value) })}><option value={0}>0 % (franchise / autoliquidation)</option><option value={10}>10 %</option><option value={20}>20 %</option></Select></Field>
            <Field label="Mode de paiement"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="virement">Virement</option><option value="especes">Espèces</option><option value="cheque">Chèque</option><option value="cb">Carte bancaire</option><option value="autre">Autre</option></Select></Field>
            <Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
          </div>
          <Field label="N° de facture du sous-traitant"><Input value={pay.invoice_ref} onChange={(e) => setPay({ ...pay, invoice_ref: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  );
}
