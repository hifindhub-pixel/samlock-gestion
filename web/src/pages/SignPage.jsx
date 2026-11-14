import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ShieldCheck, Mail, FileText, AlertCircle, Loader2 } from 'lucide-react';
import { get, post } from '../lib/api.js';
import { BrandMark, Btn, Input } from '../lib/ui.jsx';
import { money, dateFr } from '../lib/format.js';

export default function SignPage() {
  const { type, token } = useParams();
  const base = `/public/sign/${type}/${token}`;
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  const [step, setStep] = useState(1); // 1 lecture · 2 code
  const [name, setName] = useState(''); const [accept, setAccept] = useState(false); const [photo, setPhoto] = useState(false);
  const [code, setCode] = useState(''); const [sentTo, setSentTo] = useState(''); const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const load = () => get(base).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  const askCode = async () => {
    setBusy(true); setMsg('');
    try { const r = await post(base + '/otp'); setSentTo(r.sent_to); setDevCode(r.dev_code || ''); setStep(2); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const sign = async () => {
    setBusy(true); setMsg('');
    try { await post(base + '/confirm', { name, code, accept, photo_auth: photo }); await load(); setStep(3); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  if (err && !d) return <div className="min-h-full grid place-items-center p-8 text-stone-500">Ce lien n'est plus valide.</div>;
  if (!d) return <div className="min-h-full grid place-items-center"><Loader2 className="animate-spin text-stone-400" /></div>;
  const isQuote = type === 'quote';
  const signed = d.state === 'signed';

  return (
    <div className="min-h-full bg-surface">
      <header className="bg-white border-b border-line">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-2.5">
          <BrandMark size={32} />
          <div className="font-semibold">{d.company}</div>
          <div className="ml-auto flex items-center gap-1.5 text-[12px] text-stone-500"><ShieldCheck size={14} className="text-emerald-600" /> Signature électronique sécurisée</div>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 py-6 grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="bg-white border border-line rounded-2xl overflow-hidden order-2 lg:order-1">
          <div className="px-4 h-11 flex items-center gap-2 border-b border-line text-[13px] font-medium"><FileText size={15} className="text-stone-400" />{d.title}
            <a href={d.pdf} target="_blank" rel="noreferrer" className="ml-auto text-accent text-[12.5px]">Ouvrir / télécharger</a></div>
          <iframe title="Document" src={d.pdf + '#toolbar=0&navpanes=0'} className="w-full h-[70vh] bg-stone-100" />
        </div>

        <aside className="order-1 lg:order-2 lg:sticky lg:top-6">
          <div className="bg-white border border-line rounded-2xl p-5">
            <div className="text-[12px] uppercase tracking-wide text-stone-400 font-semibold">{isQuote ? 'Votre devis' : 'Bon d’intervention'}</div>
            <h1 className="text-xl font-semibold tracking-tight mt-1">{d.subtitle}</h1>
            <div className="text-stone-500 text-[13px] mt-0.5">Bonjour {d.contact_name}</div>
            {d.amount != null && <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3"><span className="text-stone-500">Total TTC</span><span className="text-2xl font-semibold num">{money(d.amount)}</span></div>}
            {d.reserves && <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-900"><b>Observations :</b> {d.reserves}</div>}

            {signed ? (
              <div className="mt-5 text-center py-4">
                <CheckCircle2 size={42} className="mx-auto text-emerald-600" />
                <div className="font-semibold mt-3">{isQuote ? 'Devis signé' : 'Bon signé'}</div>
                <div className="text-stone-500 text-[13px] mt-1">Par {d.signer} · {dateFr(d.signed_at)}</div>
                <a href={d.pdf} className="inline-block mt-4 text-accent font-medium text-[13px]">Télécharger le document signé</a>
                {step === 3 && <p className="text-stone-500 text-[12.5px] mt-3">{isQuote ? "Nous revenons vers vous très vite pour planifier l’intervention." : 'Votre facture de solde vous sera adressée prochainement.'}</p>}
              </div>
            ) : d.state !== 'open' ? (
              <div className="mt-5 flex gap-2 text-[13px] text-stone-600 bg-stone-50 rounded-lg p-3"><AlertCircle size={16} className="shrink-0 mt-0.5" />{d.state === 'expired' ? 'Ce devis est arrivé à expiration. Contactez-nous pour en obtenir une version à jour.' : "Ce document n'est pas ouvert à la signature."}</div>
            ) : step === 1 ? (
              <div className="mt-5 space-y-3">
                <label className="block"><span className="block text-[12px] font-medium text-stone-600 mb-1">Nom et prénom du signataire</span>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Amélie Vidal" autoComplete="name" /></label>
                <label className="flex gap-2.5 text-[13px] text-stone-700 cursor-pointer"><input type="checkbox" className="mt-0.5 accent-orange-700" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                  <span><b>Lu et approuvé.</b> {isQuote ? "Je reconnais avoir pris connaissance du devis et l'accepte, bon pour accord." : 'Je reconnais que l’intervention a été réalisée, sous les observations éventuelles indiquées.'}</span></label>
                {d.photo && <label className="flex gap-2.5 text-[13px] text-stone-500 cursor-pointer"><input type="checkbox" className="mt-0.5 accent-orange-700" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />
                  <span>J'autorise {d.company} à publier des photos de l’intervention (réalisations), sans mention de mon nom. <i>(optionnel)</i></span></label>}
                {msg && <div className="text-rose-600 text-[13px]">{msg}</div>}
                <Btn variant="primary" size="lg" className="w-full" disabled={!name.trim() || !accept} loading={busy} icon={Mail} onClick={askCode}>Recevoir mon code par e-mail</Btn>
                <p className="text-[11.5px] text-stone-400 leading-snug">Un code à 6 chiffres sera envoyé à {d.email_hint}. Il confirme votre identité et scelle le document.</p>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <div className="text-[13px] text-stone-600">Code envoyé à <b>{sentTo}</b> (valable 15 min).</div>
                <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoFocus placeholder="000000" className="text-center text-2xl tracking-[.4em] font-semibold h-14 num" />
                {devCode && <div className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">Mode démo (e-mail simulé) — code : <b className="num">{devCode}</b></div>}
                {msg && <div className="text-rose-600 text-[13px]">{msg}</div>}
                <Btn variant="primary" size="lg" className="w-full" disabled={code.length !== 6} loading={busy} onClick={sign}>Signer le document</Btn>
                <button onClick={() => { setStep(1); setCode(''); setMsg(''); }} className="w-full text-[12.5px] text-stone-500 hover:text-stone-800">Renvoyer un code / modifier</button>
              </div>
            )}
          </div>
          <p className="text-[11.5px] text-stone-400 mt-3 px-1 leading-snug">Signature électronique simple (règlement eIDAS) : identité vérifiée par e-mail, date, adresse IP et empreinte du document conservées comme preuve.</p>
        </aside>
      </div>
    </div>
  );
}
