import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, LayoutGrid, List, MapPin, FileText } from 'lucide-react';
import { get, post, put } from '../lib/api.js';
import { STAGES, STAGE, money0, ago } from '../lib/format.js';
import { Btn, PageHeader, useFetch, cn, Avatar, MarginPill, Modal, Field, Input, Select, StageBadge, useToast, Card, SearchBox, matches, useSort } from '../lib/ui.jsx';

export default function Pipeline() {
  const { data, reload, setData } = useFetch(() => get('/projects'));
  const [mode, setMode] = useState('board');
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const [q, setQ] = useState('');
  const shown = useMemo(() => (data?.rows || []).filter((p) => matches(p, q, (x) => `${x.contact_name} ${x.contact_company} ${x.title} ${x.city} ${x.address} ${x.quote?.number || ''}`)), [data, q]);
  const cols = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, shown.filter((p) => p.stage === s)])), [shown]);
  const sort = useSort(shown, { client: (p) => p.contact_company || p.contact_name, title: (p) => p.title, stage: (p) => STAGES.indexOf(p.stage), ht: (p) => p.quote?.ht, margin: (p) => p.quote?.margin_pct, updated: (p) => p.updated_at }, { key: 'updated', dir: 'desc' });

  const move = async (id, stage) => {
    const p = data.rows.find((x) => x.id === id); if (!p || p.stage === stage) return;
    setData({ ...data, rows: data.rows.map((x) => (x.id === id ? { ...x, stage } : x)) });
    try { await put(`/projects/${id}`, { stage }); toast(`${p.contact_name} → ${STAGE[stage].label}`); } catch (e) { toast(e.message, 'err'); reload(); }
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Pipeline" subtitle="De la demande au intervention terminée. Les étapes avancent d'elles-mêmes à l'envoi et à la signature des devis."
        actions={<>
          <SearchBox className="!w-60" value={q} onChange={setQ} placeholder="Client, intervention, ville…" />
          <div className="flex rounded-lg border border-stone-300 bg-white p-0.5">
            <button onClick={() => setMode('board')} className={cn('px-2.5 h-7 rounded-md flex items-center gap-1.5 text-[12.5px]', mode === 'board' && 'bg-stone-900 text-white')}><LayoutGrid size={13} /> Colonnes</button>
            <button onClick={() => setMode('list')} className={cn('px-2.5 h-7 rounded-md flex items-center gap-1.5 text-[12.5px]', mode === 'list' && 'bg-stone-900 text-white')}><List size={13} /> Liste</button>
          </div>
          <Btn variant="primary" icon={Plus} onClick={() => setOpen(true)}>Nouvelle intervention</Btn>
        </>} />
      {!data ? <div className="p-10 text-stone-400">Chargement…</div> : mode === 'board' ? (
        <div className="flex-1 min-h-0 overflow-x-auto px-8 pb-6 scroll-thin">
          <div className="flex gap-3.5 h-full min-w-max">
            {STAGES.map((s) => {
              const total = cols[s].reduce((a, p) => a + (p.quote?.ht || 0), 0);
              return (
                <div key={s} className={cn('w-[272px] flex flex-col rounded-xl bg-stone-100/70 transition-colors', over === s && 'bg-orange-100/60 ring-2 ring-orange-300')}
                  onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver((o) => (o === s ? null : o))}
                  onDrop={() => { move(drag, s); setDrag(null); setOver(null); }}>
                  <div className="px-3 pt-3 pb-2 flex items-center gap-2">
                    <i className={cn('w-2 h-2 rounded-full', STAGE[s].dot)} /><span className="font-semibold text-[13px]">{STAGE[s].label}</span>
                    <span className="text-stone-400 text-[12px] num">{cols[s].length}</span>
                    <span className="ml-auto num text-[12px] text-stone-500">{total ? money0(total) : ''}</span>
                  </div>
                  <div className="flex-1 overflow-auto px-2 pb-2 space-y-2 scroll-thin">
                    {cols[s].map((p) => (
                      <Link key={p.id} to={['devis_valide','intervention_en_cours','intervention_terminee'].includes(p.stage) ? `/interventions/${p.id}` : `/contacts/${p.contact_id}`} draggable onDragStart={() => setDrag(p.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
                        className={cn('block bg-white rounded-lg border border-line p-3 hover:border-stone-300 hover:shadow-sm cursor-grab active:cursor-grabbing transition', drag === p.id && 'opacity-40')}>
                        <div className="flex items-center gap-2"><Avatar name={p.contact_name} size={22} /><span className="font-medium truncate">{p.contact_company || p.contact_name}</span></div>
                        <div className="text-stone-600 mt-1.5 leading-snug line-clamp-2">{p.title}</div>
                        <div className="text-stone-400 text-[12px] flex items-center gap-1 mt-2 truncate"><MapPin size={11} />{p.city || '—'}</div>
                        <div className="flex items-center justify-between mt-1.5 pt-2 border-t border-line/70 min-h-[30px]">
                          {p.quote ? <><span className="num font-semibold text-[14px]">{money0(p.quote.ht)} <span className="text-stone-400 font-normal text-[11px]">HT</span></span><MarginPill value={p.quote.margin_pct} /></> : <span className="text-stone-300 text-[12px]">Pas encore de devis</span>}
                        </div>
                      </Link>
                    ))}
                    {cols[s].length === 0 && <div className="text-center text-stone-300 text-[12px] py-6">Déposez une carte ici</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-8 pb-10">
          <Card className="overflow-hidden">
            <table className="w-full">
              <thead><tr className="text-left text-[11.5px] text-stone-400 border-b border-line">{sort.th('client', 'Client', { className: 'px-4 py-2.5' })}{sort.th('title', 'Intervention')}{sort.th('stage', 'Étape')}{sort.th('ht', 'Devis HT', { right: true, className: 'text-right' })}{sort.th('margin', 'Marge', { right: true, className: 'text-right' })}{sort.th('updated', 'Mis à jour', { right: true, className: 'pr-4 text-right' })}</tr></thead>
              <tbody>{sort.rows.map((p) => (
                <tr key={p.id} className="border-b border-line/70 hover:bg-stone-50">
                  <td className="px-4 py-2.5"><Link to={`/contacts/${p.contact_id}`} className="flex items-center gap-2 font-medium"><Avatar name={p.contact_name} size={22} />{p.contact_company || p.contact_name}</Link></td>
                  <td className="text-stone-600">{p.title}</td><td><StageBadge stage={p.stage} /></td>
                  <td className="text-right num font-medium">{p.quote ? money0(p.quote.ht) : '—'}</td><td className="text-right"><MarginPill value={p.quote?.margin_pct} /></td>
                  <td className="pr-4 text-right text-stone-400 text-[12.5px]">{ago(p.updated_at)}</td>
                </tr>))}</tbody>
            </table>
          </Card>
        </div>
      )}
      <NewProject open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />
    </div>
  );
}

export function NewProject({ open, onClose, onDone, contactId }) {
  const { data } = useFetch(() => get('/contacts'), [open]);
  const [f, setF] = useState({ contact_id: contactId || '', title: '', city: '', address: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setBusy(true);
    try { const c = data?.rows.find((x) => x.id === Number(f.contact_id)); await post('/projects', { ...f, contact_id: Number(f.contact_id), city: f.city || c?.city, address: f.address || c?.address }); toast('Demande créée'); onDone(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Nouvelle intervention" footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" loading={busy} disabled={!f.title || !(contactId || f.contact_id)} onClick={submit}>Créer</Btn></>}>
      <div className="space-y-3.5">
        {!contactId && <Field label="Contact"><Select value={f.contact_id} onChange={set('contact_id')}><option value="">Choisir…</option>{data?.rows.filter((c) => ['prospect', 'client'].includes(c.kind)).map((c) => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}</Select></Field>}
        <Field label="Intitulé"><Input autoFocus value={f.title} onChange={set('title')} placeholder="Ex. Porte claquée, changement de serrure…" /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Adresse de l’intervention"><Input value={f.address} onChange={set('address')} placeholder="Par défaut : celle du contact" /></Field><Field label="Ville"><Input value={f.city} onChange={set('city')} /></Field></div>
      </div>
    </Modal>
  );
}
