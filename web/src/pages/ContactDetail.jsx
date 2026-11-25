import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Phone, Mail, MapPin, ShieldCheck, ShieldAlert, ShieldX, MessageSquare, FileText, GitCommitHorizontal, Send, Trash2 } from 'lucide-react';
import { get, post, put, del } from '../lib/api.js';
import { KINDS, ago, dateFr, daysUntil, money } from '../lib/format.js';
import { ask, Avatar, Btn, Card, Field, Input, KindBadge, PageHeader, QStatusBadge, Select, StageBadge, Textarea, useFetch, useToast, useDebounced, cn } from '../lib/ui.jsx';
import { NewProject } from './Pipeline.jsx';

function Attestation({ label, date, onChange, disabled }) {
  const n = daysUntil(date);
  const state = !date ? 'missing' : n < 0 ? 'expired' : n < 45 ? 'soon' : 'ok';
  const m = { missing: ['bg-stone-50 border-stone-200', ShieldX, 'text-stone-400', 'Non déposée'], expired: ['bg-rose-50 border-rose-200', ShieldX, 'text-rose-600', `Expirée depuis ${-n} j`], soon: ['bg-amber-50 border-amber-200', ShieldAlert, 'text-amber-600', `Expire dans ${n} j`], ok: ['bg-emerald-50 border-emerald-200', ShieldCheck, 'text-emerald-600', `Valide · ${n} j restants`] }[state];
  const Icon = m[1];
  return (
    <div className={cn('rounded-xl border p-3.5', m[0])}>
      <div className="flex items-center gap-2 font-medium"><Icon size={16} className={m[2]} />{label}</div>
      <div className="text-[12.5px] text-stone-600 mt-0.5">{m[3]}</div>
      <Input type="date" disabled={disabled} value={date || ''} onChange={(e) => onChange(e.target.value)} className="mt-2.5 h-8 text-[12.5px] bg-white" />
    </div>
  );
}

function Emails({ id, email }) {
  const { data } = useFetch(() => get(`/contacts/${id}/emails`), [id, email]);
  const [open, setOpen] = useState(null);
  if (!email || !data || data.length === 0) return null;
  const fmt = (d) => new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <Card className="p-5">
      <h2 className="font-semibold mb-3">E-mails <span className="text-stone-400 font-normal">· {data.length}</span></h2>
      <div className="divide-y divide-line">
        {data.slice(0, 30).map((m) => (
          <div key={m.id} className="py-2.5">
            <button onClick={() => setOpen(open === m.id ? null : m.id)} className="w-full text-left">
              <div className="flex items-baseline gap-2"><span className={cn('text-[11px] font-semibold rounded px-1.5 py-0.5 shrink-0', m.direction === 'in' ? 'bg-sky-50 text-sky-700' : 'bg-stone-100 text-stone-600')}>{m.direction === 'in' ? 'Reçu' : 'Envoyé'}</span>
                <span className="text-[13.5px] font-medium truncate">{m.subject}</span><span className="ml-auto text-[12px] text-stone-400 shrink-0">{fmt(m.date)}</span></div>
              {open !== m.id && <div className="text-[12.5px] text-stone-500 truncate mt-0.5">{m.snippet}</div>}
            </button>
            {open === m.id && <pre className="whitespace-pre-wrap font-sans text-[13px] text-stone-700 mt-2 max-h-72 overflow-auto">{m.body || m.snippet}{m.has_att ? '\n\n📎 pièce jointe (à consulter dans la boîte mail)' : ''}</pre>}
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function ContactDetail() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast();
  const { data: c, reload, setData } = useFetch(() => get(`/contacts/${id}`), [id]);
  const [note, setNote] = useState(''); const [np, setNp] = useState(false);
  const save = useDebounced((patch) => put(`/contacts/${id}`, patch).then(() => {}).catch((e) => toast(e.message, 'err')), 500);
  if (!c) return <div className="p-10 text-stone-400">Chargement…</div>;
  const upd = (k, v) => { setData({ ...c, [k]: v }); save({ [k]: v }); };
  const changeKind = async (kind) => { setData({ ...c, kind }); await put(`/contacts/${id}`, { kind }); toast(`Rubrique : ${KINDS[kind]}`); reload(); };
  const removeContact = async () => {
    if (!await ask({ title: `Supprimer « ${c.name} » ?`, message: 'Ses interventions, devis, factures et documents seront supprimés définitivement. Une sauvegarde est faite juste avant.', confirmLabel: 'Supprimer le contact' })) return;
    try { await del(`/contacts/${id}`); }
    catch (e) {
      if (!/numérotée/.test(e.message) || !await ask({ title: 'Facture(s) numérotée(s)', message: `${e.message}\n\nÀ réserver aux données de test.`, confirmLabel: 'Supprimer quand même' })) { if (!/numérotée/.test(e.message)) toast(e.message, 'err'); return; }
      await del(`/contacts/${id}?force=1`);
    }
    toast('Contact supprimé'); nav('/contacts');
  };
  const addNote = async () => { if (!note.trim()) return; await post(`/contacts/${id}/notes`, { text: note }); setNote(''); reload(); };
  const newQuote = async (pid) => { const q = await post('/quotes', { project_id: pid }); nav(`/devis/${q.id}`); };
  const isSub = c.kind === 'sous_traitant';
  const subOk = isSub && c.decennale_until && c.urssaf_until && daysUntil(c.decennale_until) >= 0 && daysUntil(c.urssaf_until) >= 0;
  const icons = { note: MessageSquare, stage: GitCommitHorizontal, devis: FileText, mail: Send, prix: Send };
  return (
    <div>
      <div className="px-8 pt-6"><Link to="/contacts" className="inline-flex items-center gap-1.5 text-stone-500 hover:text-stone-800 text-[13px]"><ArrowLeft size={14} /> Contacts</Link></div>
      <div className="px-8 pt-3 pb-5 flex items-center gap-4">
        <Avatar name={c.name} size={52} />
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight leading-tight">{c.company || c.name}</h1>
          <div className="flex items-center gap-3 text-stone-500 mt-1 flex-wrap text-[13px]">
            <KindBadge kind={c.kind} />{c.company && <span>{c.name}</span>}
            {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 hover:text-accent"><Phone size={12} />{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 hover:text-accent"><Mail size={12} />{c.email}</a>}
            {c.city && <span className="flex items-center gap-1.5"><MapPin size={12} />{c.postal} {c.city}</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select value={c.kind} onChange={(e) => changeKind(e.target.value)} className="!w-44 h-8.5">{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l.replace(/s$/, '')}</option>)}</Select>
          {['prospect', 'client'].includes(c.kind) && <Btn variant="primary" icon={Plus} onClick={() => setNp(true)}>Nouvelle intervention</Btn>}
          <Btn variant="ghost" icon={Trash2} onClick={removeContact} title="Supprimer ce contact" className="!text-rose-600" />
        </div>
      </div>

      <div className="px-8 pb-10 grid lg:grid-cols-5 gap-6 max-w-[1300px]">
        <div className="lg:col-span-3 space-y-6">
          {isSub && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3"><h2 className="font-semibold">Attestations obligatoires</h2>
                <span className={cn('text-[12px] font-semibold rounded-md px-2 py-0.5', subOk ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{subOk ? 'Affectable à une intervention' : 'Non affectable à une intervention'}</span></div>
              <div className="grid grid-cols-2 gap-3"><Attestation label="Assurance RC pro / décennale" date={c.decennale_until} onChange={(v) => upd('decennale_until', v)} /><Attestation label="Vigilance URSSAF" date={c.urssaf_until} onChange={(v) => upd('urssaf_until', v)} /></div>
              <p className="text-[12px] text-stone-400 mt-3">L'attestation URSSAF se renouvelle tous les 6 mois. Sans attestation valide, le sous-traitant ne peut pas être affecté.</p>
            </Card>
          )}

          {['prospect', 'client', 'apporteur'].includes(c.kind) && (
            <Card>
              <div className="px-5 py-3.5 border-b border-line flex items-center"><h2 className="font-semibold">Devis et factures</h2></div>
              {c.projects.length === 0 && <div className="p-8 text-center text-stone-400">Aucune intervention. Créez-en une pour établir un devis.</div>}
              {c.projects.map((p) => (
                <div key={p.id} className="px-5 py-4 border-b border-line last:border-0">
                  <div className="flex items-center gap-3"><div className="font-medium">{p.title}</div><StageBadge stage={p.stage} /><Btn size="sm" className="ml-auto" icon={Plus} onClick={() => newQuote(p.id)}>Devis</Btn></div>
                  <div className="text-stone-500 text-[12.5px] mt-0.5">{[p.address, p.city].filter(Boolean).join(', ')}</div>
                  {p.quotes.length > 0 && <div className="mt-2.5 space-y-1">{p.quotes.map((q) => (
                    <Link key={q.id} to={`/devis/${q.id}`} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-stone-50 hover:bg-orange-50">
                      <FileText size={14} className="text-stone-400" /><span className="font-medium">{q.number || 'Brouillon'}</span><span className="text-stone-500 truncate flex-1">{q.title}</span><QStatusBadge status={q.status} /><span className="num font-medium w-24 text-right">{money(q.totals.ht)}</span>
                    </Link>))}</div>}
                </div>
              ))}
            </Card>
          )}

          <Card className="p-5 form-stack">
            <h2 className="font-semibold mb-3">Coordonnées</h2>
            <div className="grid grid-cols-2 gap-3.5">
              <Field label="Nom"><Input value={c.name} onChange={(e) => upd('name', e.target.value)} /></Field>
              <Field label="Société"><Input value={c.company || ''} onChange={(e) => upd('company', e.target.value)} /></Field>
              <Field label="Téléphone"><Input value={c.phone || ''} onChange={(e) => upd('phone', e.target.value)} /></Field>
              <Field label="E-mail"><Input value={c.email || ''} onChange={(e) => upd('email', e.target.value)} /></Field>
              <Field label="Adresse" className="col-span-2"><Input value={c.address || ''} onChange={(e) => upd('address', e.target.value)} /></Field>
              <Field label="Code postal"><Input value={c.postal || ''} onChange={(e) => upd('postal', e.target.value)} /></Field>
              <Field label="Ville"><Input value={c.city || ''} onChange={(e) => upd('city', e.target.value)} /></Field>
              {<Field label={isSub || c.kind === 'fournisseur' ? 'SIRET' : 'SIREN / SIRET (si professionnel)'}><Input value={c.siret || ''} onChange={(e) => upd('siret', e.target.value)} /></Field>}
              {['client', 'prospect'].includes(c.kind) && <Field label="Type de client" hint="Particulier : TVA 10 % · Professionnel : TVA 20 %"><Select value={c.client_type || 'particulier'} onChange={(e) => upd('client_type', e.target.value)}><option value="particulier">Particulier</option><option value="professionnel">Professionnel / syndic / entreprise</option></Select></Field>}
              {isSub && <Field label="Métier"><Input value={c.trade || ''} onChange={(e) => upd('trade', e.target.value)} /></Field>}
              <Field label="Source"><Input value={c.source || ''} onChange={(e) => upd('source', e.target.value)} /></Field>
            </div>
          </Card>
          <Emails id={c.id} email={c.email} />
        </div>

        <div className="lg:col-span-2">
          <Card className="p-5 sticky top-4">
            <h2 className="font-semibold mb-3">Historique</h2>
            <div className="flex gap-2 mb-4"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ajouter une note (appel, visite, remarque)…" onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && addNote()} /><Btn variant="dark" onClick={addNote} className="self-end">Ajouter</Btn></div>
            <div className="relative pl-5 space-y-4 max-h-[60vh] overflow-auto scroll-thin">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-stone-200" />
              {c.activities.map((a) => { const I = icons[a.kind] || MessageSquare; return (
                <div key={a.id} className="relative">
                  <span className="absolute -left-5 top-0.5 w-3.5 h-3.5 rounded-full bg-white border-2 border-stone-300 grid place-items-center" />
                  <div className="leading-snug">{a.text}</div><div className="text-[11.5px] text-stone-400 mt-0.5">{ago(a.created_at)}</div>
                </div>); })}
              {c.activities.length === 0 && <div className="text-stone-400">Aucun événement.</div>}
            </div>
          </Card>
        </div>
      </div>
      <NewProject open={np} contactId={c.id} onClose={() => setNp(false)} onDone={() => { setNp(false); reload(); }} />
    </div>
  );
}
