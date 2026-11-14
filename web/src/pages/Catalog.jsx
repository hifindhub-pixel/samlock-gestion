import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, History, Upload, Download, Trash2 } from 'lucide-react';
import { api, get, post, put, del } from '../lib/api.js';
import { money, pct, dateFr, num } from '../lib/format.js';
import { ask, Btn, Card, Drawer, Empty, Field, Input, MarginPill, NumInput, PageHeader, Select, useFetch, useToast, cn, SearchBox, useSort } from '../lib/ui.jsx';

const costOf = (i) => (Number(i.cost_material) || 0) + (Number(i.labor_hours) || 0) * (Number(i.labor_rate) || 0) + (Number(i.cost_sub) || 0);
const marginOf = (i) => (i.price_ht > 0 ? ((i.price_ht - costOf(i)) / i.price_ht) * 100 : null);

function CostBar({ i }) {
  const m = Number(i.cost_material) || 0, l = (Number(i.labor_hours) || 0) * (Number(i.labor_rate) || 0), s = Number(i.cost_sub) || 0, t = m + l + s || 1;
  return <div className="flex h-1.5 w-20 rounded-full overflow-hidden bg-stone-100" title={`Fourniture ${money(m)} · M.O. ${money(l)} · Sous-traitance ${money(s)}`}><i className="bg-sky-500" style={{ width: `${(m / t) * 100}%` }} /><i className="bg-violet-500" style={{ width: `${(l / t) * 100}%` }} /><i className="bg-amber-500" style={{ width: `${(s / t) * 100}%` }} /></div>;
}

export default function Catalog() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || ''); const [cat, setCat] = useState('all');
  const { data, reload } = useFetch(() => get(`/catalog?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}`), [q, cat]);
  const sort = useSort(data?.rows || [], { ref: (i) => i.ref, label: (i) => i.label, unit: (i) => i.unit, cost: costOf, price: (i) => i.price_ht, margin: marginOf, vat: (i) => i.vat, supplier: (i) => i.supplier_name, updated: (i) => i.updated_at });
  const { data: sup } = useFetch(() => get('/contacts?kind=fournisseur'));
  const [sel, setSel] = useState(null); const [imp, setImp] = useState(false);
  useEffect(() => { if (params.get('new') === '1') { setSel({ label: '', unit: 'u', vat: 10, cost_material: 0, labor_hours: 0, labor_rate: 45, cost_sub: 0, price_ht: 0, category: '' }); setParams({}); } }, [params]); // eslint-disable-line
  return (
    <div>
      <PageHeader title="Catalogue" subtitle="Vos ouvrages et fournitures avec leur coût, leur marge et l'historique des prix. Un devis émis ne change jamais."
        actions={<><Btn icon={Upload} onClick={() => setImp(true)}>Importer</Btn><Btn variant="primary" icon={Plus} onClick={() => setSel({ label: '', unit: 'u', vat: 10, cost_material: 0, labor_hours: 0, labor_rate: 45, cost_sub: 0, price_ht: 0, category: '' })}>Nouvel article</Btn></>} />
      <div className="px-8 pb-10">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex gap-1 flex-wrap">{['all', ...(data?.categories || [])].map((c) => <button key={c} onClick={() => setCat(c)} className={cn('px-3 h-8 rounded-lg text-[13px] font-medium', cat === c ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100')}>{c === 'all' ? 'Tout' : c}</button>)}</div>
          <SearchBox className="ml-auto" value={q} onChange={setQ} placeholder="Désignation ou référence…" />
        </div>
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead><tr className="text-left text-[11.5px] text-stone-400 border-b border-line">{sort.th('ref', 'Réf.', { className: 'px-4 py-2.5 w-20' })}{sort.th('label', 'Désignation')}{sort.th('unit', 'Unité')}{sort.th('cost', 'Coût de revient')}{sort.th('price', 'Prix HT', { right: true, className: 'text-right' })}{sort.th('margin', 'Marge', { right: true, className: 'text-right' })}{sort.th('vat', 'TVA', { right: true, className: 'text-right' })}{sort.th('supplier', 'Fournisseur')}{sort.th('updated', 'Mis à jour', { right: true, className: 'pr-4 text-right' })}</tr></thead>
            <tbody>
              {sort.rows.map((i) => (
                <tr key={i.id} onClick={() => setSel(i)} className="border-b border-line/70 hover:bg-orange-50/40 cursor-pointer">
                  <td className="px-4 py-2.5 text-stone-400 text-[12px]">{i.ref}</td>
                  <td><div className="font-medium leading-snug max-w-[460px]">{i.label}{i.n_components > 0 && <span className="ml-2 align-middle text-[10.5px] font-semibold uppercase tracking-wide bg-stone-900 text-white rounded px-1.5 py-0.5">Ouvrage</span>}</div><div className="text-[11.5px] text-stone-400">{i.category}</div></td>
                  <td className="text-stone-500">{i.unit}</td>
                  <td><div className="num font-medium">{money(costOf(i))}</div><CostBar i={i} /></td>
                  <td className="text-right num font-semibold">{money(i.price_ht)}</td><td className="text-right"><MarginPill value={marginOf(i)} /></td>
                  <td className="text-right num text-stone-500">{num(i.vat)} %</td><td className="text-stone-500 text-[12.5px]">{i.supplier_name}</td><td className="pr-4 text-right text-stone-400 text-[12px]">{dateFr(i.updated_at)}</td>
                </tr>))}
            </tbody>
          </table>
          {data?.rows.length === 0 && <Empty title="Aucun article">Aucun résultat pour ce filtre.</Empty>}
        </Card>
        <div className="flex gap-4 mt-3 text-[12px] text-stone-500"><span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-sky-500" />Fourniture</span><span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-violet-500" />Main-d'œuvre</span><span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-amber-500" />Sous-traitance</span><span className="ml-auto">Marge = (prix de vente − coût de revient) ÷ prix de vente</span></div>
      </div>
      <ImportDrawer open={imp} onClose={() => setImp(false)} onDone={() => { setImp(false); reload(); }} />
      <ItemDrawer onChanged={reload} item={sel} suppliers={sup?.rows || []} categories={data?.categories || []} onClose={() => setSel(null)} onSaved={() => { setSel(null); reload(); }} />
    </div>
  );
}

function ItemDrawer({ item, suppliers, categories, onClose, onSaved, onChanged }) {
  const [f, setF] = useState(null); const [hist, setHist] = useState([]); const [busy, setBusy] = useState(false); const toast = useToast();
  useEffect(() => { setF(item ? { ...item } : null); setHist([]); if (item?.id) get(`/catalog/${item.id}/history`).then(setHist); }, [item]);
  if (!f) return <Drawer open={false} />;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const cost = costOf(f); const m = marginOf(f);
  const setMargin = (mg) => setF((x) => ({ ...x, price_ht: Math.round((costOf(x) / (1 - Math.min(mg, 95) / 100)) * 100) / 100 }));
  const save = async () => {
    setBusy(true);
    try { f.id ? await put(`/catalog/${f.id}`, f) : await post('/catalog', f); toast('Article enregistré'); onSaved(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const archive = async () => { if (!await ask({ title: 'Retirer cet article ?', message: 'Les devis existants ne changent pas.', confirmLabel: 'Retirer' })) return; await del(`/catalog/${f.id}`); onSaved(); };
  return (
    <Drawer open title={f.id ? 'Modifier l\'article' : 'Nouvel article'} width={540} onClose={onClose}
      footer={<>{f.id && <Btn variant="danger" onClick={archive} className="mr-auto">Retirer</Btn>}<Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" loading={busy} disabled={!f.label?.trim()} onClick={save}>Enregistrer</Btn></>}>
      <div className="space-y-4">
        <Field label="Désignation"><Input autoFocus value={f.label} onChange={(e) => set('label', e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Référence"><Input value={f.ref || ''} onChange={(e) => set('ref', e.target.value)} /></Field>
          <Field label="Catégorie"><Input list="cats" value={f.category || ''} onChange={(e) => set('category', e.target.value)} /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Unité"><Input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="u, h, forfait" /></Field>
        </div>
        <Field label="Fournisseur"><Select value={f.supplier_id || ''} onChange={(e) => set('supplier_id', e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>

        <div className="rounded-xl border border-line p-4 space-y-3 bg-stone-50/50">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-stone-500">Coût de revient par unité</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Fourniture (€)"><NumInput value={f.cost_material} onChange={(v) => set('cost_material', v)} className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 num text-right outline-none focus:border-accent focus:ring-3 focus:ring-orange-200/70" /></Field>
            <Field label="Main-d'œuvre (h)"><NumInput value={f.labor_hours} onChange={(v) => set('labor_hours', v)} className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 num text-right outline-none focus:border-accent focus:ring-3 focus:ring-orange-200/70" /></Field>
            <Field label="Taux horaire (€/h)"><NumInput value={f.labor_rate} onChange={(v) => set('labor_rate', v)} className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 num text-right outline-none focus:border-accent focus:ring-3 focus:ring-orange-200/70" /></Field>
            <Field label="Sous-traitance (€)" className="col-span-3 sm:col-span-1"><NumInput value={f.cost_sub} onChange={(v) => set('cost_sub', v)} className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 num text-right outline-none focus:border-accent focus:ring-3 focus:ring-orange-200/70" /></Field>
          </div>
          <div className="flex justify-between pt-2 border-t border-line"><span className="text-stone-500">Coût de revient</span><span className="num font-semibold">{money(cost)}</span></div>
        </div>

        <div className="grid grid-cols-3 gap-3 items-end">
          <Field label="Marge (%)"><NumInput value={m == null ? '' : Math.round(m * 10) / 10} onChange={setMargin} className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 num text-right outline-none focus:border-accent focus:ring-3 focus:ring-orange-200/70" /></Field>
          <Field label="Prix de vente HT (€)"><NumInput value={f.price_ht} onChange={(v) => set('price_ht', v)} className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 num text-right font-semibold outline-none focus:border-accent focus:ring-3 focus:ring-orange-200/70" /></Field>
          <Field label="TVA"><Select value={f.vat} onChange={(e) => set('vat', Number(e.target.value))}><option value={20}>20 %</option><option value={10}>10 %</option><option value={5.5}>5,5 %</option></Select></Field>
        </div>
        <div className="rounded-lg border border-line p-3 space-y-3">
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={!!f.track_stock} onChange={(e) => set('track_stock', e.target.checked ? 1 : 0)} /> Suivre le stock de cet article</label>
          {!!f.track_stock && <div className="grid grid-cols-3 gap-3">
            <Field label="Stock minimum"><NumInput value={f.stock_min || 0} onChange={(v) => set('stock_min', v)} className="w-full h-9 rounded-lg border border-stone-300 px-2 text-right num" /></Field>
            <Field label="Stock cible"><NumInput value={f.stock_target || 0} onChange={(v) => set('stock_target', v)} className="w-full h-9 rounded-lg border border-stone-300 px-2 text-right num" /></Field>
            <Field label="Emplacement"><Input value={f.stock_location || ''} onChange={(e) => set('stock_location', e.target.value)} placeholder="Camion – bac A" /></Field>
            <Field label="Marque"><Input value={f.brand || ''} onChange={(e) => set('brand', e.target.value)} /></Field>
            <Field label="Réf. fournisseur (AFDB…)" className="col-span-2"><Input value={f.supplier_ref || ''} onChange={(e) => set('supplier_ref', e.target.value)} placeholder="N° chrono / référence du fournisseur" /></Field>
            <div className="col-span-3 text-[12px] text-stone-500">Quantités : utilisez la page Stock (réceptions, inventaire, casse).</div>
          </div>}
        </div>
        <div className="text-[12.5px] text-stone-500">Bénéfice par unité : <b className="num text-stone-800">{money(f.price_ht - cost)}</b> · <MarginPill value={m} /></div>

        {f.id && !f.track_stock && <Parts f={f} toast={toast} onChanged={onChanged} />}
        {f.id && <Composition f={f} setF={setF} onChanged={onChanged} toast={toast} />}
        {f.id && <Links f={f} toast={toast} />}

        {f.id && (
          <div>
            <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-stone-500 mb-2"><History size={13} /> Historique des prix</div>
            <div className="border border-line rounded-lg divide-y divide-line">
              {hist.map((h) => <div key={h.id} className="px-3 py-2 flex items-center text-[12.5px]"><span className="text-stone-400 w-28">{dateFr(h.changed_at)}</span><span className="text-stone-500 flex-1">{h.note}</span><span className="num text-stone-500 mr-4">coût {money(h.cost_total)}</span><span className="num font-semibold w-20 text-right">{money(h.price_ht)}</span></div>)}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function ImportDrawer({ open, onClose, onDone }) {
  const [prev, setPrev] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => { if (open) { setPrev(null); setErr(''); } }, [open]);
  const pick = async (file) => {
    if (!file) return; setBusy(true); setErr(''); setPrev(null);
    try { const form = new FormData(); form.append('file', file); setPrev(await api('/catalog/import/preview', { method: 'POST', form })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try { const r = await post('/catalog/import/commit', { rows: prev.rows }); toast(`${r.created} créé(s), ${r.updated} mis à jour${r.suppliersCreated ? `, ${r.suppliersCreated} fournisseur(s) ajouté(s)` : ''}`); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const clear = async () => {
    if (!await ask({ title: 'Effacer toutes les données ?', message: 'Contacts, devis, interventions, factures et catalogue seront supprimés. Les réglages de l\'entreprise sont conservés. Action irréversible.', confirmLabel: 'Tout effacer', requireText: 'EFFACER' })) return;
    try { await post('/admin/clear-data', { confirm: 'EFFACER' }); toast('Données effacées'); onDone(); } catch (e) { setErr(e.message); }
  };
  const ok = prev ? prev.summary.create + prev.summary.update : 0;
  return (
    <Drawer open={open} title="Importer le catalogue" width={760} onClose={onClose}
      footer={<><Btn variant="danger" icon={Trash2} onClick={clear} className="mr-auto">Repartir de zéro</Btn><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" loading={busy} disabled={!ok} onClick={run}>Importer {ok ? `${ok} article${ok > 1 ? 's' : ''}` : ''}</Btn></>}>
      <div className="space-y-4">
        <p className="text-[13px] text-stone-600">Déposez votre fichier Excel (.xlsx) ou CSV. Rien n'est enregistré avant votre validation : vous voyez d'abord ce qui sera créé, mis à jour ou refusé.</p>
        <div className="flex gap-2 items-center">
          <label className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg bg-accent text-white text-[13px] font-medium cursor-pointer hover:opacity-90"><Upload size={14} />Choisir un fichier<input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} /></label>
          <a href="/api/catalog/template.xlsx" className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-stone-300 text-[13px] font-medium hover:bg-stone-50"><Download size={14} />Modèle Excel</a>
          {busy && <span className="text-[12.5px] text-stone-500">Analyse…</span>}
        </div>
        {err && <div className="rounded-lg bg-red-50 text-red-700 text-[13px] px-3 py-2">{err}</div>}
        {prev && (<>
          <div className="flex gap-4 text-[13px]"><b>{prev.summary.total} lignes</b><span className="text-emerald-700">{prev.summary.create} à créer</span><span className="text-sky-700">{prev.summary.update} à mettre à jour</span><span className={prev.summary.error ? 'text-red-700' : 'text-stone-400'}>{prev.summary.error} refusée(s)</span></div>
          <div className="border border-line rounded-lg overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-stone-400 bg-stone-50"><th className="px-3 py-2 w-10">L.</th><th>Désignation</th><th>Action</th><th className="text-right pr-3">Prix HT</th><th>Remarques</th></tr></thead>
              <tbody>{prev.rows.map((r) => (
                <tr key={r.line} className="border-t border-line align-top">
                  <td className="px-3 py-2 text-stone-400">{r.line}</td>
                  <td className="py-2 pr-2"><div className="font-medium">{r.label || '—'}</div><div className="text-stone-400">{[r.ref, r.category, r.supplier].filter(Boolean).join(' · ')}</div></td>
                  <td className="py-2"><span className={cn('px-2 py-0.5 rounded-full text-[11.5px] font-medium', r.action === 'création' && 'bg-emerald-50 text-emerald-700', r.action === 'mise à jour' && 'bg-sky-50 text-sky-700', r.action === 'erreur' && 'bg-red-50 text-red-700')}>{r.action}</span></td>
                  <td className="py-2 pr-3 text-right num">{r.price_ht != null ? money(r.price_ht) : r.margin_rate != null ? `marge ${num(r.margin_rate)} %` : '—'}</td>
                  <td className="py-2 pr-3 text-[12px]">{r.errors.map((e) => <div key={e} className="text-red-700">{e}</div>)}{r.warnings.map((w) => <div key={w} className="text-stone-500">{w}</div>)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>)}
      </div>
    </Drawer>
  );
}

/** Composition d'un ouvrage : liste d'articles (quantité par unité d'ouvrage). Coût et prix se recalculent. */
function Links({ f, toast }) {
  const [links, setLinks] = useState(null); const [all, setAll] = useState([]);
  useEffect(() => { get(`/catalog/${f.id}/links`).then(setLinks); get('/catalog').then((d) => setAll(d.rows)); }, [f.id]);
  if (!links) return null;
  const save = async (next) => { try { const r = await api(`/catalog/${f.id}/links`, { method: 'PUT', body: { linked: next.map((x) => x.id) } }); setLinks(r); } catch (e) { toast(e.message, 'err'); } };
  const options = all.filter((i) => i.id !== f.id && !links.some((l) => l.id === i.id));
  return (
    <div className="rounded-xl border border-line p-4 space-y-3">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-stone-500">Ouvrages liés — « pensez-y »</div>
      <div className="text-[12.5px] text-stone-500">Quand cet article est ajouté à un devis, ceux-ci sont proposés pour ne rien oublier (ex. dépose → évacuation des gravats). Les associations fréquentes de vos devis sont aussi proposées automatiquement.</div>
      {links.map((l) => <div key={l.id} className="flex items-center gap-2 text-[13px]"><span className="flex-1 truncate">{l.label}</span><span className="num text-stone-400 text-[12px]">{money(l.price_ht)} / {l.unit}</span><button className="text-stone-400 hover:text-rose-600" onClick={() => save(links.filter((x) => x.id !== l.id))}><Trash2 size={14} /></button></div>)}
      <Select value="" onChange={(e) => { const it = all.find((i) => i.id === Number(e.target.value)); if (it) save([...links, it]); }}><option value="">+ Lier un article…</option>{options.map((i) => <option key={i.id} value={i.id}>{i.label} ({i.unit})</option>)}</Select>
    </div>
  );
}

function Composition({ f, setF, onChanged, toast }) {
  const [comps, setComps] = useState(null); const [all, setAll] = useState([]); const [add, setAdd] = useState(''); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  useEffect(() => { setDirty(false); get(`/catalog/${f.id}/components`).then((c) => setComps(c.map((x) => ({ ...x })))); get('/catalog').then((d) => setAll(d.rows)); }, [f.id]);
  if (!comps) return null;
  const options = all.filter((i) => i.id !== f.id && !i.n_components && !comps.some((c) => c.child_id === i.id));
  const upd = (id, qty) => { setComps(comps.map((c) => (c.child_id === id ? { ...c, qty } : c))); setDirty(true); };
  const tot = comps.reduce((s, c) => s + (Number(String(c.qty).replace(',', '.')) || 0) * c.price_ht, 0);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api(`/catalog/${f.id}/components`, { method: 'PUT', body: { components: comps.map((c) => ({ child_id: c.child_id, qty: c.qty })) } });
      setF((x) => ({ ...x, ...r.item })); setComps(r.components.map((x) => ({ ...x }))); setDirty(false); onChanged?.(); toast('Composition enregistrée');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-line p-4 space-y-3">
      <div className="flex items-center"><div className="text-[11.5px] font-semibold uppercase tracking-wide text-stone-500">Composition (ouvrage)</div>{comps.length > 0 && <span className="ml-auto text-[12px] text-stone-400 num">Σ composants {money(tot)}</span>}</div>
      {comps.length === 0 && <div className="text-[12.5px] text-stone-500">Composez cet article à partir d'autres articles : son coût et son prix HT seront calculés automatiquement et suivront les prix de ses composants.</div>}
      {comps.map((c) => (
        <div key={c.child_id} className="flex items-center gap-2 text-[13px]">
          <div className="flex-1 min-w-0"><div className="truncate">{c.label}</div><div className="text-[11.5px] text-stone-400 num">{money(c.price_ht)} / {c.unit}</div></div>
          <div className="w-20"><NumInput value={c.qty} onChange={(v) => upd(c.child_id, v)} className="w-full h-8 rounded-lg border border-stone-300 bg-white px-2 num text-right outline-none focus:border-accent" /></div><span className="text-[12px] text-stone-400 w-8">{c.unit}</span>
          <button className="text-stone-400 hover:text-rose-600" onClick={() => { setComps(comps.filter((x) => x.child_id !== c.child_id)); setDirty(true); }}><Trash2 size={14} /></button>
        </div>))}
      <div className="flex gap-2">
        <Select value={add} onChange={(e) => { const it = all.find((i) => i.id === Number(e.target.value)); if (it) { setComps([...comps, { child_id: it.id, qty: 1, label: it.label, unit: it.unit, price_ht: it.price_ht }]); setDirty(true); } setAdd(''); }}>
          <option value="">+ Ajouter un composant…</option>{options.map((i) => <option key={i.id} value={i.id}>{i.label} ({i.unit})</option>)}
        </Select>
        {dirty && <Btn variant="primary" loading={busy} onClick={save}>Appliquer</Btn>}
      </div>
      {comps.length > 0 && !dirty && <div className="text-[12px] text-stone-500">Prix et coût recalculés automatiquement. Dans un devis, la ligne affichera « Comprend : … ».</div>}
    </div>
  );
}

/** Pièces du stock consommées par un article vendu : à l'émission d'une facture, ces pièces sortent du stock. */
function Parts({ f, toast, onChanged }) {
  const [parts, setParts] = useState(null); const [all, setAll] = useState([]); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { setDirty(false); get(`/catalog/${f.id}/parts`).then(setParts); get('/stock').then((d) => setAll(d.rows)); }, [f.id]);
  if (!parts) return null;
  const options = all.filter((i) => !parts.some((p) => p.part_id === i.id));
  const save = async () => {
    setBusy(true);
    try { setParts(await api(`/catalog/${f.id}/parts`, { method: 'PUT', body: { parts: parts.map((p) => ({ part_id: p.part_id, qty: p.qty })) } })); setDirty(false); onChanged?.(); toast('Pièces enregistrées'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-line p-4 space-y-3">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-stone-500">Pièces consommées (sortie de stock)</div>
      {parts.length === 0 && <div className="text-[12.5px] text-stone-500">Indiquez la ou les pièces du stock utilisées par cette prestation : chaque facture émise les fera sortir automatiquement.</div>}
      {parts.map((p) => (
        <div key={p.part_id} className="flex items-center gap-2 text-[13px]">
          <div className="flex-1 min-w-0"><div className="truncate">{p.label}</div><div className="text-[11.5px] text-stone-400 num">{p.ref} · en stock {num(p.stock_qty)}</div></div>
          <div className="w-20"><NumInput value={p.qty} onChange={(v) => { setParts(parts.map((x) => (x.part_id === p.part_id ? { ...x, qty: v } : x))); setDirty(true); }} className="w-full h-8 rounded-lg border border-stone-300 bg-white px-2 num text-right outline-none focus:border-accent" /></div>
          <button className="text-stone-400 hover:text-rose-600" onClick={() => { setParts(parts.filter((x) => x.part_id !== p.part_id)); setDirty(true); }}><Trash2 size={14} /></button>
        </div>))}
      <div className="flex gap-2">
        <Select value="" onChange={(e) => { const it = all.find((i) => i.id === Number(e.target.value)); if (it) { setParts([...parts, { part_id: it.id, qty: 1, label: it.label, ref: it.ref, stock_qty: it.stock_qty }]); setDirty(true); } }}>
          <option value="">+ Ajouter une pièce du stock…</option>{options.map((i) => <option key={i.id} value={i.id}>{i.ref} — {i.label}</option>)}
        </Select>
        {dirty && <Btn variant="primary" loading={busy} onClick={save}>Appliquer</Btn>}
      </div>
    </div>
  );
}
