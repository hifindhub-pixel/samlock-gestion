import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, MapPin, Phone, Calendar, KeyRound, Car, AlertTriangle, FileDown, Loader2 } from 'lucide-react';
import { get, post } from '../lib/api.js';
import { BrandMark, Btn, Input } from '../lib/ui.jsx';
import { money, dateFr } from '../lib/format.js';

const Row = ({ icon: I, label, children }) => children ? (
  <div className="flex gap-3 py-2.5 border-b border-line last:border-0"><I size={16} className="text-stone-400 mt-0.5 shrink-0" /><div><div className="text-[11.5px] text-stone-400 uppercase tracking-wide font-semibold">{label}</div><div className="text-[14px]">{children}</div></div></div>
) : null;

export default function SubPublic() {
  const { token } = useParams();
  const [d, setD] = useState(null); const [err, setErr] = useState(false); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState(''); const [ref, setRef] = useState('');
  const load = () => get(`/public/assignments/${token}`).then(setD).catch(() => setErr(true));
  useEffect(() => { load(); }, [token]); // eslint-disable-line
  if (err) return <div className="min-h-full grid place-items-center p-8 text-stone-500">Ce lien n'est plus valide.</div>;
  if (!d) return <div className="min-h-full grid place-items-center"><Loader2 className="animate-spin text-stone-400" /></div>;
  const accepted = d.status === 'accepte';
  const addr = [d.project.address, d.project.city].filter(Boolean).join(', ');
  return (
    <div className="min-h-full bg-surface">
      <div className="max-w-xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2.5 mb-6"><BrandMark size={40} /><div><div className="font-semibold">{d.company}</div><div className="text-[12.5px] text-stone-500">Ordre de mission</div></div></div>
        <h1 className="text-2xl font-semibold tracking-tight">{d.project.title}</h1>
        <p className="text-stone-600 mt-1">Bonjour {d.sub.name}, voici les informations de votre intervention{d.sub.trade ? ` (${d.sub.trade})` : ''}.</p>

        <div className="bg-white border border-line rounded-2xl px-4 mt-5">
          <Row icon={MapPin} label="Adresse de l’intervention">{addr && <a className="text-accent font-medium" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer">{addr}</a>}</Row>
          <Row icon={Phone} label="Contact sur place">{d.client.name}{d.client.phone && <> · <a className="text-accent" href={`tel:${d.client.phone}`}>{d.client.phone}</a></>}</Row>
          <Row icon={Calendar} label="Dates">{(d.start_date || d.end_date) && `${d.start_date ? 'Du ' + dateFr(d.start_date) : ''} ${d.end_date ? 'au ' + dateFr(d.end_date) : ''}`}</Row>
          <Row icon={KeyRound} label="Accès / code">{[d.info.access_code && `Code : ${d.info.access_code}`, d.info.floor && `Étage : ${d.info.floor}`].filter(Boolean).join(' · ')}</Row>
          <Row icon={Car} label="Stationnement">{d.info.parking}</Row>
          <Row icon={AlertTriangle} label="Contraintes">{d.info.constraints}</Row>
        </div>

        {d.message && <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900 text-[13.5px]">{d.message}</div>}

        <h2 className="font-semibold mt-6 mb-2">Prestation à réaliser</h2>
        <div className="bg-white border border-line rounded-2xl divide-y divide-line">
          {d.items.map((i, k) => (
            <div key={k} className="p-4"><div className="font-medium">{i.label}</div>
              {i.description && <div className="text-stone-500 text-[13px] mt-1 whitespace-pre-line">{i.description}</div>}
              <div className="text-[12.5px] text-stone-400 mt-1">Quantité : {i.qty} {i.unit}</div></div>
          ))}
          <div className="p-4 flex justify-between items-baseline bg-stone-50 rounded-b-2xl"><span className="text-stone-500">Montant convenu HT</span><span className="text-lg font-semibold num">{money(d.total)}</span></div>
        </div>

        {d.photos.length > 0 && <>
          <h2 className="font-semibold mt-6 mb-2">Photos avant intervention</h2>
          <div className="grid grid-cols-3 gap-2">{d.photos.map((p) => <a key={p.id} href={`/api/public/assignments/${token}/photo/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/public/assignments/${token}/photo/${p.id}`} alt={p.room || ''} className="aspect-square object-cover rounded-xl border border-line w-full" /></a>)}</div>
        </>}

        <a href={`/api/public/assignments/${token}/pdf`} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-1.5 text-accent font-medium text-[13px]"><FileDown size={15} /> Télécharger l'ordre de mission (PDF)</a>

        <div className="mt-6">
          {accepted ? (
            d.done_at ? (
              <div className="text-center bg-emerald-50 border border-emerald-200 rounded-2xl p-5"><CheckCircle2 size={34} className="mx-auto text-emerald-600" /><div className="font-semibold mt-2">{d.paid_at ? 'Mission réglée' : 'Mission terminée'}</div><div className="text-[13px] text-stone-600 mt-1">{d.paid_at ? `Règlement enregistré le ${dateFr(d.paid_at)}.` : 'Merci ! Le règlement est en cours de traitement.'}</div></div>
            ) : (
              <div className="bg-white border border-line rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} className="text-emerald-600" /> Ordre accepté</div>
                <div className="text-[13px] text-stone-600">Une fois l’intervention terminée, déclarez-la ici : cela déclenche votre règlement.</div>
                <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="N° de votre facture (facultatif)" />
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Remarque (facultatif)" />
                <Btn variant="primary" size="lg" className="w-full" loading={busy} onClick={async () => { setBusy(true); try { await post(`/public/assignments/${token}/done`, { note, invoice_ref: ref }); await load(); } finally { setBusy(false); } }}>Mission terminée</Btn>
              </div>
            )
          ) : (
            <div className="bg-white border border-line rounded-2xl p-4 space-y-3">
              <div className="text-[13px] text-stone-600">En validant, vous confirmez accepter cette prestation au montant convenu (bon de commande).</div>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Votre nom" />
              <Btn variant="primary" size="lg" className="w-full" disabled={!name.trim()} loading={busy} onClick={async () => { setBusy(true); try { await post(`/public/assignments/${token}/accept`, { name }); await load(); } finally { setBusy(false); } }}>J'accepte l'ordre de mission</Btn>
            </div>
          )}
        </div>
        <p className="text-center text-[12px] text-stone-400 mt-8">Une question ? {d.company_phone}</p>
      </div>
    </div>
  );
}
