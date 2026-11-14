import { useState } from 'react';
import { Check, X, Mail, Store, ShieldCheck, Paperclip, ArrowRight, Send } from 'lucide-react';
import { get, post, put } from '../lib/api.js';
import { money, pct, ago } from '../lib/format.js';
import { Btn, Card, Empty, Input, NumInput, PageHeader, Textarea, useFetch, useToast, cn, MarginPill } from '../lib/ui.jsx';

const KIND = { email_devis: 'Devis au client', email_prix: 'Demande de prix', email_facture: 'Facture au client', email_pv: 'PV de réception', email_rapport: 'Rapport d’intervention', email_fin_intervention: 'Fin d’intervention', email_relance: 'Relance', email_ss_traitant: 'Ordre de mission' };

function OutboxCard({ o, onDone }) {
  const [f, setF] = useState(o); const [busy, setBusy] = useState(false); const [open, setOpen] = useState(false); const toast = useToast();
  const approve = async () => { setBusy(true); try { await put(`/outbox/${o.id}`, { subject: f.subject, body: f.body, to_addr: f.to_addr }); await post(`/outbox/${o.id}/approve`); toast('Message envoyé'); onDone(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const reject = async () => { await post(`/outbox/${o.id}/reject`); toast('Message écarté'); onDone(); };
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-stone-50" onClick={() => setOpen(!open)}>
        <span className={cn('w-8 h-8 rounded-lg grid place-items-center', o.kind === 'email_devis' ? 'bg-orange-100 text-accent' : 'bg-sky-100 text-sky-700')}>{o.kind === 'email_devis' ? <Mail size={15} /> : <Store size={15} />}</span>
        <div className="min-w-0 flex-1"><div className="font-medium truncate">{o.subject}</div><div className="text-[12.5px] text-stone-500">{KIND[o.kind] || o.kind} · à {o.to_addr} · {ago(o.created_at)}</div></div>
        <Btn size="sm" icon={X} variant="ghost" onClick={(e) => { e.stopPropagation(); reject(); }}>Écarter</Btn>
        <Btn size="sm" variant="primary" icon={Send} loading={busy} onClick={(e) => { e.stopPropagation(); approve(); }}>Valider et envoyer</Btn>
      </div>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-2.5 border-t border-line bg-stone-50/50">
          <Input value={f.to_addr} onChange={(e) => setF({ ...f, to_addr: e.target.value })} />
          <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} className="font-medium" />
          <Textarea rows={9} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </div>
      )}
    </Card>
  );
}

function PriceCard({ r, margin, onDone }) {
  const [price, setPrice] = useState(r.answer_price); const [m, setM] = useState(Number(margin)); const [busy, setBusy] = useState(false); const toast = useToast();
  const sale = Math.round((price / (1 - Math.min(m, 95) / 100)) * 100) / 100;
  const ok = async () => { setBusy(true); try { await post(`/price-requests/${r.id}/validate`, { price, margin_rate: m }); toast('Article créé dans le catalogue · ligne du devis mise à jour'); onDone(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const no = async () => { await post(`/price-requests/${r.id}/reject`); onDone(); };
  const tag = 'num w-full h-9 rounded-lg border border-stone-300 bg-white px-3 text-right outline-none focus:border-accent focus:ring-3 focus:ring-orange-200/70';
  return (
    <Card className="p-4">
      <div className="flex flex-col md:flex-row md:items-start gap-3">
        <span className="w-8 h-8 rounded-lg grid place-items-center bg-sky-100 text-sky-700 shrink-0"><Store size={15} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug">{r.label}</div>
          <div className="text-[12.5px] text-stone-500 mt-0.5">{r.supplier_name} · {r.quote_number || 'Brouillon'} · {r.project_title} · répondu {ago(r.answered_at)}</div>
          <div className="mt-2 rounded-lg bg-stone-50 border border-line p-2.5 text-[12.5px] space-y-0.5">
            {r.answer_label && <div><span className="text-stone-400">Désignation fournisseur :</span> {r.answer_label}</div>}
            <div className="flex flex-wrap gap-x-5">{r.answer_ref && <span><span className="text-stone-400">Réf. :</span> {r.answer_ref}</span>}{r.answer_delay && <span><span className="text-stone-400">Délai :</span> {r.answer_delay}</span>}</div>
            {r.answer_comment && <div className="text-stone-600">« {r.answer_comment} »</div>}
            {r.answer_file && <a className="inline-flex items-center gap-1 text-accent font-medium" href={`/api/price-requests/${r.id}/file`} target="_blank"><Paperclip size={12} /> Devis fournisseur joint</a>}
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-3 items-end max-w-xl">
            <label><span className="block text-[11.5px] text-stone-500 mb-1">Prix d'achat HT</span><NumInput value={price} onChange={setPrice} className={tag} /></label>
            <span className="pb-2 text-stone-300 hidden md:block">+</span>
            <label><span className="block text-[11.5px] text-stone-500 mb-1">Marge (%)</span><NumInput value={m} onChange={setM} className={tag} /></label>
            <ArrowRight size={14} className="mb-3 text-stone-300 hidden md:block" />
            <div className="col-span-2 md:col-span-1"><span className="block text-[11.5px] text-stone-500 mb-1">Prix de vente HT</span><div className="num h-9 rounded-lg bg-emerald-50 text-emerald-800 font-semibold grid place-items-center">{money(sale)}</div></div>
          </div>
        </div>
        <div className="flex flex-row md:flex-col gap-2"><Btn variant="success" size="sm" icon={Check} loading={busy} onClick={ok}>Valider</Btn><Btn size="sm" variant="ghost" icon={X} onClick={no}>Refuser</Btn></div>
      </div>
    </Card>
  );
}

export default function Validations() {
  const out = useFetch(() => get('/outbox?status=pending'));
  const prices = useFetch(() => get('/price-requests/pending'));
  const sent = useFetch(() => get('/outbox?status=sent'));
  const { data: settings } = useFetch(() => get('/settings'));
  const reloadAll = () => { out.reload(); prices.reload(); sent.reload(); };
  const n = (out.data?.length || 0) + (prices.data?.length || 0);
  return (
    <div>
      <PageHeader title="Validations" subtitle="Rien ne part et rien n'est modifié sans votre accord. Tout ce qui attend une décision est ici." />
      <div className="px-8 pb-10 max-w-[1000px] space-y-8">
        {n === 0 && <Card><Empty icon={ShieldCheck} title="Tout est à jour">Aucun message ni aucun prix n'attend votre validation.</Empty></Card>}
        {(prices.data?.length > 0) && (
          <section><h2 className="font-semibold mb-3 flex items-center gap-2">Réponses de fournisseurs à valider <span className="bg-accent text-white text-[11px] rounded-full px-2 py-0.5">{prices.data.length}</span></h2>
            <div className="space-y-3">{prices.data.map((r) => <PriceCard key={r.id} r={r} margin={settings?.default_margin || 30} onDone={reloadAll} />)}</div></section>
        )}
        {(out.data?.length > 0) && (
          <section><h2 className="font-semibold mb-3 flex items-center gap-2">Messages à envoyer <span className="bg-accent text-white text-[11px] rounded-full px-2 py-0.5">{out.data.length}</span></h2>
            <div className="space-y-3">{out.data.map((o) => <OutboxCard key={o.id} o={o} onDone={reloadAll} />)}</div></section>
        )}
        {(sent.data?.length > 0) && (
          <section><h2 className="font-semibold mb-3 text-stone-500">Envoyés récemment</h2>
            <Card className="divide-y divide-line">{sent.data.slice(0, 8).map((o) => <div key={o.id} className="px-4 py-2.5 flex items-center gap-3 text-[13px]"><Check size={14} className="text-emerald-600" /><span className="flex-1 truncate">{o.subject}</span><span className="text-stone-400">{o.to_addr}</span><span className="text-stone-400 w-24 text-right">{ago(o.decided_at)}</span></div>)}</Card></section>
        )}
      </div>
    </div>
  );
}
