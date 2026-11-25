// Espace intervenant (sous-traitant) : lien personnel, utilisable sur téléphone.
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Phone, MapPin, Plus, Trash2, FileSignature, ClipboardCheck, Receipt, Loader2, Search, Wallet, Wrench } from 'lucide-react';
import { get, post } from '../lib/api.js';
import { BrandMark, Btn, Input, Select, Field, Modal, NumInput, Badge, StageBadge, useToast, cn } from '../lib/ui.jsx';
import { money } from '../lib/format.js';

const QS = { brouillon: ['Brouillon', 'bg-stone-100 text-stone-600'], envoye: ['À signer', 'bg-amber-50 text-amber-700'], vu: ['Vu', 'bg-amber-50 text-amber-700'], signe: ['Signé', 'bg-emerald-50 text-emerald-700'], refuse: ['Refusé', 'bg-rose-50 text-rose-700'], expire: ['Expiré', 'bg-rose-50 text-rose-700'] };
const IS = { brouillon: ['En préparation', 'bg-stone-100 text-stone-600'], envoyee: ['Envoyée', 'bg-amber-50 text-amber-700'], payee: ['Payée', 'bg-emerald-50 text-emerald-700'] };

/** Sélecteur de prestations du catalogue (prix de vente visibles, jamais les coûts). */
function LinesPicker({ catalog, lines, setLines }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => { const w = q.trim().toLowerCase().split(/\s+/).filter(Boolean); if (!w.length) return []; return catalog.filter((c) => w.every((x) => `${c.label} ${c.ref || ''} ${c.category || ''}`.toLowerCase().includes(x))).slice(0, 8); }, [q, catalog]);
  const add = (c) => { setLines([...lines, { item_id: c.id, label: c.label, qty: 1, unit_price: c.price_ht, vat: c.vat, unit: c.unit }]); setQ(''); };
  const upd = (i, patch) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const ttc = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0) * (1 + l.vat / 100), 0);
  return (
    <div className="space-y-2">
      <div className="relative"><Search size={15} className="absolute left-3 top-3 text-stone-400" /><Input className="pl-9" placeholder="Rechercher une prestation (cylindre, ouverture de porte…)" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {hits.length > 0 && <div className="border border-line rounded-xl bg-white divide-y divide-line max-h-64 overflow-auto">{hits.map((c) => <button key={c.id} type="button" onClick={() => add(c)} className="w-full text-left px-3 py-2 hover:bg-stone-50 flex justify-between gap-3"><span className="text-[13px]">{c.label}</span><span className="text-[12.5px] text-stone-500 num whitespace-nowrap">{money(c.price_ht)} HT</span></button>)}</div>}
      {lines.map((l, i) => (
        <div key={i} className="border border-line rounded-xl bg-white p-2.5">
          <div className="flex gap-2"><div className="text-[13px] font-medium flex-1">{l.label}</div><button type="button" onClick={() => setLines(lines.filter((_, k) => k !== i))} className="text-stone-300 hover:text-rose-600"><Trash2 size={15} /></button></div>
          <div className="grid grid-cols-2 gap-2 mt-2"><Field label="Quantité"><NumInput value={l.qty} onChange={(v) => upd(i, { qty: v })} /></Field><Field label="Prix HT unitaire"><NumInput value={l.unit_price} onChange={(v) => upd(i, { unit_price: v })} /></Field></div>
        </div>))}
      {lines.length > 0 && <div className="text-right text-[13px] text-stone-600">Total TTC : <b className="num">{money(ttc)}</b></div>}
    </div>
  );
}

export default function TeamPortal() {
  const { token } = useParams(); const toast = useToast();
  const [d, setD] = useState(null); const [err, setErr] = useState(false); const [tab, setTab] = useState('missions'); const [catalog, setCatalog] = useState([]); const [busy, setBusy] = useState(false);
  const [addQuote, setAddQuote] = useState(null); const [direct, setDirect] = useState(null); const [qLines, setQLines] = useState([]);
  const load = () => get(`/public/team/${token}`).then(setD).catch(() => setErr(true));
  useEffect(() => { load(); get(`/public/team/${token}/catalog`).then(setCatalog).catch(() => {}); }, [token]); // eslint-disable-line
  const run = async (fn, msg) => { setBusy(true); try { const r = await fn(); await load(); if (msg) toast(msg); return r; } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  if (err) return <div className="min-h-full grid place-items-center p-8 text-stone-500">Ce lien n'est plus valide. Demandez-en un nouveau à SAMLOCK.</div>;
  if (!d) return <div className="min-h-full grid place-items-center"><Loader2 className="animate-spin text-stone-400" /></div>;
  const T = d.totals;

  const presentAndSign = async (q) => { const r = await run(() => post(`/public/team/${token}/quotes/${q.id}/present`)); if (r) { if (!r.has_email) toast("Ajoutez l'e-mail du client pour recevoir le code de signature.", 'err'); window.open(`/signer/quote/${r.sign_token}`, '_blank'); } };
  const pv = async (m) => { const r = await run(() => post(`/public/team/${token}/dossier/${m.id}/pv`, {})); if (r) window.open(`/signer/pv/${r.sign_token}`, '_blank'); };

  return (
    <div className="min-h-full bg-surface pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="flex items-center gap-2.5 mb-4"><BrandMark size={38} /><div><div className="font-semibold leading-tight">{d.company}</div><div className="text-[12.5px] text-stone-500">Espace intervenant · {d.sub.name}</div></div></div>
        <div className="flex gap-1.5 mb-4">{[['missions', 'Interventions', Wrench], ['nouvelle', 'Nouvelle', Plus], ['revenus', 'Revenus', Wallet]].map(([k, l, I]) => <button key={k} onClick={() => setTab(k)} className={cn('flex-1 h-10 rounded-xl text-[13.5px] font-medium inline-flex items-center justify-center gap-1.5 border', tab === k ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-700 border-line')}><I size={15} />{l}</button>)}</div>

        {tab === 'missions' && (d.interventions.length === 0 ? <div className="bg-white border border-line rounded-2xl p-6 text-center text-stone-500">Aucune intervention pour le moment. Créez-en une dans « Nouvelle ».</div> :
          <div className="space-y-3">{d.interventions.map((m) => {
            const signed = m.quotes.some((q) => q.status === 'signe'); const e = m.earnings;
            return (
              <div key={m.id} className="bg-white border border-line rounded-2xl p-4">
                <div className="flex items-start gap-2"><div className="flex-1"><div className="font-semibold">{m.title}</div><div className="text-[13px] text-stone-600">{m.client}</div></div><StageBadge stage={m.stage} /></div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px]">
                  {m.phone && <a className="text-accent inline-flex items-center gap-1" href={`tel:${m.phone}`}><Phone size={13} />{m.phone}</a>}
                  {m.address && <a className="text-accent inline-flex items-center gap-1" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.address)}`}><MapPin size={13} />{m.address}</a>}
                </div>
                {m.quotes.map((q) => <div key={q.id} className="mt-3 flex items-center gap-2 border-t border-line pt-3"><FileSignature size={15} className="text-stone-400" /><div className="flex-1 text-[13px]">{q.number || 'Devis'} · <span className="num">{money(q.ttc)} TTC</span></div><Badge className={QS[q.status]?.[1]}>{QS[q.status]?.[0] || q.status}</Badge>
                  {q.status !== 'signe' && q.status !== 'refuse' && <Btn size="sm" variant="primary" loading={busy} onClick={() => presentAndSign(q)}>Faire signer</Btn>}</div>)}
                <div className="flex flex-wrap gap-2 mt-3">
                  {!signed && <Btn size="sm" icon={Plus} onClick={() => { setQLines([]); setAddQuote(m); }}>Devis</Btn>}
                  {!m.invoices.length && <Btn size="sm" icon={Receipt} onClick={() => { setQLines([]); setDirect(m); }}>Facturer directement</Btn>}
                  {signed && m.pv?.status !== 'signe' && <Btn size="sm" icon={ClipboardCheck} variant="dark" loading={busy} onClick={() => pv(m)}>Terminer · bon d’intervention</Btn>}
                  {m.pv?.status === 'signe' && <Badge className="bg-emerald-50 text-emerald-700">Intervention signée</Badge>}
                </div>
                {m.invoices.length > 0 && <div className="mt-3 text-[12.5px] text-stone-600 space-y-0.5">{m.invoices.map((i, k) => <div key={k} className="flex gap-2"><span className="flex-1">{i.number || 'Facture'} · <span className="num">{money(i.total_ttc)} TTC</span></span><Badge className={IS[i.status]?.[1]}>{IS[i.status]?.[0]}</Badge></div>)}</div>}
                {e && e.revenue_ht > 0 && <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[12px] border-t border-line pt-3"><div><div className="text-stone-400">CA HT</div><div className="num font-medium text-[13px]">{money(e.revenue_ht)}</div></div><div><div className="text-stone-400">Gain réel</div><div className="num font-medium text-[13px]">{money(e.gain)}</div></div><div><div className="text-stone-400">Ma part ({d.commission_pct} %)</div><div className="num font-semibold text-[13px] text-emerald-700">{money(e.share)}</div></div></div>}
              </div>);
          })}</div>)}

        {tab === 'nouvelle' && <NewIntervention catalog={catalog} busy={busy} onCreate={async (b) => { const r = await run(() => post(`/public/team/${token}/interventions`, b), 'Intervention créée'); if (r) { setTab('missions'); } }} />}

        {tab === 'revenus' && (
          <div className="space-y-3">
            <div className="bg-white border border-line rounded-2xl p-4">
              <div className="text-[12px] text-stone-500">Ma part totale ({d.commission_pct} % du gain réel)</div><div className="text-3xl font-semibold num text-emerald-700">{money(T.share)}</div>
              <div className="grid grid-cols-2 gap-3 mt-4 text-[13px]">
                <div><div className="text-stone-400 text-[12px]">Clients ayant payé</div><div className="num font-medium">{money(T.share_paid)}</div></div>
                <div><div className="text-stone-400 text-[12px]">À encaisser (client pas encore payé)</div><div className="num font-medium text-amber-700">{money(T.share_due)}</div></div>
                <div><div className="text-stone-400 text-[12px]">Déjà reversé</div><div className="num font-medium">{money(T.reversed)}</div></div>
                <div><div className="text-stone-400 text-[12px]">Reste à me reverser</div><div className="num font-semibold">{money(T.to_reverse)}</div></div>
              </div>
            </div>
            <div className="text-[12px] text-stone-500 px-1">Gain réel = chiffre d’affaires HT − marchandises. Vous touchez {d.commission_pct} % du gain, SAMLOCK {100 - d.commission_pct} %.</div>
            {d.interventions.filter((m) => m.earnings?.revenue_ht > 0).map((m) => { const e = m.earnings; return (
              <div key={m.id} className="bg-white border border-line rounded-2xl p-4 text-[13px]">
                <div className="font-medium">{m.title}</div><div className="text-stone-500 text-[12.5px]">{m.client}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                  <span className="text-stone-500">CA HT</span><span className="num text-right">{money(e.revenue_ht)}</span>
                  <span className="text-stone-500">Marchandises {e.goods_source === 'estime' ? '(estimées)' : ''}</span><span className="num text-right">− {money(e.goods)}</span>
                  <span className="text-stone-500">Gain réel</span><span className="num text-right font-medium">{money(e.gain)}</span>
                  <span className="text-stone-500">Ma part</span><span className="num text-right font-semibold text-emerald-700">{money(e.share)}</span>
                  <span className="text-stone-500">dont client payé</span><span className="num text-right">{money(e.share_paid)}</span>
                  <span className="text-stone-500">dont à encaisser</span><span className="num text-right text-amber-700">{money(e.share_due)}</span>
                </div></div>); })}
            {d.payouts.length > 0 && <div className="bg-white border border-line rounded-2xl p-4 text-[13px]"><div className="font-medium mb-1">Reversements reçus</div>{d.payouts.map((p) => <div key={p.id} className="flex justify-between py-1 border-t border-line first:border-0"><span>{p.date}{p.note ? ` · ${p.note}` : ''}</span><span className="num">{money(p.amount)}</span></div>)}</div>}
          </div>)}
      </div>

      <Modal open={!!addQuote} onClose={() => setAddQuote(null)} title={`Devis — ${addQuote?.title || ''}`} footer={<><Btn onClick={() => setAddQuote(null)}>Annuler</Btn><Btn variant="primary" loading={busy} onClick={async () => { const r = await run(() => post(`/public/team/${token}/dossier/${addQuote.id}/quote`, { lines: qLines }), 'Devis créé'); if (r) setAddQuote(null); }}>Créer le devis</Btn></>}>
        <LinesPicker catalog={catalog} lines={qLines} setLines={setQLines} />
      </Modal>
      <Modal open={!!direct} onClose={() => setDirect(null)} title={`Facturer — ${direct?.title || ''}`} footer={<><Btn onClick={() => setDirect(null)}>Annuler</Btn><Btn variant="primary" loading={busy} onClick={async () => { const r = await run(() => post(`/public/team/${token}/dossier/${direct.id}/direct-invoice`, { lines: qLines }), 'Facture préparée : SAMLOCK la valide et l’envoie'); if (r) setDirect(null); }}>Préparer la facture</Btn></>}>
        <p className="text-[12.5px] text-stone-500 mb-2">Dépannage réglé sur place : la facture est préparée, SAMLOCK la valide avant envoi.</p>
        <LinesPicker catalog={catalog} lines={qLines} setLines={setQLines} />
      </Modal>
    </div>
  );
}

function NewIntervention({ catalog, busy, onCreate }) {
  const [f, setF] = useState({ name: '', client_type: 'particulier', phone: '', email: '', address: '', postal: '', city: '', title: '', mode: 'devis' }); const [lines, setLines] = useState([]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="bg-white border border-line rounded-2xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nom du client" className="col-span-2"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Type"><Select value={f.client_type} onChange={set('client_type')}><option value="particulier">Particulier</option><option value="professionnel">Professionnel</option></Select></Field>
        <Field label="Téléphone"><Input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="E-mail (code de signature)" className="col-span-2"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Adresse de l’intervention" className="col-span-2"><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="Code postal"><Input inputMode="numeric" value={f.postal} onChange={set('postal')} /></Field><Field label="Ville"><Input value={f.city} onChange={set('city')} /></Field>
        <Field label="Objet" className="col-span-2"><Input placeholder="Ouverture de porte, changement de cylindre…" value={f.title} onChange={set('title')} /></Field>
      </div>
      <div className="flex gap-2">{[['devis', 'Devis à faire signer'], ['direct', 'Facture directe (dépannage)']].map(([k, l]) => <button key={k} type="button" onClick={() => setF({ ...f, mode: k })} className={cn('flex-1 h-9 rounded-lg text-[13px] font-medium border', f.mode === k ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-line text-stone-700')}>{l}</button>)}</div>
      <LinesPicker catalog={catalog} lines={lines} setLines={setLines} />
      <Btn variant="primary" size="lg" className="w-full" loading={busy} onClick={() => onCreate({ ...f, lines })}>Créer l’intervention</Btn>
    </div>
  );
}
