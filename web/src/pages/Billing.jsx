import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, FileDown, Car, Mail, Pencil, Plus, Receipt, Send, Trash2, RefreshCw } from 'lucide-react';
import { del, get, post, put } from '../lib/api.js';
import { Badge, Btn, Card, Empty, Field, Input, Modal, NumInput, Select, Textarea, useFetch, useToast, ask, cn } from '../lib/ui.jsx';
import { money, dateFr, num } from '../lib/format.js';
import { InvBadge, KIND_INV } from './Invoices.jsx';

const METHODS = [['cb', 'Carte bancaire'], ['especes', 'Espèces'], ['cheque', 'Chèque'], ['virement', 'Virement'], ['autre', 'Autre']];
const today = () => new Date().toISOString().slice(0, 10);
export const blankLine = () => ({ label: '', qty: 1, unit: 'u', unit_price: 0, item_id: null });

/** Badge « IK » d’une facture : kilomètres et indemnité calculés en temps réel. */
function IkBadge({ id, status }) {
  const { data, reload } = useFetch(() => get(`/invoices/${id}/ik`), [id, status]);
  if (!data?.enabled) return null;
  if (data.km_total == null) return <span className="text-[12px] text-stone-400 inline-flex items-center gap-1"><RefreshCw size={11} className={data.trip?.error ? '' : 'animate-spin'} />{data.trip?.error ? 'Distance introuvable' : 'IK en calcul…'}{data.trip?.error && <button className="underline ml-1" onClick={() => post(`/invoices/${id}/ik/recompute`).then(reload)}>réessayer</button>}</span>;
  return <span className="text-[12px] text-stone-500 inline-flex items-center gap-1" title={data.trip?.method === 'estimation' ? 'Distance estimée (service d’itinéraire indisponible)' : 'Distance par itinéraire routier'}><Car size={12} />{num(data.km_total, 1)} km{data.ik != null ? ` · IK ${money(data.ik)}` : ''}{data.status === 'prevision' ? ' (prévision)' : ''}</span>;
}

/** Éditeur de lignes de facture : catalogue ou saisie libre. */
export function LinesEditor({ lines, setLines, catalog }) {
  const upd = (k, patch) => setLines(lines.map((l, i) => (i === k ? { ...l, ...patch } : l)));
  const pick = (k, id) => { const it = catalog.find((c) => c.id === Number(id)); if (it) upd(k, { item_id: it.id, label: it.label, unit: it.unit, unit_price: it.price_ht }); };
  const ht = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
  return (
    <div className="space-y-2">
      {lines.map((l, k) => (
        <div key={k} className="grid grid-cols-12 gap-2 items-start">
          <div className="col-span-12 md:col-span-6 space-y-1">
            <Select value={l.item_id || ''} onChange={(e) => pick(k, e.target.value)} className="text-[12.5px]"><option value="">Ligne libre / catalogue…</option>{Object.entries(catalog.reduce((g, c) => { (g[c.category || 'Autres'] ||= []).push(c); return g; }, {})).map(([cat, items]) => <optgroup key={cat} label={cat}>{items.map((c) => <option key={c.id} value={c.id}>{c.label}{c.track_stock ? ` (stock ${num(c.stock_qty)})` : ''}</option>)}</optgroup>)}</Select>
            <Input value={l.label} onChange={(e) => upd(k, { label: e.target.value })} placeholder="Désignation" />
          </div>
          <NumInput className="col-span-4 md:col-span-2 h-9 rounded-lg border border-stone-300 px-2 text-right num" value={l.qty} onChange={(v) => upd(k, { qty: v })} />
          <NumInput className="col-span-5 md:col-span-3 h-9 rounded-lg border border-stone-300 px-2 text-right num" value={l.unit_price} onChange={(v) => upd(k, { unit_price: v })} />
          <button className="col-span-3 md:col-span-1 h-9 text-stone-300 hover:text-rose-600" onClick={() => setLines(lines.filter((_, i) => i !== k))} aria-label="Retirer"><Trash2 size={15} className="mx-auto" /></button>
        </div>))}
      <div className="flex items-center"><Btn size="sm" icon={Plus} onClick={() => setLines([...lines, blankLine()])}>Ajouter une ligne</Btn><div className="ml-auto text-[13px]">Total HT : <b className="num">{money(ht)}</b></div></div>
      <div className="text-[11.5px] text-stone-400 grid grid-cols-12 gap-2"><span className="col-span-6" /><span className="col-span-2 text-right">Quantité</span><span className="col-span-3 text-right">Prix unitaire HT</span></div>
    </div>
  );
}

export default function Billing({ d, id, reload, act }) {
  const toast = useToast();
  const { data: cat } = useFetch(() => get('/catalog'));
  const { data: cfg } = useFetch(() => get('/settings'));
  const catalog = (cat?.rows || cat || []).filter?.((c) => !c.archived) || [];
  const [form, setForm] = useState(null); // création directe / édition de brouillon
  const [send, setSend] = useState(null); const [paid, setPaid] = useState(null); const [cr, setCr] = useState(null); const [pvOpen, setPvOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState({ date_reception: today(), reserves: '' });
  const P = d.pv; const c = d.contact;
  const hasQuote = d.quotes.some((q) => q.status === 'signe');
  const hasFinal = d.invoices.some((i) => i.kind === 'facture' || i.kind === 'solde');

  const saveForm = async () => {
    const lines = form.lines.filter((l) => l.label.trim()).map((l) => ({ ...l, qty: Number(l.qty), unit_price: Number(l.unit_price) }));
    if (!lines.length) return toast('Ajoutez au moins une ligne.', 'err');
    setBusy(true);
    try {
      const body = { lines, claim_ref: form.claim_ref, intervention_date: form.intervention_date || null };
      if (form.id) await put(`/invoices/${form.id}`, body); else await post(`/interventions/${id}/direct-invoice`, body);
      setForm(null); await reload(); toast('Facture enregistrée en brouillon');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const doSend = async () => {
    setBusy(true);
    try { await post(`/invoices/${send.id}/send`, { now: true }); setSend(null); await reload(); toast(`Facture envoyée à ${c.email}`); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-4">
        <div className="flex items-center gap-2 flex-wrap"><h3 className="font-semibold">Factures</h3>
          <div className="ml-auto flex gap-2 flex-wrap">
            {hasQuote && !hasFinal && <Btn size="sm" onClick={() => act(() => post(`/interventions/${id}/invoices`, { kind: 'facture' }), 'Facture créée depuis le devis')}>Facturer le devis</Btn>}
            <Btn size="sm" variant="primary" icon={Plus} onClick={() => setForm({ lines: [blankLine()], claim_ref: '', intervention_date: today() })}>Facture directe</Btn>
          </div></div>
        {d.invoices.length === 0 ? <Card><Empty icon={Receipt} title="Aucune facture">Facturez le devis accepté, ou créez une facture directe pour un dépannage sans devis (lignes du catalogue ou libres).</Empty></Card> : d.invoices.map((i) => (
          <Card key={i.id} className="p-4">
            <div className="flex items-center gap-3"><div><div className="font-semibold">{KIND_INV[i.kind]} <span className="num text-stone-400 font-normal">{i.number || ''}</span></div>
              <div className="text-[12px] text-stone-400">{i.intervention_date ? `Intervention du ${dateFr(i.intervention_date)}` : dateFr(i.created_at)}{i.claim_ref ? ` · Sinistre ${i.claim_ref}` : ''}</div></div>
              <InvBadge i={{ ...i, late: i.status === 'envoyee' && i.due_at < today() }} />
              <div className="ml-auto text-right"><div className="num font-semibold">{money(i.total_ttc)} TTC</div><div className="num text-[12px] text-stone-400">{money(i.total_ht)} HT</div></div></div>
            {i.lines?.length > 0 && <ul className="mt-2 text-[12.5px] text-stone-500 space-y-0.5">{i.lines.slice(0, 5).map((l) => <li key={l.id} className="flex justify-between gap-3"><span className="truncate">{l.qty !== 1 ? `${num(l.qty)} × ` : ''}{l.label}</span><span className="num shrink-0">{money(l.base_ht)}</span></li>)}{i.lines.length > 5 && <li className="text-stone-400">+ {i.lines.length - 5} autre(s) ligne(s)</li>}</ul>}
            <div className="mt-2"><IkBadge id={i.id} status={i.status} /></div>
            <div className="flex gap-2 mt-3 pt-3 border-t border-line flex-wrap">
              <a href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer"><Btn size="sm" icon={FileDown}>Aperçu PDF</Btn></a>
              {i.status === 'brouillon' && i.kind !== 'avoir' && <Btn size="sm" icon={Pencil} onClick={() => setForm({ id: i.id, lines: i.lines.map((l) => ({ label: l.label, qty: l.qty, unit: l.unit, unit_price: l.unit_price ?? l.base_ht, item_id: l.item_id, vat: l.vat })), claim_ref: i.claim_ref || '', intervention_date: i.intervention_date || '' })}>Modifier</Btn>}
              {i.status === 'brouillon' && <Btn size="sm" variant="primary" icon={Mail} onClick={() => setSend(i)}>Envoyer au client</Btn>}
              {i.status === 'brouillon' && <Btn size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await ask({ title: 'Supprimer ce brouillon ?', message: 'Cette facture n’a pas encore de numéro.' })) act(() => del(`/invoices/${i.id}`)); }} />}
              {i.status === 'envoyee' && <Btn size="sm" variant="success" icon={CheckCircle2} onClick={() => setPaid({ id: i.id, kind: i.kind, method: 'cb', date: today() })}>{i.kind === 'avoir' ? 'Avoir réglé' : 'Marquer payée'}</Btn>}
              {i.status === 'payee' && <span className="text-[12.5px] text-emerald-700 self-center">{i.kind === 'avoir' ? 'Réglé' : 'Payée'} le {dateFr(i.paid_at)}{i.payment_method ? ` · ${METHODS.find(([k]) => k === i.payment_method)?.[1]?.toLowerCase() || ''}` : ''}</span>}
              {i.number && i.kind !== 'avoir' && i.status !== 'brouillon' && <Btn size="sm" variant="ghost" onClick={() => setCr({ id: i.id, number: i.number, reason: '', percent: 100 })}>Créer un avoir</Btn>}
            </div>
          </Card>))}
      </div>

      <div className="lg:col-span-2 space-y-4">
        <h3 className="font-semibold">Bon d’intervention</h3>
        <Card className="p-5">
          {!P ? <>
            <div className="flex gap-3"><ClipboardCheck className="text-stone-300 shrink-0" size={28} /><p className="text-stone-500 text-[13px]">Une fois l’intervention terminée, le client peut signer en ligne le bon d’intervention : preuve que la prestation est réalisée.</p></div>
            <Btn variant="primary" className="w-full mt-4" icon={ClipboardCheck} onClick={() => setPvOpen(true)}>Préparer le bon d’intervention</Btn></> : <>
            <div className="flex items-center gap-2"><Badge className={P.status === 'signe' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}>{{ brouillon: 'À valider', envoye: 'Envoyé — en attente de signature', signe: 'Signé' }[P.status] || P.status}</Badge></div>
            <div className="text-[13px] mt-3 space-y-1"><div>Date d’intervention : <b>{dateFr(P.date_reception)}</b></div>{P.reserves && <div>Observations : {P.reserves}</div>}</div>
            <div className="flex gap-2 mt-4"><a href={`/api/pv/${P.id}/pdf`} target="_blank" rel="noreferrer"><Btn size="sm" icon={FileDown}>PDF</Btn></a>
              {P.status === 'envoye' && <Btn size="sm" onClick={() => act(() => post(`/pv/${P.id}/mark-signed`), 'Bon marqué signé')}>Signé sur papier</Btn>}
              {P.status !== 'signe' && <Btn size="sm" variant="ghost" onClick={() => setPvOpen(true)}>Modifier</Btn>}</div></>}
        </Card>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} width={760} title={form?.id ? 'Modifier la facture (brouillon)' : 'Facture directe'} footer={<><Btn onClick={() => setForm(null)}>Annuler</Btn><Btn variant="primary" loading={busy} onClick={saveForm}>Enregistrer le brouillon</Btn></>}>
        {form && <div className="space-y-4">
          <LinesEditor lines={form.lines} setLines={(lines) => setForm({ ...form, lines })} catalog={catalog} />
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-line">
            <Field label="Date d’intervention"><Input type="date" value={form.intervention_date || ''} onChange={(e) => setForm({ ...form, intervention_date: e.target.value })} /></Field>
            <Field label="N° de sinistre / dossier assurance" hint="Facultatif, reporté sur la facture"><Input value={form.claim_ref} onChange={(e) => setForm({ ...form, claim_ref: e.target.value })} /></Field>
          </div>
          <p className="text-[12px] text-stone-500">TVA : {c.client_type === 'professionnel' ? '20 % (client professionnel)' : '10 % (client particulier)'}. Les pièces suivies en stock sont retirées du stock à l’émission.</p>
        </div>}
      </Modal>

      <Modal open={!!send} onClose={() => setSend(null)} title="Envoyer la facture au client" footer={<><Btn onClick={() => setSend(null)}>Annuler</Btn><Btn variant="primary" icon={Send} loading={busy} disabled={!c.email || (cfg && !cfg.mail_ready)} onClick={doSend}>Envoyer maintenant</Btn></>}>
        {send && <div className="space-y-3 text-[13.5px]">
          <div>Destinataire : <b>{c.email || '— aucune adresse e-mail —'}</b></div>
          <div>Montant : <b className="num">{money(send.total_ttc)} TTC</b></div>
          <p className="text-stone-500">La facture reçoit son numéro définitif, part en PDF joint avec votre signature d’entreprise, et les pièces utilisées sortent du stock. Vérifiez d’abord l’aperçu.</p>
          <a href={`/api/invoices/${send.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-accent font-medium"><FileDown size={15} /> Voir le PDF</a>
          {cfg && !cfg.mail_ready && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 p-2.5">La messagerie n’est pas encore configurée (Paramètres → Envoi d’e-mails) : l’envoi serait simulé et rien ne partirait chez le client.</div>}
          {!c.email && <div className="text-rose-600">Ajoutez l’adresse e-mail du client dans sa fiche contact.</div>}
        </div>}
      </Modal>

      <Modal open={!!paid} onClose={() => setPaid(null)} title="Encaissement" footer={<><Btn onClick={() => setPaid(null)}>Annuler</Btn><Btn variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await post(`/invoices/${paid.id}/paid`, { method: paid.method, date: paid.date }); setPaid(null); await reload(); toast('Encaissement enregistré'); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } }}>Valider</Btn></>}>
        {paid && <div className="grid grid-cols-2 gap-3"><Field label="Mode de paiement"><Select value={paid.method} onChange={(e) => setPaid({ ...paid, method: e.target.value })}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field><Field label="Date"><Input type="date" value={paid.date} onChange={(e) => setPaid({ ...paid, date: e.target.value })} /></Field></div>}
      </Modal>

      {cr && <Modal open title={`Avoir sur ${cr.number}`} onClose={() => setCr(null)}>
        <div className="space-y-3">
          <p className="text-[13px] text-stone-500">Un avoir annule tout ou partie d’une facture déjà émise. Il est préparé en brouillon, puis envoyé après votre validation.</p>
          <Field label="Motif (obligatoire)"><Input value={cr.reason} onChange={(e) => setCr({ ...cr, reason: e.target.value })} placeholder="Ex. erreur de facturation, prestation non réalisée…" /></Field>
          <Field label="Part de la facture à créditer (%)"><NumInput value={cr.percent} onChange={(v) => setCr({ ...cr, percent: v })} /></Field>
          <div className="flex justify-end gap-2"><Btn onClick={() => setCr(null)}>Annuler</Btn><Btn variant="primary" onClick={() => act(async () => { await post(`/invoices/${cr.id}/credit`, { reason: cr.reason, percent: cr.percent }); setCr(null); }, 'Avoir créé en brouillon')}>Créer l’avoir</Btn></div>
        </div></Modal>}

      <Modal open={pvOpen} onClose={() => setPvOpen(false)} title="Bon d’intervention" footer={<><Btn onClick={() => setPvOpen(false)}>Annuler</Btn><Btn variant="primary" onClick={async () => { try { await post(`/interventions/${id}/pv`, pv); setPvOpen(false); await reload(); toast('Bon d’intervention préparé — à valider dans la file d’envoi'); } catch (e) { toast(e.message, 'err'); } }}>Enregistrer</Btn></>}>
        <div className="space-y-3"><Field label="Date d’intervention"><Input type="date" value={pv.date_reception} onChange={(e) => setPv({ ...pv, date_reception: e.target.value })} /></Field>
          <Field label="Observations éventuelles" hint="Laisser vide si tout est conforme."><Textarea rows={3} value={pv.reserves} onChange={(e) => setPv({ ...pv, reserves: e.target.value })} /></Field></div>
      </Modal>
    </div>
  );
}
