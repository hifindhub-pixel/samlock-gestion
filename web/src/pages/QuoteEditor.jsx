import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Car, Plus, Trash2, FileDown, Send, Copy, Lock, Eye, EyeOff, Store, MoreHorizontal, FilePlus2, CheckCircle2, XCircle, PackagePlus, Sparkles, AlertTriangle, Search, Loader2, Check, GitBranch } from 'lucide-react';
import { get, post, put, del } from '../lib/api.js';
import { calcLine, calcQuote, money, num, pct, dateFr } from '../lib/format.js';
import { ask, Btn, Card, Modal, Input, Select, Textarea, Field, MarginPill, QStatusBadge, NumInput, StageBadge, useToast, cn } from '../lib/ui.jsx';

const COLS_INT = 'minmax(170px,1fr) 54px 50px 68px 52px 66px 76px 86px 62px 40px';
const COLS_CLI = 'minmax(200px,1fr) 62px 56px 84px 50px 92px 40px';
function AutoText({ value, onChange, disabled, className }) {
  const ref = useRef();
  useEffect(() => { const el = ref.current; if (el) { el.style.height = '0px'; el.style.height = el.scrollHeight + 'px'; } }, [value]);
  return <textarea ref={ref} rows={1} disabled={disabled} value={value} onChange={onChange} className={className} />;
}
const SEG = { mat: { label: 'Fournitures', c: 'bg-sky-500' }, lab: { label: "Main-d'œuvre", c: 'bg-violet-500' }, sub: { label: 'Sous-traitance', c: 'bg-amber-500' }, profit: { label: 'Bénéfice', c: 'bg-emerald-500' } };

function ProfitPanel({ quote, calc, settings }) {
  const { t, sec } = calc;
  const alert = Number(settings.margin_alert || 20);
  const low = t.margin != null && t.margin < alert;
  const parts = ['mat', 'lab', 'sub', 'profit'];
  const base = Math.max(t.total, 0.0001);
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="px-4 py-2.5 bg-stone-50 border-b border-line flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-stone-500">
          <Lock size={12} /> Rentabilité · interne
        </div>
        <div className="p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-stone-500">Prix de vente HT</span>
            <span className="num text-2xl font-semibold tracking-tight">{money(t.total)}</span>
          </div>
          <div className="flex justify-between text-stone-500 mt-1 text-[12.5px]"><span>TVA</span><span className="num">{money(t.tva)}</span></div>
          <div className="flex justify-between mt-0.5 text-[12.5px]"><span className="text-stone-500">Total TTC</span><span className="num font-medium">{money(t.ttc)}</span></div>

          <div className="my-4 border-t border-dashed border-stone-200" />
          <div className="flex items-end justify-between">
            <div>
              <div className="text-stone-500 text-[12px]">Bénéfice</div>
              <div className={cn('num text-[26px] leading-none font-semibold tracking-tight', low ? 'text-rose-600' : t.costed ? 'text-emerald-700' : 'text-stone-400')}>{t.costed ? money(t.profit) : '—'}</div>
              {!t.costed && <div className="text-stone-400 text-[11.5px] mt-1">Coûts non renseignés</div>}
            </div>
            <div className={cn('num text-lg font-semibold rounded-lg px-2.5 py-1', low ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>{pct(t.margin)}</div>
          </div>
          {low && (
            <div className="mt-3 flex gap-2 text-[12.5px] rounded-lg bg-rose-50 text-rose-800 p-2.5">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" /> Marge sous le seuil de {pct(alert, 0)}. Vérifiez les prix avant l'envoi.
            </div>
          )}

          <div className="mt-5 text-[11.5px] font-semibold uppercase tracking-wide text-stone-400">Où va chaque euro vendu</div>
          <div className="flex h-3 rounded-full overflow-hidden mt-2 bg-stone-100">
            {parts.map((k) => <div key={k} className={SEG[k].c} style={{ width: `${Math.max(0, (t[k] / base) * 100)}%` }} title={SEG[k].label} />)}
          </div>
          <div className="mt-3 space-y-1.5">
            {parts.map((k) => (
              <div key={k} className="flex items-center gap-2 text-[12.5px]">
                <i className={cn('w-2.5 h-2.5 rounded-sm', SEG[k].c)} />
                <span className="text-stone-600">{SEG[k].label}</span>
                <span className="ml-auto num font-medium">{money(t[k])}</span>
                <span className="num text-stone-400 w-12 text-right">{t.total > 0 ? pct((t[k] / base) * 100, 0) : '—'}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 mt-1 border-t border-line text-[12.5px]">
              <span className="text-stone-500">Coût de revient</span><span className="num font-semibold">{money(t.cost)}</span>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="px-4 py-2.5 border-b border-line text-[11.5px] font-semibold uppercase tracking-wide text-stone-500">Par pièce</div>
        <div className="divide-y divide-line">
          {quote.sections.map((s) => {
            const x = sec[s.id];
            return (
              <div key={s.id} className="px-4 py-2.5 flex items-center gap-2">
                <span className="truncate flex-1 text-[13px]">{s.title}</span>
                <span className="num text-[12.5px] text-stone-500">{money(x?.total || 0)}</span>
                <span className="w-[62px] text-right"><MarginPill value={x?.margin} threshold={alert} /></span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function CatalogPicker({ items, onPick, onFree, disabled, innerRef }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const words = s.split(/\s+/).filter(Boolean);
    const r = items.filter((i) => !words.length || words.every((w) => `${i.label} ${i.ref || ''} ${i.category || ''}`.toLowerCase().includes(w)));
    return r.slice(0, 8);
  }, [q, items]);
  const total = results.length + (q.trim() ? 1 : 0);
  const choose = (i) => {
    if (i < results.length) onPick(results[i]); else onFree(q.trim());
    setQ(''); setIdx(0);
  };
  return (
    <div className="relative">
      <div className="flex items-center gap-2 px-3 h-10 border-t border-line bg-stone-50/60 focus-within:bg-white">
        <Plus size={14} className="text-stone-400" />
        <input ref={innerRef} disabled={disabled} value={q} placeholder="Ajouter un article du catalogue… (tapez pour chercher, ↵ pour valider)"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setIdx(0); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 140)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, total - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && total) { e.preventDefault(); choose(idx); }
            else if (e.key === 'Escape') { setOpen(false); e.target.blur(); }
          }}
          className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-stone-400" />
      </div>
      {open && !disabled && total > 0 && (
        <div className="absolute left-2 right-2 top-full z-30 bg-white border border-line rounded-xl shadow-xl py-1 pop max-h-80 overflow-auto">
          {results.map((i, n) => (
            <button key={i.id} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(n)} onMouseEnter={() => setIdx(n)}
              className={cn('w-full flex items-center gap-3 px-3 py-2 text-left', n === idx && 'bg-orange-50')}>
              <span className="text-[11px] text-stone-400 w-14 shrink-0">{i.ref}</span>
              <span className="flex-1 truncate">{i.label}</span>
              <span className="text-[11.5px] text-stone-400">{i.category}</span>
              <span className="num font-medium w-24 text-right">{money(i.price_ht)} <span className="text-stone-400 font-normal">/{i.unit}</span></span>
            </button>
          ))}
          {q.trim() && (
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => choose(results.length)} onMouseEnter={() => setIdx(results.length)}
              className={cn('w-full flex items-center gap-2 px-3 py-2 text-left border-t border-line', idx === results.length && 'bg-orange-50')}>
              <PackagePlus size={14} className="text-accent" /> Ligne libre « {q.trim()} » <span className="text-amber-700 text-[11.5px]">· à chiffrer</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LineRow({ l, view, locked, costLocked = locked, alert, onPatch, onDelete, onCatalog, onPrice }) {
  const [showDesc, setShowDesc] = useState(false);
  const c = calcLine(l);
  const internal = view === 'interne';
  const cell = 'cell num cell-r';
  const unitCost = (Number(l.cost_material) || 0) + (Number(l.labor_hours) || 0) * (Number(l.labor_rate) || 0) + (Number(l.cost_sub) || 0);
  return (
    <div className={cn('group grid items-start gap-x-1 px-2 py-1 border-t border-line/70 hover:bg-stone-50/50', l.to_price && 'bg-amber-50/50')}
      style={{ gridTemplateColumns: internal ? COLS_INT : COLS_CLI }}>
      <div>
        <AutoText disabled={locked} value={l.label} onChange={(e) => onPatch({ label: e.target.value })} className="cell font-medium leading-snug overflow-hidden" />
        {(l.description || showDesc) && <AutoText disabled={locked} value={l.description || ''} onChange={(e) => onPatch({ description: e.target.value })} className="cell text-[12px] text-stone-500 !py-0.5 overflow-hidden" />}
      </div>
      <NumInput disabled={locked} value={l.qty} onChange={(v) => onPatch({ qty: v })} className={cell} />
      <input disabled={locked} value={l.unit} onChange={(e) => onPatch({ unit: e.target.value })} className="cell text-stone-500" />
      {internal && <NumInput disabled={costLocked} value={l.cost_material} onChange={(v) => onPatch({ cost_material: v })} className={cn(cell, 'text-sky-800')} title="Fourniture, € par unité" />}
      {internal && <NumInput disabled={costLocked} value={l.labor_hours} onChange={(v) => onPatch({ labor_hours: v, labor_rate: l.labor_rate || 45 })} className={cn(cell, 'text-violet-800')} title="Main-d'œuvre interne, heures par unité" />}
      {internal && <NumInput disabled={costLocked} value={l.cost_sub} onChange={(v) => onPatch({ cost_sub: v })} className={cn(cell, 'text-amber-800')} title="Sous-traitance, € par unité" />}
      {l.to_price && !(Number(l.price_ht) > 0) ? (
        <button disabled={locked} onClick={onPrice} className="col-span-1 h-[30px] mt-px rounded-md bg-amber-100 text-amber-800 text-[11.5px] font-semibold hover:bg-amber-200">À chiffrer</button>
      ) : (
        <NumInput disabled={locked} value={l.price_ht} onChange={(v) => onPatch({ price_ht: v, to_price: 0 })} className={cn(cell, 'font-medium')} />
      )}
      {internal ? <div className="num text-right font-semibold py-[6px] pr-2">{money(c.total)}</div> : <NumInput disabled={locked} value={l.vat} onChange={(v) => onPatch({ vat: v })} className={cell} />}
      {internal ? (
        <NumInput disabled={locked || unitCost === 0} value={c.margin == null ? '' : Math.round(c.margin * 10) / 10}
          onChange={(m) => { if (unitCost > 0 && m < 95) onPatch({ price_ht: Math.round((unitCost / (1 - m / 100)) * 100) / 100, to_price: 0 }); }}
          className={cn(cell, 'font-semibold', c.margin != null && c.margin < alert ? 'text-rose-600' : 'text-emerald-700')} title="Taux de marge : modifiez-le pour recalculer le prix de vente" />
      ) : null}
      {!internal && <div className="num text-right font-semibold py-[6px] pr-2">{money(c.total)}</div>}
      <div className="flex items-center justify-end pt-1 gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {!locked && !l.description && !showDesc && <button onClick={() => setShowDesc(true)} className="p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700 text-[11px] font-semibold leading-none" title="Ajouter une description pour le client">Aa</button>}
        {!locked && <button onClick={onDelete} className="p-1 rounded hover:bg-rose-50 text-stone-400 hover:text-rose-600" title="Supprimer la ligne"><Trash2 size={13} /></button>}
        {!locked && !l.item_id && !l.to_price && <button onClick={onCatalog} className="p-1 rounded hover:bg-orange-50 text-stone-400 hover:text-accent" title="Ajouter au catalogue"><PackagePlus size={13} /></button>}
      </div>
    </div>
  );
}

function AttachModal({ q, onClose, onDone }) {
  const toast = useToast();
  const [mode, setMode] = useState('existing');
  const [projects, setProjects] = useState([]); const [contacts, setContacts] = useState([]);
  const [pid, setPid] = useState(''); const [cid, setCid] = useState('');
  const [f, setF] = useState({ name: '', company: '', phone: '', email: '', city: '', title: q.title || '', address: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { get('/projects').then((d) => setProjects(d.rows.filter((p) => p.contact_name !== 'À définir'))); get('/contacts').then((d) => setContacts(d.rows.filter((c) => c.name !== 'À définir'))); }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = async () => {
    setBusy(true);
    try {
      const body = mode === 'existing' ? { project_id: Number(pid) }
        : { title: f.title, address: f.address, city: f.city, ...(cid ? { contact_id: Number(cid) } : { new_contact: { name: f.name, company: f.company, phone: f.phone, email: f.email, city: f.city } }) };
      onDone(await post(`/quotes/${q.id}/attach`, body));
    } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  const ok = mode === 'existing' ? !!pid : (f.title.trim() && (cid || f.name.trim()));
  const tab = (k, l) => <button onClick={() => setMode(k)} className={cn('flex-1 h-10 rounded-lg text-[13.5px] font-medium border', mode === k ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-600 border-line')}>{l}</button>;
  return (
    <Modal open onClose={onClose} title="Client et intervention du devis" width={560} footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" loading={busy} disabled={!ok} onClick={go}>Rattacher le devis</Btn></>}>
      <div className="space-y-4">
        <div className="flex gap-2">{tab('existing', 'Intervention existante')}{tab('new', 'Nouvelle intervention')}</div>
        {mode === 'existing' ? (
          <Field label="Intervention"><Select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choisir une affaire…</option>{projects.map((p) => <option key={p.id} value={p.id}>{(p.contact_company || p.contact_name)} — {p.title}</option>)}</Select></Field>
        ) : (
          <div className="space-y-3">
            <Field label="Client"><Select value={cid} onChange={(e) => setCid(e.target.value)}><option value="">+ Nouveau client…</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.company || c.name}{c.city ? ` (${c.city})` : ''}</option>)}</Select></Field>
            {!cid && <div className="grid grid-cols-2 gap-3">
              <Field label="Nom *"><Input value={f.name} onChange={set('name')} /></Field>
              <Field label="Société"><Input value={f.company} onChange={set('company')} /></Field>
              <Field label="Téléphone"><Input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
              <Field label="E-mail"><Input value={f.email} onChange={set('email')} inputMode="email" /></Field>
            </div>}
            <Field label="Intitulé de l’intervention *"><Input value={f.title} onChange={set('title')} placeholder="Ex. Ouverture de porte + changement de cylindre" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Adresse de l’intervention"><Input value={f.address} onChange={set('address')} /></Field>
              <Field label="Ville"><Input value={f.city} onChange={set('city')} /></Field>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function QuoteEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [settings, setSettings] = useState({});
  const [view, setView] = useState('interne');
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState(false);
  const [priceModal, setPriceModal] = useState(null);
  const [sendModal, setSendModal] = useState(null);
  const [attach, setAttach] = useState(false);
  const pending = useRef({}); const timers = useRef({}); const metaTimer = useRef();
  const pickerRefs = useRef({});

  const load = useCallback(() => get(`/quotes/${id}`).then(setQ), [id]);
  const [travelBusy, setTravelBusy] = useState(false);
  const [sugg, setSugg] = useState([]); const [hidden, setHidden] = useState(() => new Set());
  const itemSig = q ? q.lines.map((l) => l.item_id || 0).join(',') : '';
  useEffect(() => { if (!q) return; let ok = true; get(`/quotes/${id}/suggestions`).then((r) => ok && setSugg(r)).catch(() => {}); return () => { ok = false; }; }, [id, itemSig]); // eslint-disable-line
  useEffect(() => { load(); get('/catalog').then((d) => setCatalog(d.rows)); get('/contacts?kind=fournisseur').then((d) => setSuppliers(d.rows)); get('/settings').then(setSettings); }, [load]);

  const locked = q && q.status !== 'brouillon';
  const calc = useMemo(() => (q ? calcQuote(q.lines) : null), [q]);

  const flush = useCallback(async (lid) => {
    const p = pending.current[lid]; if (!p) return; delete pending.current[lid];
    try { await put(`/lines/${lid}`, p); } catch (e) { toast(e.message, 'err'); }
    if (!Object.keys(pending.current).length) setSaving(false);
  }, [toast]);
  const flushAll = useCallback(async () => { await Promise.all(Object.keys(pending.current).map((k) => { clearTimeout(timers.current[k]); return flush(k); })); }, [flush]);
  // Enregistre immédiatement ce qui est en attente (changement de page, fermeture d'onglet) : aucune saisie perdue.
  const metaPending = useRef({});
  useEffect(() => {
    const send = (url, body) => { try { fetch('/api' + url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }); } catch { /* ignore */ } };
    const leave = () => {
      Object.keys(pending.current).forEach((k) => { send(`/lines/${k}`, pending.current[k]); delete pending.current[k]; });
      if (Object.keys(metaPending.current).length) { send(`/quotes/${id}`, metaPending.current); metaPending.current = {}; }
    };
    window.addEventListener('pagehide', leave); window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('pagehide', leave); window.removeEventListener('beforeunload', leave); leave(); };
  }, [id]);

  const patchLine = (lid, patch) => {
    setQ((cur) => ({ ...cur, lines: cur.lines.map((l) => (l.id === lid ? { ...l, ...patch } : l)) }));
    pending.current[lid] = { ...pending.current[lid], ...patch };
    clearTimeout(timers.current[lid]); setSaving(true);
    timers.current[lid] = setTimeout(() => flush(lid), 500);
  };
  const patchMeta = (patch) => {
    setQ((cur) => ({ ...cur, ...patch }));
    metaPending.current = { ...metaPending.current, ...patch };
    clearTimeout(metaTimer.current); setSaving(true);
    metaTimer.current = setTimeout(async () => { const body = metaPending.current; metaPending.current = {}; try { await put(`/quotes/${id}`, body); } catch (e) { toast(e.message, 'err'); } setSaving(false); }, 500);
  };

  const addFromCatalog = async (sectionId, item) => {
    const l = await post(`/quotes/${id}/lines`, { section_id: sectionId, item_id: item.id });
    setQ((cur) => ({ ...cur, lines: [...cur.lines, l] }));
    setTimeout(() => pickerRefs.current[sectionId]?.focus(), 30);
  };
  const addFree = async (sectionId, label) => {
    const l = await post(`/quotes/${id}/lines`, { section_id: sectionId, line: { label, to_price: 1, price_ht: 0, labor_rate: Number(settings.default_labor_rate || 45) } });
    setQ((cur) => ({ ...cur, lines: [...cur.lines, l] }));
    setTimeout(() => pickerRefs.current[sectionId]?.focus(), 30);
  };
  const deleteLine = async (lid) => { setQ((cur) => ({ ...cur, lines: cur.lines.filter((l) => l.id !== lid) })); await del(`/lines/${lid}`); };
  const addSection = async () => { const s = await post(`/quotes/${id}/sections`, {}); setQ((cur) => ({ ...cur, sections: [...cur.sections, s] })); };
  const renameSection = (sid, title) => { setQ((cur) => ({ ...cur, sections: cur.sections.map((s) => (s.id === sid ? { ...s, title } : s)) })); clearTimeout(timers.current['s' + sid]); timers.current['s' + sid] = setTimeout(() => put(`/sections/${sid}`, { title }), 500); };
  const deleteSection = async (sid) => { if (!await ask({ title: 'Supprimer cette pièce ?', message: 'La pièce et toutes ses lignes seront supprimées du devis.' })) return; setQ((cur) => ({ ...cur, sections: cur.sections.filter((s) => s.id !== sid), lines: cur.lines.filter((l) => l.section_id !== sid) })); await del(`/sections/${sid}`); };
  const toCatalog = async (l) => { await flushAll(); const it = await post(`/lines/${l.id}/to-catalog`, {}); patchLocalItem(l.id, it); setCatalog((c) => [...c, it]); toast('Ajouté au catalogue (catégorie « À classer »)'); };
  const patchLocalItem = (lid, it) => setQ((cur) => ({ ...cur, lines: cur.lines.map((l) => (l.id === lid ? { ...l, item_id: it.id } : l)) }));

  const openPdf = async () => { await flushAll(); window.dispatchEvent(new CustomEvent('open-pdf', { detail: `/api/quotes/${id}/pdf` })); };
  const prepareSend = async () => {
    await flushAll();
    try { const o = await post(`/quotes/${id}/send`); setSendModal(o); } catch (e) { toast(e.message, 'err'); }
  };
  const confirmSend = async () => {
    try {
      await put(`/outbox/${sendModal.id}`, { subject: sendModal.subject, body: sendModal.body, to_addr: sendModal.to_addr });
      await post(`/outbox/${sendModal.id}/approve`); setSendModal(null); await load(); toast('Devis envoyé au client');
    } catch (e) { toast(e.message, 'err'); }
  };
  const setStatus = async (status) => { setMenu(false); await flushAll(); setQ(await post(`/quotes/${id}/status`, { status })); toast('Statut mis à jour · pipeline synchronisé'); };
  const duplicate = async () => { setMenu(false); await flushAll(); const n = await post(`/quotes/${id}/duplicate`); nav(`/devis/${n.id}`); toast('Copie créée en brouillon'); };
  const avenant = async () => { setMenu(false); const n = await post('/quotes', { project_id: q.project_id, kind: 'avenant', parent_id: q.id, title: `Avenant au ${q.number}` }); nav(`/devis/${n.id}`); };
  const remove = async () => {
    setMenu(false);
    const signed = q.status === 'signe';
    const opts = signed
      ? { title: `Supprimer le devis signé ${q.number} ?`, message: "Ce devis est signé : c'est un document contractuel. À réserver aux devis de TEST.\nL’intervention associé sera supprimé aussi s'il n'a pas d'autre devis. Impossible si des factures numérotées existent. Une sauvegarde est faite avant.", confirmLabel: 'Supprimer définitivement', requireText: 'SUPPRIMER' }
      : q.status === 'brouillon' ? { title: 'Supprimer ce brouillon ?', message: 'Le devis et ses lignes seront supprimés définitivement.' }
      : { title: `Supprimer le devis ${q.number} ?`, message: 'Il a déjà été numéroté : son numéro disparaîtra de la séquence et sera réattribué au prochain devis.\nÀ réserver aux devis de test.', confirmLabel: 'Supprimer le devis' };
    if (!await ask(opts)) return;
    try { await del(`/quotes/${id}${signed ? '?force=1' : ''}`); nav('/devis'); } catch (e) { toast(e.message, 'err'); }
  };

  if (!q) return <div className="p-10 text-stone-400 flex items-center gap-2"><Loader2 className="animate-spin" size={16} /> Chargement…</div>;
  const alert = Number(settings.margin_alert || 20);
  const toPriceCount = q.lines.filter((l) => l.to_price && !(Number(l.price_ht) > 0)).length;
  const internal = view === 'interne';

  return (
    <div className="min-h-full">
      {/* Barre supérieure */}
      <div className="md:sticky top-0 z-20 bg-surface/90 backdrop-blur border-b border-line">
        <div className="px-4 md:px-6 md:h-14 py-3 md:py-0 flex flex-wrap items-center gap-x-3 gap-y-3">
          <Link to="/devis" className="p-1.5 -ml-1.5 rounded-lg hover:bg-stone-100 text-stone-500"><ArrowLeft size={17} /></Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] text-stone-500">
              {q.contact.name === 'À définir'
                ? <button onClick={() => setAttach(true)} className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 font-medium">Client / affaire à choisir →</button>
                : <><Link to={`/contacts/${q.contact.id}`} className="hover:text-accent font-medium">{q.contact.company || q.contact.name}</Link><span>·</span><span className="truncate">{q.project.title}</span>{q.status !== 'signe' && <button onClick={() => setAttach(true)} className="text-accent hover:underline ml-1">changer</button>}</>}
            </div>
            <div className="flex items-center gap-2"><span className="font-semibold">{q.kind === 'avenant' ? 'Avenant' : 'Devis'} {q.number || 'brouillon'}</span><QStatusBadge status={q.status} /></div>
          </div>
          <div className="md:ml-auto w-full md:w-auto flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-stone-400 w-24 text-right hidden lg:block">{saving ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Enregistrement…</span> : <span className="inline-flex items-center gap-1"><Check size={12} className="text-emerald-500" /> Enregistré</span>}</span>
            <div className="hidden sm:flex rounded-lg border border-stone-300 bg-white p-0.5 text-[12.5px]">
              <button onClick={() => setView('interne')} className={cn('px-2.5 h-7 rounded-md flex items-center gap-1.5', internal && 'bg-stone-900 text-white')}><Eye size={13} /> Interne</button>
              <button onClick={() => setView('client')} className={cn('px-2.5 h-7 rounded-md flex items-center gap-1.5', !internal && 'bg-stone-900 text-white')}><EyeOff size={13} /> Vue client</button>
            </div>
            <Btn icon={FileDown} onClick={openPdf}>PDF</Btn>
            {!locked && <Btn icon={Store} onClick={() => setPriceModal({ lines: q.lines.filter((l) => l.to_price && !(Number(l.price_ht) > 0)).map((l) => l.id) })}>Demande de prix</Btn>}
            {!locked && <Btn variant="primary" icon={Send} onClick={prepareSend}>Envoyer au client</Btn>}
            <div className="relative">
              <Btn variant="ghost" onClick={() => setMenu((m) => !m)} className="!px-2"><MoreHorizontal size={17} /></Btn>
              {menu && (
                <div className="absolute right-0 top-10 w-60 bg-white border border-line rounded-xl shadow-xl py-1 pop z-30" onMouseLeave={() => setMenu(false)}>
                  {[
                    { l: 'Dupliquer en brouillon', i: Copy, f: duplicate },
                    q.status === 'signe' && { l: 'Facturer / ouvrir le dossier', i: CheckCircle2, f: () => nav(`/dossier/${q.project_id}`) },
                    q.kind === 'devis' && q.status === 'signe' && { l: 'Créer un avenant', i: GitBranch, f: avenant },
                    q.status !== 'brouillon' && q.status !== 'signe' && { l: 'Marquer comme signé', i: CheckCircle2, f: () => setStatus('signe') },
                    q.status === 'brouillon' && q.number && { l: 'Marquer comme envoyé', i: Send, f: () => setStatus('envoye') },
                    q.status !== 'brouillon' && q.status !== 'refuse' && q.status !== 'signe' && { l: 'Marquer comme refusé', i: XCircle, f: () => setStatus('refuse') },
                    { l: q.status === 'brouillon' ? 'Supprimer le brouillon' : 'Supprimer ce devis', i: Trash2, f: remove, danger: true },
                  ].filter(Boolean).map((a) => (
                    <button key={a.l} onClick={a.f} className={cn('w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-stone-50', a.danger && 'text-rose-600')}><a.i size={14} />{a.l}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 flex gap-6 items-start max-w-[1500px]">
        <div className="flex-1 min-w-0 space-y-4">
          {locked && (
            <div className="flex items-center gap-3 rounded-xl bg-stone-900 text-stone-200 px-4 py-3 text-[13px]">
              <Lock size={15} className="text-orange-300" />
              <span>Ce devis a été émis : il est verrouillé et ne change plus, même si le catalogue évolue.</span>
              <Btn size="sm" className="ml-auto" onClick={duplicate}>Dupliquer pour modifier</Btn>
            </div>
          )}
          <Card className="p-4">
            <div className="grid grid-cols-12 gap-x-4 gap-y-3">
              <Field label="Adresse de l’intervention (sert au calcul du déplacement)" className="col-span-12 md:col-span-8"><Input disabled={locked} value={q.project?.address || ''} onChange={(e) => setQ((cur) => ({ ...cur, project: { ...cur.project, address: e.target.value } }))} onBlur={async (e) => { try { await put(`/projects/${q.project_id}`, { address: e.target.value, city: q.project?.city || '' }); } catch (er) { toast(er.message, 'err'); } }} placeholder="Ex. 12 rue de la Loge" /></Field>
              <Field label="Ville" className="col-span-12 md:col-span-4"><Input disabled={locked} value={q.project?.city || ''} onChange={(e) => setQ((cur) => ({ ...cur, project: { ...cur.project, city: e.target.value } }))} onBlur={async (e) => { try { await put(`/projects/${q.project_id}`, { address: q.project?.address || '', city: e.target.value }); } catch (er) { toast(er.message, 'err'); } }} placeholder="Ex. Montpellier" /></Field>
              <Field label="Objet du devis" className="col-span-12 md:col-span-7"><Input disabled={locked} value={q.title || ''} onChange={(e) => patchMeta({ title: e.target.value })} placeholder="Ex. Ouverture de porte + changement de cylindre – 6 m²" className="font-medium" /></Field>
              <Field label="Validité (jours)" className="col-span-6 md:col-span-2"><Input disabled={locked} type="number" value={q.validity_days} onChange={(e) => patchMeta({ validity_days: Number(e.target.value) })} /></Field>
              <Field label="Acompte (%)" className="col-span-6 md:col-span-3"><Input disabled={locked} type="number" value={q.deposit_rate} onChange={(e) => patchMeta({ deposit_rate: Number(e.target.value) })} /></Field>
              <Field label="Retenue de garantie" className="col-span-12 md:col-span-3"><select disabled={locked} value={q.retention_pct || 0} onChange={(e) => patchMeta({ retention_pct: Number(e.target.value) })} className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 text-[13.5px]"><option value={0}>Aucune</option><option value={5}>5 % (max légal)</option></select></Field>
              <Field label="Aide / prime déduite (ex. MaPrimeRénov')" className="col-span-12 md:col-span-6"><Input disabled={locked} value={q.aid_label || ''} onChange={(e) => patchMeta({ aid_label: e.target.value })} placeholder="MaPrimeRénov', CEE…" /></Field>
              <Field label="Montant de l'aide (€)" className="col-span-12 md:col-span-3"><Input disabled={locked} type="number" min="0" value={q.aid_amount || 0} onChange={(e) => patchMeta({ aid_amount: Number(e.target.value) })} /></Field>
              <Field label="Introduction (visible sur le devis)" className="col-span-12"><Textarea disabled={locked} rows={2} value={q.intro || ''} onChange={(e) => patchMeta({ intro: e.target.value })} placeholder="Rappel du besoin, hypothèses, conditions d'accès…" /></Field>
              <label className="col-span-12 flex items-center gap-2.5 text-[13px] text-stone-700">
                <input type="checkbox" disabled={locked} checked={!!q.photo_auth} onChange={(e) => patchMeta({ photo_auth: e.target.checked ? 1 : 0 })} className="w-4 h-4 accent-orange-700" />
                Autorisé par le client : utilisation des photos avant/après sur le site et les réseaux sociaux
              </label>
            </div>
          </Card>

          {toPriceCount > 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-amber-900 text-[13px]">
              <AlertTriangle size={15} /> {toPriceCount} ligne{toPriceCount > 1 ? 's' : ''} « à chiffrer » : aucun prix n'est inventé, l'envoi est bloqué tant qu'elle{toPriceCount > 1 ? 's sont' : ' est'} sans prix.
              {!locked && <Btn size="sm" className="ml-auto" icon={Store} onClick={() => setPriceModal({ lines: q.lines.filter((l) => l.to_price && !(Number(l.price_ht) > 0)).map((l) => l.id) })}>Demander un prix</Btn>}
            </div>
          )}

          {!locked && sugg.filter((x) => !hidden.has(x.item_id)).length > 0 && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-sky-900"><Sparkles size={14} />Pensez-y <span className="font-normal text-sky-800/70">— souvent associé aux ouvrages de ce devis</span></div>
              <div className="flex flex-wrap gap-2 mt-2.5">
                {sugg.filter((x) => !hidden.has(x.item_id)).map((x) => (
                  <span key={x.item_id} className="inline-flex items-center rounded-lg bg-white border border-sky-200 text-[12.5px] overflow-hidden" title={`Lié à : ${x.because.join(', ')}${x.source === 'appris' ? ` · déjà associé dans ${x.count} devis` : ''}`}>
                    <button onClick={() => addFromCatalog(x.section_id, { id: x.item_id })} className="flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 hover:bg-sky-50"><Plus size={12} className="text-sky-700" /><span className="max-w-[280px] truncate">{x.label}</span><span className="text-stone-400 num">{money(x.price_ht)}</span>{x.source === 'appris' && <span className="text-[10px] uppercase tracking-wide text-stone-400">habituel</span>}</button>
                    <button onClick={() => setHidden((h) => new Set([...h, x.item_id]))} className="px-1.5 self-stretch text-stone-300 hover:text-stone-600 border-l border-sky-100" aria-label="Ignorer"><XCircle size={12} /></button>
                  </span>))}
              </div>
            </div>
          )}

          {q.sections.map((s) => {
            const lines = q.lines.filter((l) => l.section_id === s.id);
            const x = calc.sec[s.id];
            return (
              <Card key={s.id} className="overflow-visible">
                <div className="flex items-center gap-3 px-3 py-2 bg-stone-50 border-b border-line rounded-t-xl">
                  <input disabled={locked} value={s.title} onChange={(e) => renameSection(s.id, e.target.value)} className="cell font-semibold text-[14px] !py-1 max-w-sm" />
                  <span className="ml-auto num font-semibold">{money(x?.total || 0)}</span>
                  {internal && <span className="w-14 text-right"><MarginPill value={x?.margin} threshold={alert} /></span>}
                  {!locked && <button onClick={() => deleteSection(s.id)} className="p-1.5 rounded-md text-stone-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={14} /></button>}
                </div>
                <div className="overflow-x-auto scroll-thin"><div className="min-w-[700px]">
                {lines.length > 0 && (
                  <div className="grid px-2 py-1.5 text-[10.5px] uppercase tracking-wide font-semibold text-stone-400 gap-x-1"
                    style={{ gridTemplateColumns: internal ? COLS_INT : COLS_CLI }}>
                    <div className="pl-2">Désignation</div><div className="text-right pr-2">Qté</div><div>Unité</div>
                    {internal && <><div className="text-right pr-2 text-sky-700">Fourn. €</div><div className="text-right pr-2 text-violet-700">M.O. h</div><div className="text-right pr-2 text-amber-700">S-T €</div></>}
                    <div className="text-right pr-2">P.U. HT</div>
                    {internal ? <><div className="text-right pr-2">Total HT</div><div className="text-right pr-2">Marge %</div></> : <><div className="text-right pr-2">TVA</div><div className="text-right pr-2">Total HT</div></>}
                    <div />
                  </div>
                )}
                {lines.map((l) => (
                  <LineRow key={l.id} l={l} view={view} locked={locked} costLocked={q.status !== 'brouillon' && q.status !== 'signe'} alert={alert} onPatch={(p) => patchLine(l.id, p)} onDelete={() => deleteLine(l.id)} onCatalog={() => toCatalog(l)} onPrice={() => setPriceModal({ lines: [l.id] })} />
                ))}
                </div></div>
                {!locked && <CatalogPicker items={catalog} innerRef={(el) => (pickerRefs.current[s.id] = el)} onPick={(it) => addFromCatalog(s.id, it)} onFree={(label) => addFree(s.id, label)} />}
              </Card>
            );
          })}
          {!locked && <div className="flex gap-2 flex-wrap"><Btn icon={Plus} onClick={addSection}>Ajouter un poste</Btn>
            <Btn icon={Car} loading={travelBusy} onClick={async () => { setTravelBusy(true); try { await flushAll(); const r = await post(`/quotes/${id}/travel`, {}); await load(); toast(`Déplacement ajouté (${r.km ?? ''} km)`); } catch (e) { toast(e.message, 'err'); } finally { setTravelBusy(false); } }}>Ajouter le déplacement</Btn></div>}
          <div className="h-10" />
        </div>

        {internal && (
          <div className="hidden xl:block w-[310px] shrink-0 sticky top-[72px]">
            <ProfitPanel quote={q} calc={calc} settings={settings} />
            {q.price_requests.length > 0 && (
              <Card className="mt-4">
                <div className="px-4 py-2.5 border-b border-line text-[11.5px] font-semibold uppercase tracking-wide text-stone-500">Demandes de prix</div>
                <div className="divide-y divide-line">
                  {q.price_requests.slice(0, 6).map((r) => (
                    <div key={r.id} className="px-4 py-2 text-[12.5px]">
                      <div className="truncate font-medium">{r.label}</div>
                      <div className="flex justify-between text-stone-500"><span>{r.supplier_name}</span><span>{{ a_envoyer: 'À valider (envoi)', envoyee: 'Envoyée', repondue: `Reçu ${money(r.answer_price)}`, validee: 'Appliquée', refusee: 'Refusée' }[r.status]}</span></div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Mobile : résumé */}
      {internal && <div className="xl:hidden px-6 pb-24"><ProfitPanel quote={q} calc={calc} settings={settings} /></div>}

      <PriceRequestModal open={!!priceModal} init={priceModal} q={q} suppliers={suppliers} catalog={catalog}
        onClose={() => setPriceModal(null)}
        onDone={(n) => { setPriceModal(null); load(); toast(`${n} e-mail${n > 1 ? 's' : ''} préparé${n > 1 ? 's' : ''} · en attente de votre validation`, 'ok', { label: 'Valider →', run: () => nav('/validations') }); }} />

      {attach && <AttachModal q={q} onClose={() => setAttach(false)} onDone={(nq) => { setAttach(false); setQ((cur) => ({ ...cur, project: nq.project, contact: nq.contact, project_id: nq.project_id })); toast('Devis rattaché', 'ok'); }} />}

      <Modal open={!!sendModal} onClose={() => setSendModal(null)} title="Vérifier avant envoi" width={640}
        footer={<><Btn onClick={() => { setSendModal(null); toast('Gardé dans la file de validation', 'ok', { label: 'Ouvrir', run: () => nav('/validations') }); }}>Valider plus tard</Btn><Btn variant="primary" icon={Send} onClick={confirmSend}>Valider et envoyer</Btn></>}>
        {sendModal && (
          <div className="space-y-3">
            <div className="rounded-lg bg-stone-50 border border-line p-3 text-[12.5px] flex flex-wrap gap-x-6 gap-y-1">
              <span>Total TTC <b className="num">{money(calc.t.ttc)}</b></span>
              <span>Bénéfice <b className="num">{calc.t.costed ? money(calc.t.profit) : '—'}</b> ({pct(calc.t.margin)})</span>
              <span className="text-stone-400">Les coûts et marges ne figurent jamais dans le PDF client.</span>
            </div>
            <Field label="Destinataire"><Input value={sendModal.to_addr} onChange={(e) => setSendModal({ ...sendModal, to_addr: e.target.value })} /></Field>
            <Field label="Objet"><Input value={sendModal.subject} onChange={(e) => setSendModal({ ...sendModal, subject: e.target.value })} /></Field>
            <Field label="Message"><Textarea rows={9} value={sendModal.body} onChange={(e) => setSendModal({ ...sendModal, body: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PriceRequestModal({ open, init, q, suppliers, catalog, onClose, onDone }) {
  const [lines, setLines] = useState([]); const [sups, setSups] = useState([]); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setLines(init.lines); setMsg(''); setErr('');
    const pref = new Set();
    for (const lid of init.lines) { const l = q.lines.find((x) => x.id === lid); const it = catalog.find((c) => c.id === l?.item_id); if (it?.supplier_id) pref.add(it.supplier_id); }
    setSups([...pref]);
  }, [open]); // eslint-disable-line
  const tog = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await post(`/quotes/${q.id}/price-requests`, { line_ids: lines, supplier_ids: sups, message: msg }); onDone(r.outbox_ids.length); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Demande de prix aux fournisseurs" width={620}
      footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" icon={Send} loading={busy} disabled={!lines.length || !sups.length} onClick={submit}>Préparer {sups.length || ''} e-mail{sups.length > 1 ? 's' : ''}</Btn></>}>
      <p className="text-stone-500 mb-4">Chaque fournisseur reçoit un lien unique pour répondre (référence, prix, délai). Rien ne part sans votre validation, et sa réponse ne modifie le catalogue qu'après votre accord.</p>
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <div className="text-[12px] font-medium text-stone-600 mb-1.5">Lignes concernées</div>
          <div className="border border-line rounded-lg max-h-64 overflow-auto divide-y divide-line scroll-thin">
            {q.lines.map((l) => (
              <label key={l.id} className="flex items-start gap-2.5 p-2.5 cursor-pointer hover:bg-stone-50">
                <input type="checkbox" checked={lines.includes(l.id)} onChange={() => tog(lines, setLines, l.id)} className="mt-0.5 accent-orange-700" />
                <span className="flex-1 leading-snug">{l.label}{l.to_price ? <span className="ml-1.5 text-[11px] text-amber-700 font-semibold">à chiffrer</span> : null}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[12px] font-medium text-stone-600 mb-1.5">Fournisseurs</div>
          <div className="border border-line rounded-lg max-h-64 overflow-auto divide-y divide-line scroll-thin">
            {suppliers.map((s) => (
              <label key={s.id} className="flex items-center gap-2.5 p-2.5 cursor-pointer hover:bg-stone-50">
                <input type="checkbox" checked={sups.includes(s.id)} onChange={() => tog(sups, setSups, s.id)} className="accent-orange-700" />
                <span className="flex-1"><span className="block">{s.name}</span><span className="text-[11.5px] text-stone-400">{s.email || 'pas d\'e-mail'}</span></span>
              </label>
            ))}
            {suppliers.length === 0 && <div className="p-4 text-stone-400 text-center">Aucun fournisseur. Créez-en dans Contacts.</div>}
          </div>
        </div>
      </div>
      <Field label="Message complémentaire (optionnel)" className="mt-4"><Textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Délai souhaité, lieu de livraison, quantité à confirmer…" /></Field>
      {err && <div className="mt-3 text-rose-700 text-[13px]">{err}</div>}
    </Modal>
  );
}
