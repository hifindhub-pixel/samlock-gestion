import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Paperclip } from 'lucide-react';
import { get } from '../lib/api.js';
import { BrandMark, Btn, Input, Textarea } from '../lib/ui.jsx';

export default function SupplierPublic() {
  const { token } = useParams();
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [ans, setAns] = useState({}); const [file, setFile] = useState(null); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { get(`/public/requests/${token}`).then((x) => { setD(x); const a = {}; x.items.forEach((i) => (a[i.id] = { id: i.id, price: i.answer_price ?? '', ref: i.answer_ref || '', label: i.answer_label || '', delay: i.answer_delay || '', comment: i.answer_comment || '' })); setAns(a); }).catch((e) => setErr(e.message)); }, [token]);
  const upd = (id, k, v) => setAns((a) => ({ ...a, [id]: { ...a[id], [k]: v } }));
  const send = async () => {
    setBusy(true);
    const fd = new FormData(); fd.append('answers', JSON.stringify(Object.values(ans))); if (file) fd.append('file', file);
    const r = await fetch(`/api/public/requests/${token}`, { method: 'POST', body: fd });
    setBusy(false); r.ok ? setDone(true) : setErr('Envoi impossible, réessayez.');
  };
  if (err && !d) return <div className="min-h-full grid place-items-center p-8 text-stone-500">Ce lien n'est plus valide.</div>;
  if (!d) return null;
  if (done) return <div className="min-h-full grid place-items-center p-8"><div className="text-center max-w-sm"><CheckCircle2 size={44} className="mx-auto text-emerald-600" /><h1 className="text-xl font-semibold mt-4">Merci, réponse bien reçue</h1><p className="text-stone-500 mt-1.5">{d.company} reviendra vers vous rapidement.</p></div></div>;
  return (
    <div className="min-h-full bg-surface">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div className="flex items-center gap-2.5 mb-6"><BrandMark size={40} /><div><div className="font-semibold">{d.company}</div><div className="text-[12.5px] text-stone-500">Demande de prix</div></div></div>
        <h1 className="text-2xl font-semibold tracking-tight">Bonjour {d.supplier},</h1>
        <p className="text-stone-600 mt-1.5">Merci d'indiquer votre meilleur prix pour {d.items.length > 1 ? 'les articles suivants' : "l'article suivant"}. Cela prend une minute.</p>
        {d.items[0].message && <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900 text-[13px]">{d.items[0].message}</div>}
        <div className="mt-6 space-y-4">
          {d.items.map((i) => (
            <div key={i.id} className="bg-white border border-line rounded-2xl p-4">
              <div className="font-medium">{i.label.replace(/ – à chiffrer$/, '')}</div>
              <div className="text-stone-500 text-[13px] mb-3">Quantité : <b>{i.qty} {i.unit}</b></div>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="block text-[12px] font-medium text-stone-600 mb-1">Prix HT unitaire (€) *</span><Input inputMode="decimal" value={ans[i.id]?.price} onChange={(e) => upd(i.id, 'price', e.target.value)} placeholder="0,00" className="text-right num font-semibold" /></label>
                <label><span className="block text-[12px] font-medium text-stone-600 mb-1">Délai</span><Input value={ans[i.id]?.delay} onChange={(e) => upd(i.id, 'delay', e.target.value)} placeholder="Ex. 3 jours" /></label>
                <label><span className="block text-[12px] font-medium text-stone-600 mb-1">Votre référence</span><Input value={ans[i.id]?.ref} onChange={(e) => upd(i.id, 'ref', e.target.value)} /></label>
                <label><span className="block text-[12px] font-medium text-stone-600 mb-1">Désignation chez vous</span><Input value={ans[i.id]?.label} onChange={(e) => upd(i.id, 'label', e.target.value)} /></label>
                <label className="col-span-2"><span className="block text-[12px] font-medium text-stone-600 mb-1">Remarque</span><Textarea rows={2} value={ans[i.id]?.comment} onChange={(e) => upd(i.id, 'comment', e.target.value)} placeholder="Conditions, hors pose, livraison…" /></label>
              </div>
            </div>
          ))}
        </div>
        <label className="mt-4 flex items-center gap-2 text-[13px] text-stone-600 bg-white border border-dashed border-stone-300 rounded-xl p-3 cursor-pointer"><Paperclip size={15} />{file ? file.name : 'Joindre votre devis (PDF, optionnel)'}<input type="file" className="hidden" onChange={(e) => setFile(e.target.files[0])} /></label>
        <Btn variant="primary" size="lg" className="w-full mt-5" loading={busy} onClick={send} disabled={!Object.values(ans).some((a) => a.price !== '')}>Envoyer ma réponse</Btn>
      </div>
    </div>
  );
}
