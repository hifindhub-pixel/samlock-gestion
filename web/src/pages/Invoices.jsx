import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Receipt, FileDown, Trash2, Plus } from 'lucide-react';
import { get, del, post } from '../lib/api.js';
import { Badge, Btn, Card, Chips, Empty, Field, Input, Modal, PageHeader, SearchBox, Select, matches, useFetch, useSort, useToast } from '../lib/ui.jsx';
import { LinesEditor, blankLine } from './Billing.jsx';
import { money, dateFr } from '../lib/format.js';

export const INV = {
  brouillon: ['Brouillon', 'bg-stone-100 text-stone-700'], envoyee: ['Envoyée', 'bg-amber-50 text-amber-800'], payee: ['Payée', 'bg-emerald-50 text-emerald-700'], retard: ['En retard', 'bg-rose-50 text-rose-700'],
};
export const KIND_INV = { acompte: 'Acompte', situation: 'Situation', solde: 'Solde', avoir: 'Avoir' };
export const InvBadge = ({ i }) => { const k = i.late ? 'retard' : i.status; return <Badge className={INV[k][1]}>{INV[k][0]}</Badge>; };


/** Facture directe en un seul écran : client (existant ou nouveau), adresse, lignes → brouillon prêt à relire et envoyer. */
function NewInvoice({ onClose }) {
  const nav = useNavigate(); const toast = useToast();
  const { data: cat } = useFetch(() => get('/catalog')); const { data: cts } = useFetch(() => get('/contacts'));
  const catalog = (cat?.rows || cat || []).filter?.((c) => !c.archived) || [];
  const contacts = (cts?.rows || []).filter((c) => c.name !== 'À définir');
  const [cid, setCid] = useState('new'); const [busy, setBusy] = useState(false);
  const [c, setC] = useState({ name: '', company: '', phone: '', email: '', address: '', postal: '', city: '' });
  const [site, setSite] = useState({ address: '', city: '' });
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [claim, setClaim] = useState('');
  const [lines, setLines] = useState([blankLine()]);
  const ex = cid !== 'new' ? contacts.find((x) => String(x.id) === String(cid)) : null;
  const go = async () => {
    const ls = lines.filter((l) => l.label.trim()).map((l) => ({ ...l, qty: Number(l.qty), unit_price: Number(l.unit_price) }));
    if (!ex && !c.name.trim()) return toast('Indiquez le nom du client.', 'err');
    if (!ls.length) return toast('Ajoutez au moins une ligne.', 'err');
    setBusy(true);
    try {
      const contact = ex || await post('/contacts', { ...c, kind: 'client' });
      const p = await post('/projects', { contact_id: contact.id, title: ls[0].label.slice(0, 80), address: site.address || contact.address || '', city: site.city || contact.city || '', stage: 'intervention_terminee' });
      const inv = await post(`/interventions/${p.id}/direct-invoice`, { lines: ls, claim_ref: claim, intervention_date: date || null });
      toast('Facture créée en brouillon'); onClose(); nav(`/dossier/${p.id}?tab=fact`);
      return inv;
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width={780} title="Nouvelle facture" footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" loading={busy} onClick={go}>Créer la facture</Btn></>}>
      <div className="space-y-4">
        <Field label="Client"><Select value={cid} onChange={(e) => setCid(e.target.value)}><option value="new">+ Nouveau client</option>{contacts.map((x) => <option key={x.id} value={x.id}>{x.company || x.name}{x.company ? ` — ${x.name}` : ''}{x.city ? ` (${x.city})` : ''}</option>)}</Select></Field>
        {!ex && (
          <div className="grid grid-cols-12 gap-3">
            <Field label="Nom *" className="col-span-12 md:col-span-6"><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
            <Field label="Société (facultatif)" className="col-span-12 md:col-span-6"><Input value={c.company} onChange={(e) => setC({ ...c, company: e.target.value })} /></Field>
            <Field label="Téléphone" className="col-span-12 md:col-span-6"><Input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
            <Field label="E-mail (pour l’envoi)" className="col-span-12 md:col-span-6"><Input value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
            <Field label="Adresse" className="col-span-12 md:col-span-6"><Input value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} /></Field>
            <Field label="Code postal" className="col-span-5 md:col-span-2"><Input value={c.postal} onChange={(e) => setC({ ...c, postal: e.target.value })} /></Field>
            <Field label="Ville" className="col-span-7 md:col-span-4"><Input value={c.city} onChange={(e) => setC({ ...c, city: e.target.value })} /></Field>
          </div>)}
        <div className="grid grid-cols-12 gap-3">
          <Field label="Adresse de l’intervention (calcul des IK)" hint="Vide = adresse du client" className="col-span-12 md:col-span-8"><Input value={site.address} onChange={(e) => setSite({ ...site, address: e.target.value })} placeholder={ex?.address || c.address || ''} /></Field>
          <Field label="Ville" className="col-span-12 md:col-span-4"><Input value={site.city} onChange={(e) => setSite({ ...site, city: e.target.value })} placeholder={ex?.city || c.city || ''} /></Field>
          <Field label="Date d’intervention" className="col-span-6 md:col-span-4"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="N° de sinistre / dossier (facultatif)" className="col-span-6 md:col-span-8"><Input value={claim} onChange={(e) => setClaim(e.target.value)} /></Field>
        </div>
        <LinesEditor lines={lines} setLines={setLines} catalog={catalog} />
      </div>
    </Modal>
  );
}
export default function Invoices() {
  const [creating, setCreating] = useState(false);
  const { data, reload } = useFetch(() => get('/invoices'));
  const remove = async (i) => {
    if (!window.confirm(`Supprimer définitivement la facture ${i.number || 'brouillon'} (${money(i.total_ttc)}) ?\n\nElle disparaît du logiciel avec ses avoirs et ses indemnités kilométriques ; le stock est remis en place. Cette action est irréversible.`)) return;
    try { await del(`/invoices/${i.id}`); reload(); } catch (e) { window.alert(e.message || 'Suppression impossible.'); }
  };
  const [q, setQ] = useState(''); const [f, setF] = useState('all');
  const key = (i) => (i.late ? 'retard' : i.status);
  const filtered = useMemo(() => (data || []).filter((i) => (f === 'all' || (f === 'avoir' ? i.kind === 'avoir' : f === 'retard' ? i.late : i.status === f)) && matches(i, q, (x) => `${x.number || 'brouillon'} ${x.project_title} ${x.contact_name} ${x.contact_company} ${x.title} ${KIND_INV[x.kind]} ${(x.quotes || []).map((r) => r.number).join(' ')}`)), [data, q, f]);
  const sort = useSort(filtered, { number: (i) => i.number, project: (i) => i.project_title, client: (i) => i.contact_company || i.contact_name, kind: (i) => KIND_INV[i.kind], due: (i) => i.due_at, ttc: (i) => i.total_ttc, status: (i) => key(i), issued: (i) => i.issued_at || i.created_at }, { key: 'issued', dir: 'desc' });
  if (!data) return null;
  const sum = (fn) => data.filter(fn).reduce((a, i) => a + i.total_ttc, 0);
  const cnt = (k) => data.filter((i) => (k === 'all' ? true : k === 'avoir' ? i.kind === 'avoir' : k === 'retard' ? i.late : i.status === k)).length;
  const tiles = [['À envoyer', sum((i) => i.status === 'brouillon'), 'text-stone-900'], ['À encaisser', sum((i) => i.status === 'envoyee'), 'text-amber-700'], ['En retard', sum((i) => i.late), 'text-rose-600'], ['Encaissé', sum((i) => i.status === 'payee'), 'text-emerald-700']];
  return (
    <div>
      <PageHeader title="Factures" subtitle="Créez une facture directement, sans devis, ou laissez le logiciel préparer celles des devis signés. Rien ne part sans votre validation." actions={<Btn variant="primary" icon={Plus} onClick={() => setCreating(true)}>Nouvelle facture</Btn>} />
      {creating && <NewInvoice onClose={() => setCreating(false)} />}
      <div className="px-8 pb-10 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{tiles.map(([l, v, c]) => <Card key={l} className="p-4"><div className="text-[12px] text-stone-500">{l}</div><div className={`text-xl font-semibold num mt-1 ${c}`}>{money(v)}</div></Card>)}</div>
        <div className="flex items-center gap-3 flex-wrap">
          <Chips value={f} onChange={setF} options={[['all', 'Toutes', cnt('all')], ['brouillon', 'Brouillons', cnt('brouillon')], ['envoyee', 'Envoyées', cnt('envoyee')], ['retard', 'En retard', cnt('retard')], ['payee', 'Payées', cnt('payee')], ['avoir', 'Avoirs', cnt('avoir')]]} />
          <SearchBox className="ml-auto" value={q} onChange={setQ} placeholder="N°, client, intervention, devis…" />
        </div>
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty icon={Receipt} title="Aucune facture">Elles se créent à la signature d'un devis (acompte) et à la réception de l’intervention (solde).</Empty> : sort.rows.length === 0 ? <Empty icon={Receipt} title="Aucun résultat">Modifiez la recherche ou le filtre.</Empty> : (
            <table className="w-full text-[13.5px]">
              <thead><tr className="text-left text-[11.5px] text-stone-400 border-b border-line">{sort.th('number', 'N°', { className: 'px-4 py-2.5' })}{sort.th('project', 'Client / dossier')}{sort.th('kind', 'Type')}{sort.th('due', 'Échéance')}{sort.th('ttc', 'TTC', { right: true, className: 'text-right' })}{sort.th('status', 'Statut')}<th /></tr></thead>
              <tbody>{sort.rows.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-medium num">{i.number || <span className="text-stone-400">brouillon</span>}</td>
                  <td><Link className="hover:text-accent" to={`/dossier/${i.project_id}`}>{i.project_title}</Link><div className="text-[12px] text-stone-400">{i.contact_company || i.contact_name}</div>{i.quotes?.length > 0 && <div className="text-[12px] text-stone-400">Devis {i.quotes.map((r) => r.number).join(', ')}</div>}</td>
                  <td>{KIND_INV[i.kind]}</td><td className={i.late ? 'text-rose-600 font-medium' : ''}>{dateFr(i.due_at)}</td>
                  <td className="text-right num font-medium">{money(i.total_ttc)}</td><td><InvBadge i={i} /></td>
                  <td className="pr-4"><a href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" className="text-stone-400 hover:text-accent"><FileDown size={16} /></a>{!String(i.number || '').startsWith('TIIME-') && i.kind !== 'avoir' && <button title="Supprimer" className="ml-3 text-stone-300 hover:text-rose-600" onClick={() => remove(i)}><Trash2 size={15} /></button>}</td>
                </tr>))}</tbody>
            </table>)}
        </Card>
      </div>
    </div>
  );
}
