import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus, Trash2, Users } from 'lucide-react';
import { del, get, post, put } from '../lib/api.js';
import { ask, Btn, Card, Empty, Field, Input, Modal, NumInput, PageHeader, Select, Textarea, useFetch, useToast, cn } from '../lib/ui.jsx';
import { money } from '../lib/format.js';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => new Date(`${s}T12:00:00`);
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const monday = (s) => { const d = parse(s); const k = (d.getDay() + 6) % 7; return addDays(s, -k); };
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const h = (n) => `${String(n).replace('.', ',')} h`;
const dayLabel = (s) => parse(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export default function Planning() {
  const toast = useToast(); const today = ymd(new Date());
  const [tab, setTab] = useState('semaine'); const [start, setStart] = useState(monday(today));
  const end = addDays(start, 6); const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const plan = useFetch(() => get(`/planning?from=${start}&to=${end}`), [start]);
  const sheets = useFetch(() => get(`/timesheets?from=${start}&to=${end}`), [start]);
  const projects = useFetch(() => get('/interventions'), []);
  const [ev, setEv] = useState(null); const [team, setTeam] = useState(false);
  const workers = plan.data?.workers || []; const prj = Array.isArray(projects.data) ? projects.data : projects.data?.rows || [];
  const reload = () => { plan.reload(); sheets.reload(); };
  const range = `${dayLabel(start)} – ${dayLabel(end)} ${parse(end).getFullYear()}`;

  return (
    <div className="pb-24">
      <PageHeader title="Planning" subtitle="Interventions de l'équipe et pointage des heures par intervention."
        actions={<><Btn icon={Users} onClick={() => setTeam(true)}>Équipe</Btn><Btn variant="primary" icon={Plus} onClick={() => setEv({ title: '', date: today, end_date: '', start_time: '', end_time: '', project_id: '', worker_id: '', note: '' })}>Intervention</Btn></>} />
      <div className="px-4 md:px-8 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
            {[['semaine', 'Semaine', CalendarDays], ['pointage', 'Pointage', Clock]].map(([k, l, I]) => (
              <button key={k} onClick={() => setTab(k)} className={cn('h-8 px-3 rounded-md text-[13px] font-medium inline-flex items-center gap-1.5', tab === k ? 'bg-accent text-white' : 'text-stone-600 hover:bg-stone-100')}><I size={14} />{l}</button>))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Btn size="sm" icon={ChevronLeft} onClick={() => setStart(addDays(start, -7))} aria-label="Semaine précédente" />
            <Btn size="sm" onClick={() => setStart(monday(today))}>Aujourd'hui</Btn>
            <Btn size="sm" icon={ChevronRight} onClick={() => setStart(addDays(start, 7))} aria-label="Semaine suivante" />
            <span className="text-[13.5px] font-medium ml-2 num">{range}</span>
          </div>
        </div>
        {tab === 'semaine'
          ? <Week days={days} today={today} data={plan.data} onAdd={(d) => setEv({ title: '', date: d, end_date: '', start_time: '', end_time: '', project_id: '', worker_id: '', note: '' })} onEdit={(e) => setEv({ ...e, end_date: e.end_date || '', start_time: e.start_time || '', end_time: e.end_time || '', project_id: e.project_id || '', worker_id: e.worker_id || '', note: e.note || '' })} />
          : <Sheets days={days} workers={workers} projects={prj} data={sheets.data} reload={reload} toast={toast} today={today} />}
      </div>
      {ev && <EventModal ev={ev} setEv={setEv} workers={workers} projects={prj} reload={reload} toast={toast} />}
      {team && <TeamModal onClose={() => { setTeam(false); reload(); }} toast={toast} />}
    </div>
  );
}

function Week({ days, today, data, onAdd, onEdit }) {
  if (!data) return null;
  const total = data.events.length + data.subs.length;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
        {days.map((d, i) => {
          const evs = data.events.filter((e) => e.date <= d && (e.end_date || e.date) >= d);
          const subs = data.subs.filter((s) => s.date <= d && (s.end_date || s.date) >= d);
          return (
            <Card key={d} className={cn('p-2.5 min-h-[120px] md:min-h-[220px] flex flex-col', d === today && 'ring-2 ring-accent/60', i >= 5 && 'bg-stone-50')}>
              <div className="flex items-center mb-2"><span className={cn('text-[12px] font-semibold', d === today ? 'text-accent' : 'text-stone-500')}>{DAYS[i]} <span className="num">{parse(d).getDate()}</span></span>
                <button onClick={() => onAdd(d)} className="ml-auto text-stone-300 hover:text-accent" aria-label="Ajouter"><Plus size={15} /></button></div>
              <div className="space-y-1.5">
                {evs.map((e) => (
                  <button key={e.id} onClick={() => onEdit(e)} className="w-full text-left rounded-md border border-line bg-white hover:border-stone-300 pl-2 pr-1.5 py-1.5 text-[12.5px] leading-tight" style={{ borderLeft: `3px solid ${e.worker_color || '#a8a29e'}` }}>
                    <div className="font-medium">{e.title}</div>
                    {e.project_title && <div className="text-stone-500 truncate">{e.project_title}</div>}
                    <div className="text-stone-400 num">{[e.start_time && `${e.start_time}${e.end_time ? '–' + e.end_time : ''}`, e.worker_name].filter(Boolean).join(' · ')}</div>
                  </button>))}
                {subs.map((s) => (
                  <div key={'s' + s.id} className="rounded-md border border-dashed border-stone-300 px-2 py-1.5 text-[12.5px] leading-tight text-stone-600">
                    <div className="font-medium">{s.sub_company || s.sub_name}</div><div className="truncate">{s.trade || 'Sous-traitant'} · {s.project_title}</div></div>))}
              </div>
            </Card>);
        })}
      </div>
      {total === 0 && <Card><Empty icon={CalendarDays} title="Semaine libre">Ajoutez une intervention pour planifier votre équipe. Les ordres de mission des sous-traitants datés apparaissent ici automatiquement.</Empty></Card>}
    </>
  );
}

function Sheets({ days, workers, projects, data, reload, toast, today }) {
  const [f, setF] = useState({ worker_id: '', project_id: '', date: today, hours: 8, note: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF((x) => ({ ...x, date: days.includes(today) ? today : days[0] })); }, [days[0]]); // eslint-disable-line
  if (!data) return null;
  const add = async () => { setBusy(true); try { await post('/timesheets', f); toast('Heures pointées'); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const byWorker = {}; for (const r of data.rows) { const w = (byWorker[r.worker_id] ||= { name: r.worker_name, h: 0, c: 0 }); w.h += r.hours; w.c += r.hours * r.rate; }
  const inWeek = f.date >= days[0] && f.date <= days[6];
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="font-semibold mb-3">Pointer des heures</div>
        {workers.length === 0 ? <div className="text-stone-500 text-[13.5px]">Ajoutez d'abord les personnes de l'équipe (bouton « Équipe ») avec leur coût horaire.</div> :
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
            <Field label="Personne"><Select value={f.worker_id} onChange={(e) => setF({ ...f, worker_id: e.target.value })}><option value="">Choisir…</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            <Field label="Intervention" className="md:col-span-2"><Select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">Choisir…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></Field>
            <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Heures"><NumInput value={f.hours} onChange={(v) => setF({ ...f, hours: v })} /></Field>
            <Btn variant="primary" disabled={busy || !f.worker_id || !f.project_id} onClick={add}>Pointer</Btn>
          </div>}
        {!inWeek && <div className="text-[12px] text-stone-400 mt-2">Cette date est hors de la semaine affichée : l'entrée sera enregistrée mais n'apparaîtra pas ci-dessous.</div>}
      </Card>
      {Object.keys(byWorker).length > 0 && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.values(byWorker).map((w) => <Card key={w.name} className="p-3.5"><div className="text-[12px] text-stone-500">{w.name}</div><div className="text-lg font-semibold num">{h(Math.round(w.h * 100) / 100)}</div><div className="text-[12px] text-stone-400 num">{money(w.c)} de coût</div></Card>)}
        <Card className="p-3.5 bg-stone-50"><div className="text-[12px] text-stone-500">Total semaine</div><div className="text-lg font-semibold num">{h(data.total_hours)}</div><div className="text-[12px] text-stone-400 num">{money(data.total_cost)}</div></Card>
      </div>}
      {data.rows.length === 0 ? <Card><Empty icon={Clock} title="Aucune heure pointée cette semaine">Les heures pointées alimentent automatiquement les dépenses réelles de chaque intervention.</Empty></Card> :
        <Card className="overflow-x-auto"><table className="w-full text-[13.5px]"><thead><tr className="text-left text-stone-400 text-[12px] border-b border-line"><th className="p-3">Date</th><th>Personne</th><th>Intervention</th><th className="text-right">Heures</th><th className="text-right">Coût</th><th /></tr></thead><tbody>
          {data.rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0"><td className="p-3 whitespace-nowrap">{dayLabel(r.date)}</td><td>{r.worker_name}</td><td className="max-w-[260px] truncate">{r.project_title}</td><td className="text-right num">{h(r.hours)}</td><td className="text-right num">{money(r.hours * r.rate)}</td>
              <td className="text-right pr-3"><button className="text-stone-400 hover:text-rose-600" onClick={async () => { if (await ask({ title: 'Supprimer ce pointage ?', message: 'Les heures saisies seront retirées du coût de l’intervention.' })) { await del(`/timesheets/${r.id}`); reload(); } }}><Trash2 size={15} /></button></td></tr>))}
        </tbody></table></Card>}
    </div>
  );
}

function EventModal({ ev, setEv, workers, projects, reload, toast }) {
  const [busy, setBusy] = useState(false); const set = (k) => (e) => setEv({ ...ev, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try { const body = { ...ev, end_date: ev.end_date || null, start_time: ev.start_time || null, end_time: ev.end_time || null }; if (ev.id) await put(`/planning/${ev.id}`, body); else await post('/planning', body); setEv(null); reload(); toast('Planning mis à jour'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open title={ev.id ? "Modifier l’intervention" : 'Nouvelle intervention'} onClose={() => setEv(null)}>
      <div className="space-y-3">
        <Field label="Intitulé"><Input value={ev.title} onChange={set('title')} placeholder="Ex. Pose du carrelage, dépose cuisine…" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Intervention"><Select value={ev.project_id} onChange={set('project_id')}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></Field>
          <Field label="Personne"><Select value={ev.worker_id} onChange={set('worker_id')}><option value="">Non affectée</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          <Field label="Du"><Input type="date" value={ev.date} onChange={set('date')} /></Field>
          <Field label="Au (si plusieurs jours)"><Input type="date" value={ev.end_date} onChange={set('end_date')} /></Field>
          <Field label="Début"><Input type="time" value={ev.start_time} onChange={set('start_time')} /></Field>
          <Field label="Fin"><Input type="time" value={ev.end_time} onChange={set('end_time')} /></Field>
        </div>
        <Field label="Note"><Textarea rows={2} value={ev.note} onChange={set('note')} /></Field>
        <div className="flex gap-2 pt-1">
          {ev.id && <Btn variant="danger" icon={Trash2} onClick={async () => { if (await ask({ title: 'Supprimer cette intervention ?', message: 'Elle disparaîtra du planning.' })) { await del(`/planning/${ev.id}`); setEv(null); reload(); } }}>Supprimer</Btn>}
          <Btn className="ml-auto" onClick={() => setEv(null)}>Annuler</Btn><Btn variant="primary" disabled={busy} onClick={save}>Enregistrer</Btn>
        </div>
      </div>
    </Modal>
  );
}

function TeamModal({ onClose, toast }) {
  const { data, reload } = useFetch(() => get('/workers'), []);
  const [n, setN] = useState({ name: '', role: '', rate: 35 });
  const add = async () => { try { await post('/workers', n); setN({ name: '', role: '', rate: n.rate }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const patch = async (w, p) => { try { await put(`/workers/${w.id}`, p); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal open title="Équipe" onClose={onClose} width={560}>
      <p className="text-[13px] text-stone-500 mb-3">Le coût horaire chargé (salaire + charges) sert à valoriser les heures pointées dans les dépenses réelles de l’intervention.</p>
      <div className="space-y-2">
        {(data || []).map((w) => (
          <div key={w.id} className={cn('flex items-center gap-2', !w.active && 'opacity-50')}>
            <i className="w-2.5 h-6 rounded-sm shrink-0" style={{ background: w.color }} />
            <div className="flex-1 min-w-0"><div className="font-medium text-[13.5px] truncate">{w.name}</div><div className="text-[12px] text-stone-400">{w.role || '—'}</div></div>
            <div className="w-24"><Input key={w.rate} inputMode="decimal" defaultValue={String(w.rate).replace('.', ',')} onBlur={(e) => { if (e.target.value !== String(w.rate).replace('.', ',')) patch(w, { rate: e.target.value }); }} /></div><span className="text-[12px] text-stone-400">€/h</span>
            <Btn size="sm" onClick={() => patch(w, { active: w.active ? 0 : 1 })}>{w.active ? 'Désactiver' : 'Réactiver'}</Btn>
          </div>))}
        {data?.length === 0 && <div className="text-stone-500 text-[13.5px] py-2">Aucune personne pour l'instant.</div>}
      </div>
      <div className="mt-4 pt-4 border-t border-line grid grid-cols-[1fr_1fr_90px_auto] gap-2 items-end">
        <Field label="Nom"><Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
        <Field label="Métier"><Input value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })} /></Field>
        <Field label="€/h"><NumInput value={n.rate} onChange={(v) => setN({ ...n, rate: v })} /></Field>
        <Btn variant="primary" icon={Plus} onClick={add} disabled={!n.name.trim()}>Ajouter</Btn>
      </div>
    </Modal>
  );
}
