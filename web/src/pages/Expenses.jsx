import { useState } from 'react';
import { FileDown, Paperclip, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api, del, get } from '../lib/api.js';
import { ask, Btn, Card, Empty, Field, Input, Modal, NumInput, Select, useFetch, useToast, cn } from '../lib/ui.jsx';
import { money, dateFr } from '../lib/format.js';

export const KINDS = { fourniture: 'Fournitures', sous_traitance: 'Sous-traitance', main_oeuvre: "Main-d'œuvre", autre: 'Divers' };
const blank = () => ({ kind: 'fourniture', supplier: '', label: '', invoice_ref: '', date: new Date().toISOString().slice(0, 10), amount_ht: 0, vat: 20, paid: false, file: null });

export default function Expenses({ d, id, reload }) {
  const toast = useToast();
  const { data, reload: reloadX } = useFetch(() => get(`/interventions/${id}/expenses`), [id]);
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false);
  const pl = d.planned;
  if (!data) return null;
  const plan = { fourniture: pl.mat_cost, sous_traitance: pl.sub_cost, main_oeuvre: pl.lab_cost, autre: 0 };
  const save = async () => {
    setBusy(true);
    try {
      const fd = new FormData(); for (const [k, v] of Object.entries(f)) if (k !== 'file' && k !== 'id' && v != null) fd.append(k, v);
      if (f.file) fd.append('file', f.file);
      await api(f.id ? `/expenses/${f.id}` : `/interventions/${id}/expenses`, { method: f.id ? 'PUT' : 'POST', form: fd });
      setF(null); await reloadX(); await reload(); toast('Dépense enregistrée');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const scan = async () => {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', f.file); const r = await api('/agent/scan-expense', { method: 'POST', form: fd });
      setF((x) => ({ ...x, supplier: r.supplier || x.supplier, invoice_ref: r.invoice_ref || x.invoice_ref, date: r.date || x.date, label: r.label || x.label || r.supplier, amount_ht: r.amount_ht ?? x.amount_ht, vat: r.vat ?? x.vat, kind: r.kind || x.kind }));
      toast(r.warnings?.length ? r.warnings.join(' ') : 'Facture lue : vérifiez les champs', r.warnings?.length ? 'err' : undefined);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const remove = async (e) => { if (!await ask({ title: 'Supprimer cette dépense ?', message: `« ${e.label} » sera retirée du suivi de l’intervention.` })) return; await del(`/expenses/${e.id}`); await reloadX(); await reload(); };
  const reel = data.total_ht; const vente = pl.ht; const marge = vente - reel; const pct = vente > 0 && reel > 0 ? (marge / vente) * 100 : null;
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-center mb-3"><h3 className="font-semibold">Budget prévu / dépenses réelles</h3><Btn className="ml-auto" size="sm" variant="primary" icon={Plus} onClick={() => setF(blank())}>Ajouter une dépense</Btn></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(KINDS).filter(([k]) => k !== 'autre' || data.by.autre).map(([k, l]) => {
            const r = data.by[k] || 0; const p = plan[k] || 0; const over = p > 0 && r > p;
            return <div key={k}><div className="text-[12px] text-stone-500">{l}</div><div className={cn('text-lg font-semibold num', over && 'text-rose-600')}>{money(r)}</div><div className="text-[12px] text-stone-400 num">{p > 0 ? `sur ${money(p)} prévus` : 'non prévu au devis'}</div></div>;
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-line grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
          <div><div className="text-stone-500">Vente HT (devis signés)</div><div className="font-semibold num">{money(vente)}</div></div>
          <div><div className="text-stone-500">Dépenses réelles HT</div><div className="font-semibold num">{money(reel)}</div></div>
          <div><div className="text-stone-500">Marge réelle</div><div className={cn('font-semibold num', pct != null && pct < 20 ? 'text-rose-600' : 'text-emerald-700')}>{reel > 0 ? `${money(marge)}${pct != null ? ` (${pct.toFixed(1).replace('.', ',')} %)` : ''}` : '—'}</div></div>
          <div><div className="text-stone-500">Reste à payer fournisseurs</div><div className="font-semibold num">{money(data.unpaid_ttc)} TTC</div></div>
        </div>
        {data.hours > 0 && <div className="text-[12.5px] text-stone-500 mt-3">Dont main-d'œuvre pointée : {data.hours.toString().replace('.', ',')} h ({money(data.hours_cost)}).</div>}
      </Card>
      {data.rows.length === 0 ? <Card><Empty icon={Paperclip} title="Aucune dépense">Ajoutez vos factures d'achat (fournisseurs, sous-traitants) pour suivre la marge réelle de l’intervention.</Empty></Card> :
        <Card className="overflow-x-auto"><table className="w-full text-[13.5px]"><thead><tr className="text-left text-stone-400 text-[12px] border-b border-line"><th className="p-3">Date</th><th>Fournisseur / libellé</th><th>Type</th><th className="text-right">HT</th><th className="text-right">TTC</th><th>Payée</th><th /></tr></thead><tbody>
          {data.rows.map((e) => (
            <tr key={e.id} className="border-b border-line last:border-0">
              <td className="p-3 whitespace-nowrap">{dateFr(e.date)}</td>
              <td><div className="font-medium">{e.label}</div><div className="text-[12px] text-stone-400">{[e.supplier, e.invoice_ref].filter(Boolean).join(' · ')}</div></td>
              <td>{KINDS[e.kind]}</td><td className="text-right num">{money(e.amount_ht)}</td><td className="text-right num">{money(e.amount_ht * (1 + e.vat / 100))}</td>
              <td>{e.paid ? <span className="text-emerald-700">Oui</span> : <span className="text-amber-700">À payer</span>}</td>
              <td className="text-right whitespace-nowrap pr-3">
                {e.file_id && <a href={`/api/files/${e.file_id}/raw`} target="_blank" rel="noreferrer" className="inline-block text-stone-400 hover:text-accent mr-2"><FileDown size={15} /></a>}
                <button className="text-stone-400 hover:text-accent mr-2" onClick={() => setF({ ...e, file: null, paid: !!e.paid })}><Pencil size={15} /></button>
                <button className="text-stone-400 hover:text-rose-600" onClick={() => remove(e)}><Trash2 size={15} /></button></td>
            </tr>))}
        </tbody></table></Card>}
      {f && <Modal open title={f.id ? 'Modifier la dépense' : 'Nouvelle dépense'} onClose={() => setF(null)}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          </div>
          <Field label="Fournisseur / sous-traitant"><Input value={f.supplier || ''} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder="Ex. Point P, Castorama…" /></Field>
          <Field label="Libellé"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Ex. Carrelage 60×60, plomberie…" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Montant HT"><NumInput value={f.amount_ht} onChange={(v) => setF({ ...f, amount_ht: v })} /></Field>
            <Field label="TVA %"><NumInput value={f.vat} onChange={(v) => setF({ ...f, vat: v })} /></Field>
            <Field label="N° de facture"><Input value={f.invoice_ref || ''} onChange={(e) => setF({ ...f, invoice_ref: e.target.value })} /></Field>
          </div>
          <Field label="Justificatif (PDF ou photo)"><input type="file" accept="application/pdf,image/*" onChange={(e) => setF({ ...f, file: e.target.files[0] || null })} className="text-[13px]" />{f.file && <div className="mt-2"><Btn size="sm" icon={Sparkles} loading={busy} onClick={scan}>Lire la facture avec l'IA</Btn><span className="text-[12px] text-stone-400 ml-2">pré-remplit les champs, à vérifier</span></div>}</Field>
          <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={!!f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> Déjà payée au fournisseur</label>
          <div className="flex justify-end gap-2 pt-1"><Btn onClick={() => setF(null)}>Annuler</Btn><Btn variant="primary" disabled={busy} onClick={save}>Enregistrer</Btn></div>
        </div></Modal>}
    </div>
  );
}
