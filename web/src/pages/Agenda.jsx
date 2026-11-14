import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, CalendarCheck, Check, Copy, Mic, Pencil, Plus, Sparkles, Trash2, Calendar, Smartphone } from 'lucide-react';
import { get, post, put, del } from '../lib/api.js';
import { ask, Badge, Btn, Card, Empty, Field, Input, Modal, PageHeader, Select, Textarea, useFetch, useToast, cn } from '../lib/ui.jsx';

const TZ = 'Europe/Paris';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);           // YYYY-MM-DD à Paris
const timeFr = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const dayFr = (k) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(k + 'T12:00:00'));
const addDays = (k, n) => { const d = new Date(k + 'T12:00:00'); d.setDate(d.getDate() + n); return dayKey(d); };
const REMINDERS = [['', 'Aucun rappel'], ['0', 'À l’heure'], ['15', '15 min avant'], ['30', '30 min avant'], ['60', '1 h avant'], ['1440', '1 jour avant']];

export const taskDay = (t) => (t.due_at ? (t.all_day ? dayKey(new Date(Date.parse(t.due_at) + 3600e3)) : dayKey(new Date(t.due_at))) : null);

function group(tasks, today) {
  const g = { late: [], today: [], tomorrow: [], week: [], later: [], none: [], done: [] };
  for (const t of tasks) {
    if (t.done) { g.done.push(t); continue; }
    const d = taskDay(t); if (!d) g.none.push(t);
    else if (d < today) g.late.push(t); else if (d === today) g.today.push(t); else if (d === addDays(today, 1)) g.tomorrow.push(t); else if (d <= addDays(today, 7)) g.week.push(t); else g.later.push(t);
  }
  g.done = g.done.slice(-15).reverse(); return g;
}

function whenLabel(t, today) {
  const d = taskDay(t); if (!d) return null;
  const rel = d === today ? 'Aujourd’hui' : d === addDays(today, 1) ? 'Demain' : dayFr(d);
  return t.all_day ? rel : `${rel} · ${timeFr(t.due_at)}`;
}

function TaskModal({ t, projects, onClose, onSaved }) {
  const toast = useToast();
  const init = () => {
    if (!t.id) return { title: '', notes: '', date: '', time: '', remind: '', project_id: '' };
    const d = taskDay(t); let remind = '';
    if (t.remind_at && t.due_at) remind = t.all_day ? '0' : String(Math.round((Date.parse(t.due_at) - Date.parse(t.remind_at)) / 60000));
    if (!REMINDERS.some(([v]) => v === remind)) remind = remind === '' ? '' : '30';
    return { title: t.title, notes: t.notes || '', date: d || '', time: t.all_day ? '' : t.due_at ? timeFr(t.due_at) : '', remind, project_id: t.project_id || '' };
  };
  const [f, setF] = useState(init); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { title: f.title, notes: f.notes, date: f.date || '', time: f.date ? f.time : '', remind: f.date && f.remind !== '' ? Number(f.remind) : null, project_id: f.project_id ? Number(f.project_id) : null };
      if (t.id) await put(`/tasks/${t.id}`, body); else await post('/tasks', body);
      onSaved();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t.id ? 'Modifier la tâche' : 'Nouvelle tâche'} footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" loading={busy} disabled={!f.title.trim()} onClick={save}>Enregistrer</Btn></>}>
      <div className="space-y-3.5">
        <Field label="Tâche"><Input autoFocus value={f.title} onChange={set('title')} placeholder="Ex. Relancer M. Durand pour le devis" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={f.date} onChange={set('date')} /></Field>
          <Field label="Heure (facultatif)"><Input type="time" value={f.time} onChange={set('time')} disabled={!f.date} /></Field>
        </div>
        <Field label="Rappel sur le téléphone" hint={f.date && !f.time && f.remind !== '' ? 'Sans heure, le rappel arrive à 8 h le jour même.' : undefined}><Select value={f.remind} onChange={set('remind')} disabled={!f.date}>{REMINDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Intervention (facultatif)"><Select value={f.project_id} onChange={set('project_id')}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.contact_company || p.contact_name} — {p.title}</option>)}</Select></Field>
        <Field label="Notes"><Textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

function AiModal({ onClose, onDone }) {
  const toast = useToast(); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [rec, setRec] = useState(null); const [res, setRes] = useState(null);
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const dictate = () => {
    if (rec) { rec.stop(); setRec(null); return; }
    const r = new SR(); r.lang = 'fr-FR'; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => { let t = ''; for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript + ' '; if (t) setText((x) => (x + ' ' + t).trim()); };
    r.onend = () => setRec(null); r.onerror = () => setRec(null); r.start(); setRec(r);
  };
  const go = async () => { setBusy(true); try { setRes(await post('/agent/tasks', { text })); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return (
    <Modal open title="Assistant IA — tâches et rappels" onClose={onClose} width={560}>
      {!res ? (
        <div className="space-y-3">
          <p className="text-[13px] text-stone-500">Dites ou écrivez ce que vous devez faire, avec la date si vous la connaissez : « Rappelle-moi mardi 14 h de relancer Perrin, et lundi de commander le placo ». Plusieurs tâches possibles.</p>
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. Demain 8 h, appeler le syndic ; vendredi, passer chez Point P…" />
          <div className="flex items-center gap-2">{SR && <Btn icon={Mic} variant={rec ? 'danger' : 'default'} onClick={dictate}>{rec ? 'Arrêter la dictée' : 'Dicter'}</Btn>}
            <Btn className="ml-auto" onClick={onClose}>Annuler</Btn><Btn variant="primary" icon={Sparkles} loading={busy} disabled={text.trim().length < 4} onClick={go}>Créer</Btn></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2.5 text-[13.5px]">{res.created.length} tâche{res.created.length > 1 ? 's' : ''} créée{res.created.length > 1 ? 's' : ''} — vérifiez les dates.</div>
          <div className="divide-y divide-line border border-line rounded-lg">{res.created.map((t) => (
            <div key={t.id} className="px-3 py-2.5 text-[13.5px]"><div className="font-medium">{t.title}</div>
              <div className="text-[12.5px] text-stone-500">{whenLabel(t, dayKey(new Date())) || 'Sans date'}{t.remind_at ? ' · rappel programmé' : ''}{t.contact_name ? ` · ${t.contact_company || t.contact_name}` : ''}</div></div>))}</div>
          <div className="flex justify-end"><Btn variant="primary" onClick={onDone}>Terminer</Btn></div>
        </div>)}
    </Modal>
  );
}

const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
function Notifs() {
  const toast = useToast(); const [state, setState] = useState('...'); const [busy, setBusy] = useState(false);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const refresh = async () => {
    if (!supported) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('denied');
    try { const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription(); setState(sub ? 'on' : 'off'); } catch { setState('off'); }
  };
  useEffect(() => { refresh(); }, []); // eslint-disable-line
  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission(); if (perm !== 'granted') { setState('denied'); return; }
      const reg = await navigator.serviceWorker.ready; const { key } = await get('/push/key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      await post('/push/subscribe', { subscription: sub.toJSON() }); setState('on'); toast('Notifications activées sur cet appareil');
    } catch (e) { toast(`Activation impossible : ${e.message}`, 'err'); } finally { setBusy(false); }
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription();
    if (sub) { await post('/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); } setState('off'); toast('Notifications désactivées sur cet appareil');
  };
  const test = async () => { const r = await post('/push/test', {}); toast(r.sent ? 'Notification envoyée' : 'Aucun appareil abonné', r.sent ? 'ok' : 'err'); };
  const msg = { unsupported: "Ce navigateur ne gère pas les notifications. Sur iPhone : ajoutez d'abord SAMLOCK à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis rouvrez l'application.", denied: 'Les notifications sont bloquées pour ce site : autorisez-les dans les réglages du navigateur.', off: 'Recevez vos rappels sur ce téléphone, même application fermée.', on: 'Actives sur cet appareil.', '...': '' }[state];
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-2"><Smartphone size={15} className="text-stone-400" /><h3 className="font-semibold">Notifications téléphone</h3>{state === 'on' && <Badge className="bg-emerald-50 text-emerald-700">activées</Badge>}</div>
      <p className="text-[12.5px] text-stone-500 leading-relaxed">{msg}</p>
      <div className="flex gap-2 mt-3">
        {state === 'off' && <Btn variant="primary" icon={Bell} loading={busy} onClick={enable}>Activer</Btn>}
        {state === 'on' && <><Btn onClick={test}>Tester</Btn><Btn variant="ghost" icon={BellOff} onClick={disable}>Désactiver</Btn></>}
      </div>
    </Card>
  );
}
function CalendarFeed() {
  const toast = useToast(); const { data } = useFetch(() => get('/agenda/ics-url'));
  const copy = async () => { try { await navigator.clipboard.writeText(data.url); toast('Lien copié'); } catch { toast('Copie impossible', 'err'); } };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-2"><Calendar size={15} className="text-stone-400" /><h3 className="font-semibold">Voir dans Google Agenda</h3></div>
      <p className="text-[12.5px] text-stone-500 leading-relaxed">Ajoutez ce lien dans Google Agenda (Autres agendas → À partir de l'URL) ou Apple Calendrier : vos tâches et le planning y apparaissent. Lecture seule ; Google actualise ce type de flux toutes les quelques heures. Ce lien est secret : ne le partagez pas.</p>
      <div className="flex gap-2 mt-3"><Input readOnly value={data?.url || ''} className="text-[12px]" onFocus={(e) => e.target.select()} /><Btn icon={Copy} onClick={copy} disabled={!data}>Copier</Btn></div>
    </Card>
  );
}

export default function Agenda() {
  const toast = useToast();
  const { data: tasks, reload } = useFetch(() => get('/tasks'));
  const { data: proj } = useFetch(() => get('/projects'));
  const [edit, setEdit] = useState(() => (new URLSearchParams(location.search).get('new') === '1' ? {} : null));
  useEffect(() => { if (new URLSearchParams(location.search).get('new') === '1') history.replaceState(null, '', '/agenda'); }, []);
  const [ai, setAi] = useState(false); const [showDone, setShowDone] = useState(false);
  const today = dayKey(new Date());
  const g = useMemo(() => group(tasks || [], today), [tasks, today]);
  const { data: plan } = useFetch(() => get(`/planning?from=${today}&to=${addDays(today, 6)}`), [today]);
  if (!tasks) return <div className="p-10 text-stone-400">Chargement…</div>;
  const toggle = async (t) => { await post(`/tasks/${t.id}/done`, { done: !t.done }); reload(); };
  const remove = async (t) => { if (!await ask({ title: 'Supprimer cette tâche ?', message: `« ${t.title} »` })) return; await del(`/tasks/${t.id}`); reload(); };
  const Row = ({ t }) => (
    <div className="flex items-start gap-3 py-2.5 group">
      <button onClick={() => toggle(t)} aria-label={t.done ? 'Rouvrir' : 'Terminer'} className={cn('mt-0.5 w-5 h-5 rounded-md border grid place-items-center shrink-0 transition-colors', t.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-stone-300 hover:border-accent')}>{!!t.done && <Check size={13} />}</button>
      <div className="min-w-0 flex-1">
        <div className={cn('text-[14px] leading-snug', t.done && 'line-through text-stone-400')}>{t.title}{t.source === 'ia' && <Sparkles size={11} className="inline ml-1.5 text-accent align-baseline" />}</div>
        <div className="text-[12px] text-stone-500 flex items-center gap-2 flex-wrap mt-0.5">
          {whenLabel(t, today) && <span className={cn(!t.done && taskDay(t) < today && 'text-rose-600 font-medium')}>{whenLabel(t, today)}</span>}
          {t.remind_at && !t.done && <span className="inline-flex items-center gap-1 text-stone-400"><Bell size={11} />rappel</span>}
          {t.project_id ? <Link to={`/interventions/${t.project_id}`} className="hover:text-accent">{t.project_title}</Link> : t.contact_name ? <span>{t.contact_company || t.contact_name}</span> : null}
        </div>
        {t.notes && <div className="text-[12px] text-stone-400 mt-0.5 line-clamp-2">{t.notes}</div>}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button onClick={() => setEdit(t)} className="p-1.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100" aria-label="Modifier"><Pencil size={14} /></button>
        <button onClick={() => remove(t)} className="p-1.5 rounded-md text-stone-400 hover:text-rose-600 hover:bg-rose-50" aria-label="Supprimer"><Trash2 size={14} /></button>
      </div>
    </div>
  );
  const Sec = ({ title, items, tone }) => items.length ? (
    <Card className="px-5 py-3"><div className={cn('text-[11.5px] font-semibold uppercase tracking-wide mb-1', tone || 'text-stone-400')}>{title} · {items.length}</div><div className="divide-y divide-line">{items.map((t) => <Row key={t.id} t={t} />)}</div></Card>
  ) : null;
  const open = tasks.filter((t) => !t.done).length;
  const events = (plan?.events || []).slice(0, 8);
  return (
    <div>
      <PageHeader title="Agenda" subtitle="Vos tâches et rappels. Dictez-les à l'assistant, recevez les rappels sur votre téléphone."
        actions={<><Btn icon={Sparkles} onClick={() => setAi(true)}>Assistant IA</Btn><Btn variant="primary" icon={Plus} onClick={() => setEdit({})}>Nouvelle tâche</Btn></>} />
      <div className="px-8 pb-10 grid lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-4">
          {open === 0 && g.done.length === 0 && <Card><Empty icon={CalendarCheck} title="Aucune tâche">Ajoutez une tâche ou dites à l'assistant ce que vous avez à faire.</Empty></Card>}
          {open === 0 && g.done.length > 0 && <Card><Empty icon={CalendarCheck} title="Tout est fait 🎉">Aucune tâche en attente.</Empty></Card>}
          <Sec title="En retard" items={g.late} tone="text-rose-600" /><Sec title="Aujourd’hui" items={g.today} tone="text-accent" /><Sec title="Demain" items={g.tomorrow} />
          <Sec title="Cette semaine" items={g.week} /><Sec title="Plus tard" items={g.later} /><Sec title="Sans date" items={g.none} />
          {g.done.length > 0 && <div><button onClick={() => setShowDone(!showDone)} className="text-[12.5px] text-stone-500 hover:text-stone-800">{showDone ? 'Masquer' : 'Afficher'} les tâches terminées ({g.done.length})</button>{showDone && <Card className="px-5 py-3 mt-2"><div className="divide-y divide-line">{g.done.map((t) => <Row key={t.id} t={t} />)}</div></Card>}</div>}
        </div>
        <div className="space-y-4">
          <Card className="p-5"><div className="flex items-center gap-2 mb-2"><Calendar size={15} className="text-stone-400" /><h3 className="font-semibold">Planning des 7 prochains jours</h3></div>
            {events.length === 0 ? <div className="text-[12.5px] text-stone-400">Aucune intervention planifiée.</div> : <div className="space-y-2">{events.map((e) => <div key={e.id} className="text-[13px]"><div className="font-medium leading-snug">{e.title}</div><div className="text-[12px] text-stone-500">{dayFr(e.date)}{e.start_time ? ` · ${e.start_time}` : ''}{e.worker_name ? ` · ${e.worker_name}` : ''}</div></div>)}</div>}
            <Link to="/planning" className="text-accent text-[12.5px] font-medium mt-3 inline-block">Ouvrir le planning →</Link></Card>
          <Notifs /><CalendarFeed />
        </div>
      </div>
      {edit && <TaskModal t={edit} projects={proj?.rows || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {ai && <AiModal onClose={() => setAi(false)} onDone={() => { setAi(false); reload(); }} />}
    </div>
  );
}
