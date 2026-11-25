import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Phone, Mail, MapPin } from 'lucide-react';
import { get, post } from '../lib/api.js';
import { KINDS, dateFr } from '../lib/format.js';
import { Avatar, Btn, Card, Empty, Field, Input, KindBadge, Modal, PageHeader, SearchBox, Select, useFetch, useSort, useToast, cn } from '../lib/ui.jsx';

export default function Contacts() {
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();
  const { data, reload } = useFetch(() => get(`/contacts?kind=${kind}&q=${encodeURIComponent(q)}`), [kind, q]);
  const sort = useSort(data?.rows || [], { name: (c) => c.company || c.name, kind: (c) => c.kind, city: (c) => c.city, source: (c) => c.source, created: (c) => c.created_at }, { key: 'created', dir: 'desc' });
  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div>
      <PageHeader title="Contacts" subtitle="Une seule fiche par personne : coordonnées, devis, factures et historique."
        actions={<Btn variant="primary" icon={Plus} onClick={() => setParams({ new: 1 })}>Nouveau contact</Btn>} />
      <div className="px-8 pb-10">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="chips w-full md:w-auto flex gap-1.5 md:gap-1 md:flex-wrap overflow-x-auto md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0">
            <button onClick={() => setKind('all')} className={cn('shrink-0 whitespace-nowrap px-3.5 md:px-3 h-8 rounded-full md:rounded-lg text-[13px] font-medium border md:border-transparent', kind === 'all' ? 'bg-stone-900 text-white border-stone-900' : 'text-stone-600 bg-white md:bg-transparent border-line hover:bg-stone-100')}>Tous <span className="opacity-60 ml-1 num">{total}</span></button>
            {Object.entries(KINDS).map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={cn('shrink-0 whitespace-nowrap px-3.5 md:px-3 h-8 rounded-full md:rounded-lg text-[13px] font-medium border md:border-transparent', kind === k ? 'bg-stone-900 text-white border-stone-900' : 'text-stone-600 bg-white md:bg-transparent border-line hover:bg-stone-100')}>{l} <span className="opacity-60 ml-1 num">{counts[k] || 0}</span></button>)}
          </div>
          <SearchBox className="ml-auto" value={q} onChange={setQ} placeholder="Nom, téléphone, e-mail, ville…" />
        </div>
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead><tr className="text-left text-[11.5px] text-stone-400 border-b border-line">{sort.th('name', 'Nom', { className: 'px-4 py-2.5' })}{sort.th('kind', 'Rubrique')}<th className="uppercase tracking-wide">Contact</th>{sort.th('city', 'Ville')}{sort.th('source', 'Source', { className: 'pr-4' })}{sort.th('created', 'Créé le', { className: 'pr-4' })}</tr></thead>
            <tbody>
              {sort.rows.map((c) => (
                <tr key={c.id} className="border-b border-line/70 hover:bg-stone-50">
                  <td className="px-4 py-2.5"><Link to={`/contacts/${c.id}`} className="flex items-center gap-2.5"><Avatar name={c.name} /><span><span className="font-medium block leading-tight">{c.company || c.name}</span>{c.company && <span className="text-stone-400 text-[12px]">{c.name}{c.trade ? ` · ${c.trade}` : ''}</span>}</span></Link></td>
                  <td><KindBadge kind={c.kind} /></td>
                  <td className="text-stone-600"><div className="flex flex-col gap-0.5 text-[12.5px]">{c.phone && <span className="flex items-center gap-1.5"><Phone size={11} className="text-stone-400" />{c.phone}</span>}{c.email && <span className="flex items-center gap-1.5"><Mail size={11} className="text-stone-400" />{c.email}</span>}</div></td>
                  <td className="text-stone-600">{c.city}</td><td className="text-stone-500 text-[12.5px]">{c.source}</td><td className="pr-4 text-stone-400 text-[12.5px] num">{dateFr(c.created_at)}</td>
                </tr>))}
            </tbody>
          </table>
          {data?.rows.length === 0 && <Empty title="Aucun contact">Modifiez la recherche ou créez une fiche.</Empty>}
        </Card>
      </div>
      <NewContact open={params.get('new') === '1'} onClose={() => setParams({})} onDone={() => { setParams({}); reload(); }} />
    </div>
  );
}

export function NewContact({ open, onClose, onDone, initialKind = 'prospect' }) {
  const empty = { kind: initialKind, name: '', company: '', phone: '', email: '', address: '', postal: '', city: '', source: '', trade: '' };
  const [f, setF] = useState(empty); const [busy, setBusy] = useState(false); const toast = useToast(); const nav = useNavigate();
  useEffect(() => { if (open) setF(empty); }, [open]); // eslint-disable-line
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { setBusy(true); try { const c = await post('/contacts', f); toast('Fiche créée'); onDone?.(c); nav(`/contacts/${c.id}`); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return (
    <Modal open={open} onClose={onClose} title="Nouveau contact" width={600} footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save}>Créer la fiche</Btn></>}>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Rubrique"><Select value={f.kind} onChange={set('kind')}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l.replace(/s$/, '')}</option>)}</Select></Field>
        {['client', 'prospect'].includes(f.kind) && <Field label="Type de client"><Select value={f.client_type || 'particulier'} onChange={set('client_type')}><option value="particulier">Particulier (TVA 10 %)</option><option value="professionnel">Professionnel (TVA 20 %)</option></Select></Field>}
        <Field label="Source"><Select value={f.source} onChange={set('source')}><option value="">—</option>{['Site – formulaire', 'Recommandation', 'Téléphone', 'Apporteur', 'Réseaux sociaux', 'Autre'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Nom *"><Input autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Société"><Input value={f.company} onChange={set('company')} /></Field>
        <Field label="Téléphone"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Adresse" className="col-span-2"><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="Code postal"><Input value={f.postal} onChange={set('postal')} /></Field><Field label="Ville"><Input value={f.city} onChange={set('city')} /></Field>
        {f.kind === 'sous_traitant' && <Field label="Métier" className="col-span-2"><Input value={f.trade} onChange={set('trade')} placeholder="Plomberie, électricité…" /></Field>}
      </div>
    </Modal>
  );
}
