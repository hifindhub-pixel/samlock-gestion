import { useEffect, useState } from 'react';
import { Car, FileSpreadsheet, MapPin, RefreshCw } from 'lucide-react';
import { del, get, post, put } from '../lib/api.js';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, useFetch, useToast, cn } from '../lib/ui.jsx';
import { money, dateFr, num } from '../lib/format.js';
import { Link } from 'react-router-dom';

const METHOD = { route: ['Itinéraire', 'bg-emerald-50 text-emerald-700'], estimation: ['Estimation', 'bg-amber-50 text-amber-700'], manuel: ['Saisie manuelle', 'bg-sky-50 text-sky-700'] };
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export default function Ik() {
  const toast = useToast();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const { data, reload } = useFetch(() => get(`/ik?year=${year}`), [year]);
  const [edit, setEdit] = useState(null); const [busy, setBusy] = useState(false);
  // Les distances manquantes se calculent en arrière-plan : on rafraîchit tant qu’il en reste
  useEffect(() => { if (!data?.pending && !data?.missing) return undefined; const t = setTimeout(reload, 2500); return () => clearTimeout(t); }, [data]); // eslint-disable-line
  if (!data) return null;
  const S = data.settings; const veh = { voiture: 'Voiture', moto: 'Moto', cyclo: 'Cyclomoteur' }[S.vehicle];

  const act = async (fn, msg) => { setBusy(true); try { await fn(); await reload(); if (msg) toast(msg); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const bars = data.by_month || [];
  const maxIk = Math.max(1, ...bars.map((m) => m.ik));

  return (
    <div className="pb-10">
      <PageHeader title="Indemnités kilométriques" subtitle={`${veh} ${S.cv} CV${S.electric ? ' électrique' : ''} · ${S.roundTrip ? 'aller-retour' : 'aller simple'} depuis ${S.origin}`}
        actions={<><Select value={year} onChange={(e) => setYear(e.target.value)} className="w-28">{data.years.map((y) => <option key={y}>{y}</option>)}</Select>
          <a href={`/api/ik/export.xlsx?year=${year}`}><Btn icon={FileSpreadsheet}>Export Excel</Btn></a></>} />
      <div className="px-8 space-y-5">
        {!S.enabled && <Card className="p-4 text-amber-800 bg-amber-50 border-amber-200">Le calcul des IK est désactivé : activez-le dans Paramètres → Véhicule & indemnités kilométriques.</Card>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4"><div className="text-[12px] text-stone-500">IK {year} (cumul)</div><div className="text-xl font-semibold num text-accent">{money(data.totals.ik)}</div></Card>
          <Card className="p-4"><div className="text-[12px] text-stone-500">Kilomètres professionnels</div><div className="text-xl font-semibold num">{num(data.totals.km, 1)} km</div></Card>
          <Card className="p-4"><div className="text-[12px] text-stone-500">Interventions comptées</div><div className="text-xl font-semibold num">{data.totals.count}</div></Card>
          <Card className="p-4"><div className="text-[12px] text-stone-500">Coût moyen au km</div><div className="text-xl font-semibold num">{num(data.totals.avg_per_km, 3)} €</div></Card>
        </div>
        {(data.missing > 0 || data.pending > 0) && <div className="text-[13px] text-stone-500 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Calcul des distances en cours ({data.missing || data.pending} intervention{(data.missing || data.pending) > 1 ? 's' : ''})…</div>}

        {bars.length > 0 && <Card className="p-5"><div className="font-semibold mb-3">IK par mois</div>
          <div className="flex items-end gap-3 h-28">{bars.map((m) => <div key={m.m} className="flex-1 max-w-[72px] flex flex-col items-center gap-1"><div className="text-[11px] num text-stone-500">{m.ik ? Math.round(m.ik) : ''}</div><div className="w-full rounded-t bg-accent/80" style={{ height: `${Math.max(3, (m.ik / maxIk) * 80)}px` }} title={`${money(m.ik)} · ${num(m.km, 1)} km`} /><div className="text-[11px] text-stone-400">{MONTHS[Number(m.m.slice(5, 7)) - 1]}</div></div>)}</div></Card>}

        {data.rows.length === 0 ? <Card><Empty icon={Car} title="Aucune facture émise cette année">Dès qu’une facture est émise, son trajet est calculé automatiquement (adresse de l’intervention ↔ votre adresse de départ) et l’indemnité s’ajoute au cumul.</Empty></Card> : (
          <Card className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead><tr className="text-left text-stone-400 text-[12px] border-b border-line"><th className="p-3">Date</th><th>Facture</th><th>Client / lieu</th><th className="text-right">Km aller</th><th className="text-right">Km retenus</th><th className="text-right">Cumul</th><th>Calcul</th><th className="text-right">IK</th><th /></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.invoice_id} className="border-b border-line last:border-0">
                  <td className="p-3 whitespace-nowrap">{dateFr(r.issued_at)}</td>
                  <td><Link className="text-accent font-medium hover:underline" to={`/dossier/${r.project_id}`}>{r.number}</Link></td>
                  <td><div className="font-medium">{r.client}</div><div className="text-[12px] text-stone-400 flex items-center gap-1"><MapPin size={11} />{r.destination || '—'}</div></td>
                  <td className="text-right num">{r.km_one_way != null ? num(r.km_one_way, 1) : '…'}</td>
                  <td className="text-right num">{r.km_total != null ? num(r.km_total, 1) : '…'}</td>
                  <td className="text-right num text-stone-500">{r.cum_km != null ? num(r.cum_km, 1) : ''}</td>
                  <td>{r.method ? <Badge className={METHOD[r.method]?.[1]}>{METHOD[r.method]?.[0] || r.method}</Badge> : r.error ? <span className="text-rose-600 text-[12px]" title={r.error}>Échec</span> : <span className="text-stone-400 text-[12px]">en cours</span>}</td>
                  <td className="text-right num font-semibold">{r.ik != null ? money(r.ik) : '…'}</td>
                  <td className="p-2 text-right whitespace-nowrap"><Btn size="sm" variant="ghost" onClick={() => setEdit({ ...r, km: r.km_one_way ?? '' })}>Corriger</Btn></td>
                </tr>))}</tbody>
              <tfoot><tr className="font-semibold"><td className="p-3" colSpan={4}>Total {year}</td><td className="text-right num">{num(data.totals.km, 1)}</td><td /><td /><td className="text-right num">{money(data.totals.ik)}</td><td /></tr></tfoot>
            </table>
          </Card>)}
        <p className="text-[12px] text-stone-500">{data.bareme}. Le barème est progressif sur l’année : chaque facture reçoit la part d’indemnité qu’elle ajoute au cumul. Les trajets « Estimation » sont calculés à vol d’oiseau majoré quand le service d’itinéraire ne répond pas.</p>
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Distance — ${edit.number}` : ''}
        footer={<><Btn onClick={() => setEdit(null)}>Fermer</Btn><Btn icon={RefreshCw} loading={busy} onClick={() => act(async () => { await post(`/invoices/${edit.invoice_id}/ik/recompute`); setEdit(null); }, 'Distance recalculée')}>Recalculer</Btn><Btn variant="primary" loading={busy} onClick={() => act(async () => { await put(`/invoices/${edit.invoice_id}/ik`, { km_one_way: edit.km }); setEdit(null); }, 'Distance enregistrée')}>Enregistrer</Btn></>}>
        {edit && <div className="space-y-3"><div className="text-[13px] text-stone-600">{edit.destination}</div>
          <Field label="Distance aller (km)" hint={S.roundTrip ? 'Le retour est ajouté automatiquement.' : undefined}><NumInput value={edit.km} onChange={(v) => setEdit({ ...edit, km: v })} /></Field>
          {edit.manual && <Btn size="sm" variant="ghost" onClick={() => act(async () => { await del(`/invoices/${edit.invoice_id}/ik`); setEdit(null); }, 'Retour au calcul automatique')}>Revenir au calcul automatique</Btn>}</div>}
      </Modal>
    </div>
  );
}
