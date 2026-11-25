import { useMemo, useState } from 'react';
import { ArrowDownToLine, Boxes, History, Mail, PackagePlus, TriangleAlert } from 'lucide-react';
import { get, post, put } from '../lib/api.js';
import { Badge, Btn, Card, Chips, Empty, Field, Input, Modal, NumInput, PageHeader, SearchBox, Select, Textarea, matches, useFetch, useToast, cn } from '../lib/ui.jsx';
import { money, dateFr, num } from '../lib/format.js';

const ST = { ok: ['OK', 'bg-emerald-50 text-emerald-700'], bas: ['Stock bas', 'bg-amber-50 text-amber-700'], rupture: ['Rupture', 'bg-rose-50 text-rose-700'] };
const KIND_SIGN = { entree: '+', retour: '+', sortie: '−', perte: '−' };

export default function Stock() {
  const toast = useToast();
  const [all, setAll] = useState(false); const [q, setQ] = useState(''); const [f, setF] = useState('tous');
  const { data, reload } = useFetch(() => get(`/stock${all ? '?all=1' : ''}`), [all]);
  const { data: reorder, reload: reloadReorder } = useFetch(() => get('/stock/reorder'));
  const [mv, setMv] = useState(null); const [hist, setHist] = useState(null); const [cfg, setCfg] = useState(null); const [ord, setOrd] = useState(null); const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (data?.rows || []).filter((r) => (f === 'tous' || (f === 'alertes' ? r.track_stock && r.status !== 'ok' : r.status === f)) && matches(r, q, (x) => `${x.label} ${x.ref} ${x.brand} ${x.category} ${x.stock_location} ${x.supplier_name}`)), [data, q, f]);
  if (!data) return null;
  const t = data.totals;

  const submitMove = async () => {
    setBusy(true);
    try { await post('/stock/moves', { item_id: mv.item.id, kind: mv.kind, qty: mv.qty, unit_cost: mv.kind === 'entree' && mv.unit_cost !== '' ? mv.unit_cost : null, supplier_id: mv.supplier_id || null, note: mv.note }); setMv(null); await reload(); await reloadReorder(); toast('Mouvement enregistré'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const saveCfg = async () => {
    setBusy(true);
    try { await put(`/stock/items/${cfg.id}`, { track_stock: cfg.track_stock, stock_min: cfg.stock_min, stock_target: cfg.stock_target, stock_location: cfg.stock_location, brand: cfg.brand }); setCfg(null); await reload(); await reloadReorder(); toast('Article mis à jour'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const importAfdb = async () => {
    setBusy(true);
    try { const r = await post('/stock/import-afdb', {}); const v = await post('/stock/import-tiime', {}); const f = await post('/import-tiime-invoices', {}); await reload(); toast(r.entries || v.sorties || f.created ? `Historique repris : ${r.entries} entrées AFDB (${r.created} pièces créées), ${v.sorties} sorties de ventes Tiime, ${v.prices} prix de vente, ${f.created} factures Tiime (${f.trips} trajets IK).` : 'Historique déjà repris.'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const openHist = async (it) => setHist({ it, rows: await get(`/stock/moves?item_id=${it.id}&limit=60`) });
  const sendOrder = async () => {
    setBusy(true);
    try { await post('/stock/reorder/email', { supplier_id: ord.supplier_id, lines: ord.items.map((i) => ({ item_id: i.id, qty: i.qty })).filter((l) => Number(l.qty) > 0), message: ord.message }); setOrd(null); toast('Commande préparée : à valider dans « Validations »'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="pb-10">
      <PageHeader title="Stock" subtitle="Pièces du camion et du dépôt : les sorties se font toutes seules à l’émission des factures."
        actions={<><Btn icon={ArrowDownToLine} onClick={() => { window.location.href = '/api/stock/export.xlsx'; }}>Exporter Excel</Btn><Btn icon={ArrowDownToLine} onClick={importAfdb} disabled={busy}>Reprendre l’historique (achats AFDB, ventes et factures Tiime)</Btn><Btn icon={PackagePlus} variant="primary" onClick={() => { const it = data.rows.find((r) => r.track_stock); if (it) setMv({ item: it, kind: 'entree', qty: '', unit_cost: '', supplier_id: it.supplier_id || '', note: '' }); }}>Réception de matériel</Btn></>} />
      <div className="px-8 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4"><div className="text-[12px] text-stone-500">Valeur du stock (prix d’achat)</div><div className="text-xl font-semibold num">{money(t.valuation)}</div></Card>
          <Card className="p-4"><div className="text-[12px] text-stone-500">Références suivies</div><div className="text-xl font-semibold num">{t.items}</div></Card>
          <Card className="p-4"><div className="text-[12px] text-stone-500">Stock bas</div><div className={cn('text-xl font-semibold num', t.low && 'text-amber-600')}>{t.low}</div></Card>
          <Card className="p-4"><div className="text-[12px] text-stone-500">Ruptures</div><div className={cn('text-xl font-semibold num', t.out && 'text-rose-600')}>{t.out}</div></Card>
        </div>

        {reorder?.length > 0 && (
          <Card className="p-5 border-amber-200 bg-amber-50/40">
            <div className="flex items-center gap-2 font-semibold mb-3"><TriangleAlert size={16} className="text-amber-600" /> À recommander</div>
            <div className="grid md:grid-cols-2 gap-3">
              {reorder.map((g) => (
                <div key={g.supplier_id || 0} className="bg-white border border-line rounded-lg p-3">
                  <div className="flex items-center"><div className="font-medium">{g.supplier_name}</div>
                    {g.supplier_id && <Btn size="sm" icon={Mail} className="ml-auto" disabled={!g.supplier_email} title={g.supplier_email ? '' : 'Pas d’e-mail pour ce fournisseur'} onClick={() => setOrd({ supplier_id: g.supplier_id, name: g.supplier_name, items: g.items.map((i) => ({ id: i.id, label: i.label, ref: i.ref, qty: i.suggested })), message: '' })}>Préparer la commande</Btn>}</div>
                  <ul className="mt-2 text-[13px] text-stone-600 space-y-0.5">{g.items.map((i) => <li key={i.id}><span className="font-medium text-stone-800">{i.label}</span> — stock {num(i.stock_qty)} (mini {num(i.stock_min)}) → commander {num(i.suggested)}</li>)}</ul>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={q} onChange={setQ} placeholder="Article, marque, emplacement…" className="w-72" />
          <Chips value={f} onChange={setF} options={[['tous', 'Tous'], ['alertes', 'Alertes'], ['ok', 'OK']]} />
          <label className="ml-auto flex items-center gap-2 text-[13px] text-stone-600"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Afficher aussi les articles non suivis</label>
        </div>

        {rows.length === 0 ? <Card><Empty icon={Boxes} title="Aucun article">Activez le suivi de stock sur un article du catalogue pour le voir ici.</Empty></Card> : (
          <Card className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead><tr className="text-left text-stone-400 text-[12px] border-b border-line"><th className="p-3">Article</th><th>Emplacement</th><th className="text-right">En stock</th><th className="text-right">Réservé</th><th className="text-right">Mini / cible</th><th className="text-right">Valeur</th><th>État</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-stone-50/60">
                    <td className="p-3"><div className="font-medium">{r.label}</div><div className="text-[12px] text-stone-400">{[r.ref, r.supplier_ref && `AFDB ${r.supplier_ref}`, r.brand].filter(Boolean).join(' · ')}</div></td>
                    <td className="text-stone-600">{r.track_stock ? (r.stock_location || '—') : <span className="text-stone-400">non suivi</span>}</td>
                    <td className="text-right num font-semibold">{r.track_stock ? num(r.stock_qty) : '—'}</td>
                    <td className="text-right num text-stone-500">{r.reserved > 0 ? num(r.reserved) : '—'}</td>
                    <td className="text-right num text-stone-500">{r.track_stock ? `${num(r.stock_min)} / ${num(r.stock_target)}` : '—'}</td>
                    <td className="text-right num">{r.track_stock ? money(r.value) : '—'}</td>
                    <td>{r.track_stock && <Badge className={ST[r.status][1]}>{ST[r.status][0]}</Badge>}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {r.track_stock && <Btn size="sm" variant="ghost" icon={ArrowDownToLine} onClick={() => setMv({ item: r, kind: 'entree', qty: '', unit_cost: '', supplier_id: r.supplier_id || '', note: '' })}>Mouvement</Btn>}
                      {r.track_stock && <Btn size="sm" variant="ghost" icon={History} onClick={() => openHist(r)} title="Historique" />}
                      <Btn size="sm" variant="ghost" onClick={() => setCfg({ ...r })}>{r.track_stock ? 'Réglages' : 'Suivre'}</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <Modal open={!!mv} onClose={() => setMv(null)} title={mv ? `Mouvement de stock — ${mv.item.label}` : ''} footer={<><Btn onClick={() => setMv(null)}>Annuler</Btn><Btn variant="primary" loading={busy} disabled={mv?.qty === '' || mv?.qty == null} onClick={submitMove}>Enregistrer</Btn></>}>
        {mv && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Article"><Select value={mv.item.id} onChange={(e) => { const it = data.rows.find((r) => r.id === Number(e.target.value)); setMv({ ...mv, item: it, supplier_id: it.supplier_id || '' }); }}>{data.rows.filter((r) => r.track_stock).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></Field>
            <Field label="Type"><Select value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })}>{Object.entries(data.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={mv.kind === 'inventaire' ? 'Quantité comptée' : 'Quantité'} hint={`En stock : ${num(mv.item.stock_qty)}`}><NumInput value={mv.qty} onChange={(v) => setMv({ ...mv, qty: v })} /></Field>
            {mv.kind === 'entree' && <Field label="Prix d’achat unitaire HT" hint="Met à jour le coût moyen"><NumInput value={mv.unit_cost} onChange={(v) => setMv({ ...mv, unit_cost: v })} /></Field>}
          </div>
          {mv.kind === 'entree' && <Field label="Fournisseur"><Select value={mv.supplier_id} onChange={(e) => setMv({ ...mv, supplier_id: e.target.value })}><option value="">—</option>{[...new Map(data.rows.filter((r) => r.supplier_id).map((r) => [r.supplier_id, r.supplier_name]))].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select></Field>}
          <Field label="Note"><Input value={mv.note} onChange={(e) => setMv({ ...mv, note: e.target.value })} placeholder="N° de bon de livraison, motif…" /></Field>
        </div>}
      </Modal>

      <Modal open={!!cfg} onClose={() => setCfg(null)} title={cfg ? `Réglages — ${cfg.label}` : ''} footer={<><Btn onClick={() => setCfg(null)}>Annuler</Btn><Btn variant="primary" loading={busy} onClick={saveCfg}>Enregistrer</Btn></>}>
        {cfg && <div className="space-y-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.track_stock} onChange={(e) => setCfg({ ...cfg, track_stock: e.target.checked })} /> Suivre le stock de cet article</label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stock minimum (alerte)"><NumInput value={cfg.stock_min} onChange={(v) => setCfg({ ...cfg, stock_min: v })} /></Field>
            <Field label="Stock cible (réassort)"><NumInput value={cfg.stock_target} onChange={(v) => setCfg({ ...cfg, stock_target: v })} /></Field>
            <Field label="Emplacement"><Input value={cfg.stock_location || ''} onChange={(e) => setCfg({ ...cfg, stock_location: e.target.value })} placeholder="Camion – bac A" /></Field>
            <Field label="Marque"><Input value={cfg.brand || ''} onChange={(e) => setCfg({ ...cfg, brand: e.target.value })} /></Field>
          </div>
        </div>}
      </Modal>

      <Modal open={!!hist} onClose={() => setHist(null)} title={hist ? `Historique — ${hist.it.label}` : ''} width={620}>
        {hist && (hist.rows.length === 0 ? <div className="text-stone-500">Aucun mouvement.</div> :
          <table className="w-full text-[13px]"><thead><tr className="text-left text-stone-400 text-[12px] border-b border-line"><th className="py-2">Date</th><th>Type</th><th className="text-right">Qté</th><th className="text-right">Stock</th><th>Note</th></tr></thead>
            <tbody>{hist.rows.map((m) => <tr key={m.id} className="border-b border-line last:border-0"><td className="py-2 whitespace-nowrap">{dateFr(m.created_at)}</td><td>{data.kinds[m.kind]}</td><td className={cn('text-right num', m.qty < 0 ? 'text-rose-600' : 'text-emerald-700')}>{m.qty > 0 ? '+' : ''}{num(m.qty)}</td><td className="text-right num">{num(m.stock_after)}</td><td className="text-stone-500">{m.note || ''}</td></tr>)}</tbody></table>)}
      </Modal>

      <Modal open={!!ord} onClose={() => setOrd(null)} title={ord ? `Commande — ${ord.name}` : ''} footer={<><Btn onClick={() => setOrd(null)}>Annuler</Btn><Btn variant="primary" icon={Mail} loading={busy} onClick={sendOrder}>Préparer l’e-mail</Btn></>}>
        {ord && <div className="space-y-3">
          {ord.items.map((i, k) => <div key={i.id} className="flex items-center gap-3"><div className="flex-1 text-[13.5px]">{i.label}<div className="text-[12px] text-stone-400">{i.ref}</div></div><NumInput className="w-24" value={i.qty} onChange={(v) => setOrd({ ...ord, items: ord.items.map((x, j) => (j === k ? { ...x, qty: v } : x)) })} /></div>)}
          <Field label="Message complémentaire (facultatif)"><Textarea rows={3} value={ord.message} onChange={(e) => setOrd({ ...ord, message: e.target.value })} /></Field>
          <p className="text-[12px] text-stone-500">L’e-mail est déposé dans « Validations » : rien ne part sans votre accord.</p>
        </div>}
      </Modal>
    </div>
  );
}
