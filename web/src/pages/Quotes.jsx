import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mic, Plus, Search, Sparkles } from 'lucide-react';
import { get, post } from '../lib/api.js';
import { Textarea } from '../lib/ui.jsx';
import { money, dateFr } from '../lib/format.js';
import { Btn, Card, Chips, Empty, Field, Input, MarginPill, Modal, PageHeader, QStatusBadge, SearchBox, Select, matches, useFetch, useSort, useToast, cn } from '../lib/ui.jsx';

function AiModal({ onClose }) {
  const nav = useNavigate(); const toast = useToast();
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [res, setRes] = useState(null); const [rec, setRec] = useState(null);
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const dictate = () => {
    if (rec) { rec.stop(); setRec(null); return; }
    const r = new SR(); r.lang = 'fr-FR'; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => { let t = ''; for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript + ' '; if (t) setText((x) => (x + ' ' + t).trim()); };
    r.onend = () => setRec(null); r.onerror = () => setRec(null); r.start(); setRec(r);
  };
  const go = async () => { setBusy(true); try { setRes(await post('/agent/devis', { text })); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return (
    <Modal open title="Assistant IA — brouillon de devis" onClose={onClose} width={600}>
      {!res ? <div className="space-y-3">
        <p className="text-[13px] text-stone-500">Décrivez l’intervention comme vous le diriez à un collègue : client, pièces, prestations, surfaces. L'assistant prépare un <b>brouillon</b> à relire ; rien n'est envoyé au client.</p>
        <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. Devis pour M. Durand, 3 rue des Lilas à Montpellier. Salle de bains : dépose de la baignoire, douche à l'italienne, carrelage sol 8 m², faïence murale 14 m²…" />
        <div className="flex items-center gap-2">
          {SR && <Btn icon={Mic} variant={rec ? 'danger' : 'default'} onClick={dictate}>{rec ? 'Arrêter la dictée' : 'Dicter'}</Btn>}
          <Btn className="ml-auto" onClick={onClose}>Annuler</Btn><Btn variant="primary" icon={Sparkles} loading={busy} disabled={text.trim().length < 8} onClick={go}>Préparer le devis</Btn>
        </div>
      </div> : <div className="space-y-3">
        <div className="rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2.5 text-[13.5px]">Brouillon créé : {res.lines} ligne(s){res.to_price ? `, dont ${res.to_price} à chiffrer` : ''}.{res.created_contact ? ' Nouveau client ajouté (prospect).' : ''}</div>
        {res.warnings.length > 0 && <ul className="text-[13px] text-amber-800 bg-amber-50 rounded-lg px-4 py-2.5 list-disc">{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>Fermer</Btn><Btn variant="primary" onClick={() => nav(`/devis/${res.quote_id}`)}>Ouvrir le brouillon</Btn></div>
      </div>}
    </Modal>
  );
}

export default function Quotes() {
  const nav = useNavigate();
  const { data } = useFetch(() => get('/quotes'));
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState(''); const [ai, setAi] = useState(false); const { data: agent } = useFetch(() => get('/agent/status'));
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const createNew = async () => { try { const x = await post('/quotes', {}); nav(`/devis/${x.id}`); } catch (e) { toast(e.message, 'err'); } };
  useEffect(() => { if (params.get('new') === '1') { setParams({}); createNew(); } }, []); // eslint-disable-line
  const filtered = useMemo(() => (data || []).filter((r) => (status === 'all' || r.status === status) && matches(r, q, (x) => `${x.number} ${x.title} ${x.contact_name} ${x.contact_company} ${x.project_title}`)), [data, status, q]);
  const sort = useSort(filtered, { number: (r) => r.number, client: (r) => r.contact_company || r.contact_name, title: (r) => r.title || r.project_title, status: (r) => r.status, ht: (r) => r.ht, ttc: (r) => r.ttc, profit: (r) => r.profit, margin: (r) => r.margin_pct, date: (r) => r.created_at }, { key: 'date', dir: 'desc' });
  const rows = sort.rows;
  const countOf = (k) => (data || []).filter((r) => k === 'all' || r.status === k).length;
  const tabs = [['all', 'Tous'], ['brouillon', 'Brouillons'], ['envoye', 'Envoyés'], ['signe', 'Signés'], ['refuse', 'Refusés']];
  return (
    <div>
      {ai && <AiModal onClose={() => setAi(false)} />}
      <PageHeader title="Devis" actions={<>{agent?.ready && <Btn icon={Sparkles} onClick={() => setAi(true)}>Assistant IA</Btn>}<Btn variant="primary" icon={Plus} onClick={createNew}>Nouveau devis</Btn></>} />
      <div className="px-8 pb-10">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Chips value={status} onChange={setStatus} options={tabs.map(([k, l]) => [k, l, countOf(k)])} />
          <SearchBox className="ml-auto" value={q} onChange={setQ} placeholder="N°, client, objet…" />
        </div>
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead><tr className="text-left text-[11.5px] text-stone-400 border-b border-line">{sort.th('number', 'N°', { className: 'px-4 py-2.5' })}{sort.th('client', 'Client')}{sort.th('title', 'Objet')}{sort.th('status', 'Statut')}{sort.th('ht', 'Total HT', { right: true, className: 'text-right' })}{sort.th('ttc', 'Total TTC', { right: true, className: 'text-right' })}{sort.th('profit', 'Bénéfice', { right: true, className: 'text-right' })}{sort.th('margin', 'Marge', { right: true, className: 'text-right pr-4' })}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/70 hover:bg-stone-50 cursor-pointer" onClick={() => nav(`/devis/${r.id}`)}>
                  <td className="px-4 py-2.5 font-medium whitespace-nowrap"><Link to={`/devis/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.number || <span className="text-stone-400">Brouillon</span>}</Link>{r.kind === 'avenant' && <span className="ml-1.5 text-[11px] text-violet-700 bg-violet-50 rounded px-1.5">avenant</span>}</td>
                  <td>{r.contact_company || r.contact_name}</td><td className="text-stone-600 max-w-[320px] truncate">{r.title || r.project_title}</td>
                  <td><QStatusBadge status={r.status} /></td><td className="text-right num font-medium">{money(r.ht)}</td><td className="text-right num text-stone-500">{money(r.ttc)}</td>
                  <td className="text-right num text-stone-500">{money(r.profit)}</td><td className="text-right pr-4"><MarginPill value={r.margin_pct} /></td>
                </tr>))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty title="Aucun devis">Créez votre premier devis avec « Nouveau devis ».</Empty>}
        </Card>
      </div>
    </div>
  );
}

function NewQuote({ open, onClose }) {
  const { data } = useFetch(() => get('/projects'), [open]);
  const [pid, setPid] = useState('');
  const nav = useNavigate(); const toast = useToast();
  const go = async () => { try { const q = await post('/quotes', { project_id: Number(pid) }); nav(`/devis/${q.id}`); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal open={open} onClose={onClose} title="Nouveau devis" footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" disabled={!pid} onClick={go}>Créer le brouillon</Btn></>}>
      <Field label="Intervention" hint="Pas encore d’intervention ? Créez-la d'abord depuis le Pipeline ou la fiche du contact."><Select autoFocus value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choisir une affaire…</option>{data?.rows.map((p) => <option key={p.id} value={p.id}>{(p.contact_company || p.contact_name)} — {p.title}</option>)}</Select></Field>
    </Modal>
  );
}
