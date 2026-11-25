import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Expenses from './Expenses.jsx';
import Billing from './Billing.jsx';
import { Wallet, Camera, FileText, Upload, Trash2, HardHat, Users, Receipt, ClipboardCheck, Play, Send, CheckCircle2, AlertTriangle, MapPin, ChevronLeft, FileDown, Plus, ShieldCheck, Clock } from 'lucide-react';
import { get, post, put, del, api } from '../lib/api.js';
import { Btn, Card, Empty, Field, Input, MarginPill, Modal, PageHeader, StageBadge, Select, Textarea, NumInput, Badge, useFetch, useToast, cn } from '../lib/ui.jsx';
import { money, money0, dateFr } from '../lib/format.js';
import { InvBadge, KIND_INV } from './Invoices.jsx';

const TABS = [['apercu', 'Vue d\'ensemble', HardHat], ['photos', 'Photos & documents', Camera], ['st', 'Sous-traitants', Users], ['dep', 'Dépenses', Wallet], ['fact', 'Facturation', Receipt]];

export default function InterventionDetail() {
  const { id } = useParams(); const toast = useToast();
  const { data: d, reload } = useFetch(() => get(`/interventions/${id}`), [id]);
  const [tab, setTab] = useState(new URLSearchParams(window.location.search).get('tab') || 'apercu');
  if (!d) return null;
  const { project: p, contact: c, planned: pl } = d;
  const act = async (fn, ok) => { try { await fn(); await reload(); ok && toast(ok); } catch (e) { toast(e.message, 'err'); } };
  const pendingValidations = d.invoices.filter((i) => i.status === 'brouillon').length;

  return (
    <div>
      <div className="px-8 pt-5"><Link to="/interventions" className="inline-flex items-center gap-1 text-[12.5px] text-stone-500 hover:text-stone-800"><ChevronLeft size={14} />Interventions</Link></div>
      <PageHeader title={p.title} subtitle={<span className="flex items-center gap-3 flex-wrap"><StageBadge stage={p.stage} /><Link to={`/contacts/${c.id}`} className="hover:text-accent">{c.company || c.name}</Link>{p.address && <span className="flex items-center gap-1"><MapPin size={13} />{p.address}, {p.city}</span>}</span>}
        actions={p.stage === 'devis_valide' && <Btn variant="primary" icon={Play} onClick={() => act(() => post(`/interventions/${id}/start`, {}), 'Intervention démarrée')}>Démarrer l’intervention</Btn>}
        tabs={<div className="flex gap-1 mt-5 border-b border-line -mb-4 overflow-x-auto">{TABS.map(([k, l, I]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('flex items-center gap-1.5 px-3 h-9 text-[13.5px] font-medium border-b-2 -mb-px shrink-0 whitespace-nowrap', tab === k ? 'border-accent text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800')}><I size={14} />{l}
            {k === 'fact' && pendingValidations > 0 && <span className="bg-accent text-white text-[10.5px] rounded-full px-1.5">{pendingValidations}</span>}</button>))}</div>} />
      <div className="px-8 pb-12 pt-8">
        {tab === 'apercu' && <Overview d={d} reload={reload} act={act} />}
        {tab === 'photos' && <Photos d={d} id={id} reload={reload} />}
        {tab === 'st' && <Subs d={d} id={id} reload={reload} act={act} />}
        {tab === 'dep' && <Expenses d={d} id={id} reload={reload} />}
        {tab === 'fact' && <Billing d={d} id={id} reload={reload} act={act} />}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Intervenant (sous-traitant avec espace personnel) */
function ProjectSub({ p }) {
  const toast = useToast(); const { data } = useFetch(() => get('/subcontractors')); const [v, setV] = useState(p.sub_id || '');
  if (!data || !data.rows.length) return null;
  return (
    <Card className="p-4 flex flex-wrap items-center gap-3">
      <div className="text-[13px] font-medium">Intervenant</div>
      <Select className="max-w-xs" value={v} onChange={async (e) => { const n = e.target.value; setV(n); try { await put(`/interventions/${p.id}/sub`, { sub_id: n || null }); toast(n ? 'Intervention attribuée : elle apparaît dans son espace' : 'Attribution retirée'); } catch (er) { toast(er.message, 'err'); } }}>
        <option value="">Aucun (SAMLOCK)</option>{data.rows.map((s) => <option key={s.id} value={s.id}>{s.company || s.name}</option>)}
      </Select>
      <div className="text-[12px] text-stone-400">Partage du gain réel appliqué selon sa commission.</div>
    </Card>
  );
}

/* ----------------------------------------------------------------- Vue d'ensemble */
function Overview({ d, act }) {
  const { project: p, planned: pl, quotes, invoices } = d; const info = p.info || {};
  const [f, setF] = useState(info); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const paid = invoices.filter((i) => i.status === 'payee').reduce((a, i) => a + i.total_ttc, 0);
  const st = d.assignments.reduce((a, s) => a + s.total, 0);
  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <ProjectSub p={p} />
        <Card className="p-5">
          <h3 className="font-semibold mb-3">Rentabilité prévue <span className="text-stone-400 font-normal text-[12.5px]">(devis signés + avenants)</span></h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[['Vente HT', money0(pl.ht)], ['Coût total', money0(pl.cost)], ['Marge brute', money0(pl.profit)]].map(([l, v]) => <div key={l}><div className="text-[12px] text-stone-500">{l}</div><div className="text-xl font-semibold num">{v}</div></div>)}
            <div><div className="text-[12px] text-stone-500">Taux de marge</div><div className="mt-1.5"><MarginPill value={pl.margin} /></div></div>
          </div>
          <div className="mt-4 pt-4 border-t border-line grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
            <div><div className="text-stone-500">Sous-traitance engagée</div><div className="font-semibold num">{money0(st)} <span className="text-stone-400 font-normal">/ {money0(pl.sub_cost)} prévus</span></div></div>
            <div><div className="text-stone-500">Dépenses réelles HT</div><div className="font-semibold num">{d.actual?.total_ht > 0 ? money0(d.actual.total_ht) : '—'}</div></div>
            <div><div className="text-stone-500">Encaissé TTC</div><div className="font-semibold num text-emerald-700">{money0(paid)}</div></div>
            <div><div className="text-stone-500">Reste à facturer</div><div className="font-semibold num">{money0(Math.max(0, pl.ht * 1.1 - invoices.reduce((a, i) => a + i.total_ttc, 0)))}</div></div>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold mb-3">Documents contractuels</h3>
          <div className="divide-y divide-line">{quotes.map((q) => (
            <Link key={q.id} to={`/devis/${q.id}`} className="flex items-center gap-3 py-2.5 hover:text-accent">
              <FileText size={16} className="text-stone-400" /><span className="font-medium">{q.kind === 'avenant' ? 'Avenant' : 'Devis'} {q.number || 'brouillon'}</span>
              <Badge className={q.status === 'signe' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600'}>{q.status === 'signe' ? 'Signé ' + dateFr(q.signed_at) : q.status}</Badge>
              <span className="ml-auto num">{money(q.totals.ttc)} TTC</span></Link>))}</div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold mb-3">Journal de l’intervention</h3>
          {d.activities.length === 0 ? <div className="text-stone-400">Rien pour le moment.</div> : <ul className="space-y-2.5">{d.activities.slice(0, 12).map((a) => <li key={a.id} className="flex gap-3 text-[13px]"><Clock size={13} className="text-stone-300 mt-1 shrink-0" /><span>{a.text}</span><span className="ml-auto text-stone-400 text-[12px] whitespace-nowrap">{dateFr(a.created_at)}</span></li>)}</ul>}
        </Card>
      </div>
      <Card className="p-5 h-fit">
        <h3 className="font-semibold mb-1">Infos intervention</h3><p className="text-[12.5px] text-stone-500 mb-4">Transmises aux sous-traitants avec leur ordre de mission.</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Field label="Début"><Input type="date" value={f.start_date || ''} onChange={(e) => set('start_date', e.target.value)} /></Field><Field label="Fin prévue"><Input type="date" value={f.end_date || ''} onChange={(e) => set('end_date', e.target.value)} /></Field></div>
          <Field label="Code / accès"><Input value={f.access_code || ''} onChange={(e) => set('access_code', e.target.value)} placeholder="Digicode, clés, gardien…" /></Field>
          <Field label="Étage"><Input value={f.floor || ''} onChange={(e) => set('floor', e.target.value)} placeholder="3e, ascenseur" /></Field>
          <Field label="Stationnement"><Input value={f.parking || ''} onChange={(e) => set('parking', e.target.value)} /></Field>
          <Field label="Contraintes"><Textarea rows={3} value={f.constraints || ''} onChange={(e) => set('constraints', e.target.value)} placeholder="Horaires, copropriété, voisinage…" /></Field>
          <Btn className="w-full" onClick={() => act(() => put(`/interventions/${p.id}/info`, f), 'Infos enregistrées')}>Enregistrer</Btn>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- Photos */
const TAGS = { avant: 'Avant', pendant: 'Pendant', apres: 'Après' };
function Photos({ d, id, reload }) {
  const toast = useToast(); const ref = useRef(); const [tag, setTag] = useState('avant'); const [room, setRoom] = useState(''); const [busy, setBusy] = useState(false); const [view, setView] = useState(null); const [filter, setFilter] = useState('all');
  const upload = async (files) => {
    if (!files.length) return; setBusy(true);
    const fd = new FormData(); [...files].forEach((f) => fd.append('files', f)); fd.append('tag', tag); fd.append('room', room);
    try { await api(`/interventions/${id}/files`, { method: 'POST', form: fd }); await reload(); toast(`${files.length} fichier(s) ajouté(s)`); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const photos = d.files.filter((f) => f.kind === 'photo' && (filter === 'all' || f.tag === filter)); const docs = d.files.filter((f) => f.kind !== 'photo');
  const auth = d.quotes.some((q) => q.photo_auth);
  return (
    <div className="space-y-6">
      <Card className="p-4 flex flex-wrap items-center gap-3" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
        <Select value={tag} onChange={(e) => setTag(e.target.value)} className="w-32">{Object.entries(TAGS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Pièce (cuisine, SDB…)" className="w-52" />
        <input ref={ref} type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        <Btn variant="primary" icon={Upload} loading={busy} onClick={() => ref.current.click()}>Ajouter photos / fichiers</Btn>
        <span className="text-[12.5px] text-stone-400">ou glissez-déposez ici — sur mobile, ouvre directement l'appareil photo.</span>
        <div className="ml-auto flex items-center gap-1.5 text-[12.5px]">{auth ? <Badge className="bg-emerald-50 text-emerald-700"><ShieldCheck size={12} />Client : publication autorisée</Badge> : <Badge className="bg-stone-100 text-stone-500">Publication non autorisée</Badge>}</div>
      </Card>
      <div className="flex gap-1.5">{[['all', 'Toutes'], ...Object.entries(TAGS)].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={cn('px-3 h-7 rounded-full text-[12.5px] border', filter === k ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-line text-stone-600')}>{l}</button>)}</div>
      {photos.length === 0 ? <Card><Empty icon={Camera} title="Aucune photo">Les photos « avant » sont jointes aux ordres de mission des sous-traitants.</Empty></Card> :
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">{photos.map((f) => (
          <button key={f.id} onClick={() => setView(f)} className="group relative aspect-square rounded-xl overflow-hidden border border-line bg-stone-100">
            <img src={`/api/files/${f.id}/raw`} alt="" className="w-full h-full object-cover group-hover:scale-105 transition" />
            <span className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-[11px] rounded px-1.5 py-0.5">{TAGS[f.tag]}{f.room ? ` · ${f.room}` : ''}</span></button>))}</div>}
      <Card className="p-5"><h3 className="font-semibold mb-3">Documents</h3>
        {docs.length === 0 ? <div className="text-stone-400 text-[13px]">Aucun document (plans, attestations, bons de livraison…).</div> : <div className="divide-y divide-line">{docs.map((f) => <div key={f.id} className="flex items-center gap-3 py-2"><FileText size={16} className="text-stone-400" /><a className="font-medium hover:text-accent" href={`/api/files/${f.id}/raw`} target="_blank" rel="noreferrer">{f.orig_name}</a><span className="text-stone-400 text-[12px] ml-auto">{dateFr(f.created_at)}</span><button className="text-stone-300 hover:text-rose-600" onClick={async () => { await del(`/files/${f.id}`); reload(); }}><Trash2 size={14} /></button></div>)}</div>}
      </Card>
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${TAGS[view.tag]}${view.room ? ' · ' + view.room : ''}` : ''} width={860}
        footer={view && <><Btn variant="danger" icon={Trash2} onClick={async () => { await del(`/files/${view.id}`); setView(null); reload(); }}>Supprimer</Btn><Btn onClick={() => setView(null)}>Fermer</Btn></>}>
        {view && <img src={`/api/files/${view.id}/raw`} alt="" className="w-full rounded-lg" />}
      </Modal>
    </div>
  );
}

/* ----------------------------------------------------------------- Sous-traitants */
const ASSIGN = { a_envoyer: ['À valider', 'bg-stone-100 text-stone-700'], envoye: ['Envoyé', 'bg-amber-50 text-amber-800'], accepte: ['Accepté', 'bg-emerald-50 text-emerald-700'], refuse: ['Refusé', 'bg-rose-50 text-rose-700'] };
function Subs({ d, id, reload, act }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center"><p className="text-stone-500 max-w-xl">Chaque ordre de mission est préparé ici puis validé dans la file d'envoi. Le sous-traitant voit l’adresse, l’accès et la prestation, jamais vos prix de vente.</p><Btn variant="primary" icon={Plus} className="ml-auto" onClick={() => setOpen(true)}>Nouvel ordre de mission</Btn></div>
      {d.assignments.length === 0 ? <Card><Empty icon={Users} title="Aucun sous-traitant affecté" /></Card> : d.assignments.map((a) => (
        <Card key={a.id} className="p-5">
          <div className="flex items-center gap-3"><div className="font-semibold">{a.contact_company || a.contact_name}</div><span className="text-stone-400 text-[12.5px]">{a.trade}</span><Badge className={ASSIGN[a.status][1]}>{ASSIGN[a.status][0]}</Badge>
            <div className="ml-auto flex items-center gap-3"><span className="num font-semibold">{money(a.total)} HT</span><a href={`/api/assignments/${a.id}/pdf`} target="_blank" rel="noreferrer" className="text-stone-400 hover:text-accent"><FileDown size={16} /></a>
              {a.status !== 'accepte' && <button className="text-stone-300 hover:text-rose-600" onClick={() => act(() => del(`/assignments/${a.id}`))}><Trash2 size={15} /></button>}</div></div>
          <ul className="mt-3 text-[13px] text-stone-600 space-y-1">{a.items.map((i, k) => <li key={k} className="flex justify-between"><span>• {i.label}</span><span className="num text-stone-400">{money(i.amount)}</span></li>)}</ul>
          {a.status === 'accepte' && <div className="mt-3 text-[12.5px] text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} />Accepté par {a.accepted_by} le {dateFr(a.accepted_at)}</div>}
          {a.status === 'accepte' && <div className="mt-1 text-[12.5px] flex items-center gap-1.5 text-stone-500">{a.paid_at ? <>Réglé le {dateFr(a.paid_at)} — {money(a.paid_amount)} HT</> : a.done_at ? <span className="text-amber-700">Mission terminée le {dateFr(a.done_at)} — à régler (rubrique Sous-traitants)</span> : 'En cours'}</div>}
        </Card>))}
      <AssignModal open={open} onClose={() => setOpen(false)} d={d} id={id} onDone={() => { setOpen(false); reload(); }} />
    </div>
  );
}
function AssignModal({ open, onClose, d, id, onDone }) {
  const toast = useToast(); const [sub, setSub] = useState(''); const [sel, setSel] = useState({}); const [msg, setMsg] = useState(''); const [dates, setDates] = useState({}); const [busy, setBusy] = useState(false);
  const s = d.subs.find((x) => String(x.id) === sub);
  const lines = d.signed_lines;
  const toggle = (l) => setSel((x) => { const n = { ...x }; if (n[l.id] != null) delete n[l.id]; else n[l.id] = l.cost_sub ? l.cost_sub * l.qty : 0; return n; });
  const submit = async () => {
    setBusy(true);
    try {
      const items = lines.filter((l) => sel[l.id] != null).map((l) => ({ line_id: l.id, label: l.label, description: l.description, qty: l.qty, unit: l.unit, amount: sel[l.id] }));
      await post(`/interventions/${id}/assignments`, { contact_id: Number(sub), items, message: msg, start_date: dates.s, end_date: dates.e });
      toast('Ordre de mission prêt — à valider dans la file d\'envoi'); setSel({}); setMsg(''); onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Ordre de mission" width={640} footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" loading={busy} disabled={!sub || !Object.keys(sel).length || (s && !s.ok)} onClick={submit}>Préparer l'envoi</Btn></>}>
      <div className="space-y-4">
        <Field label="Sous-traitant"><Select value={sub} onChange={(e) => setSub(e.target.value)}><option value="">Choisir…</option>{d.subs.map((x) => <option key={x.id} value={x.id}>{x.company || x.name} — {x.trade}{x.ok ? '' : ' (attestations invalides)'}</option>)}</Select></Field>
        {s && !s.ok && <div className="flex gap-2 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3"><AlertTriangle size={16} className="shrink-0 mt-0.5" />Assurance RC pro ou attestation de vigilance expirée : affectation bloquée tant que les documents ne sont pas à jour.</div>}
        <div><div className="text-[12px] font-medium text-stone-600 mb-1.5">Prestations confiées (lignes des devis signés) · montant HT convenu</div>
          <div className="border border-line rounded-xl divide-y divide-line max-h-64 overflow-auto">{lines.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-3 py-2 text-[13px]"><input type="checkbox" className="accent-orange-700" checked={sel[l.id] != null} onChange={() => toggle(l)} />
              <div className="flex-1 min-w-0"><div className="truncate font-medium">{l.label}</div><div className="text-stone-400 text-[11.5px]">{l.section_title} · {l.qty} {l.unit}</div></div>
              {sel[l.id] != null && <NumInput value={sel[l.id]} onChange={(v) => setSel((x) => ({ ...x, [l.id]: v }))} className="w-24 h-8 rounded-md border border-stone-300 px-2 text-right num" />}</div>))}</div></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Début"><Input type="date" onChange={(e) => setDates((x) => ({ ...x, s: e.target.value }))} /></Field><Field label="Fin"><Input type="date" onChange={(e) => setDates((x) => ({ ...x, e: e.target.value }))} /></Field></div>
        <Field label="Message (optionnel)"><Textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
