import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Receipt, FileDown, Trash2 } from 'lucide-react';
import { get, del } from '../lib/api.js';
import { Badge, Card, Chips, Empty, PageHeader, SearchBox, matches, useFetch, useSort } from '../lib/ui.jsx';
import { money, dateFr } from '../lib/format.js';

export const INV = {
  brouillon: ['Brouillon', 'bg-stone-100 text-stone-700'], envoyee: ['Envoyée', 'bg-amber-50 text-amber-800'], payee: ['Payée', 'bg-emerald-50 text-emerald-700'], retard: ['En retard', 'bg-rose-50 text-rose-700'],
};
export const KIND_INV = { acompte: 'Acompte', situation: 'Situation', solde: 'Solde', avoir: 'Avoir' };
export const InvBadge = ({ i }) => { const k = i.late ? 'retard' : i.status; return <Badge className={INV[k][1]}>{INV[k][0]}</Badge>; };

export default function Invoices() {
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
      <PageHeader title="Factures" subtitle="Les factures sont préparées automatiquement ; rien ne part sans votre validation. Export et suivi bancaire : rubrique Comptabilité." />
      <div className="px-8 pb-10 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{tiles.map(([l, v, c]) => <Card key={l} className="p-4"><div className="text-[12px] text-stone-500">{l}</div><div className={`text-xl font-semibold num mt-1 ${c}`}>{money(v)}</div></Card>)}</div>
        <div className="flex items-center gap-3 flex-wrap">
          <Chips value={f} onChange={setF} options={[['all', 'Toutes', cnt('all')], ['brouillon', 'Brouillons', cnt('brouillon')], ['envoyee', 'Envoyées', cnt('envoyee')], ['retard', 'En retard', cnt('retard')], ['payee', 'Payées', cnt('payee')], ['avoir', 'Avoirs', cnt('avoir')]]} />
          <SearchBox className="ml-auto" value={q} onChange={setQ} placeholder="N°, client, intervention, devis…" />
        </div>
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty icon={Receipt} title="Aucune facture">Elles se créent à la signature d'un devis (acompte) et à la réception de l’intervention (solde).</Empty> : sort.rows.length === 0 ? <Empty icon={Receipt} title="Aucun résultat">Modifiez la recherche ou le filtre.</Empty> : (
            <table className="w-full text-[13.5px]">
              <thead><tr className="text-left text-[11.5px] text-stone-400 border-b border-line">{sort.th('number', 'N°', { className: 'px-4 py-2.5' })}{sort.th('project', 'Intervention')}{sort.th('kind', 'Type')}{sort.th('due', 'Échéance')}{sort.th('ttc', 'TTC', { right: true, className: 'text-right' })}{sort.th('status', 'Statut')}<th /></tr></thead>
              <tbody>{sort.rows.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-medium num">{i.number || <span className="text-stone-400">brouillon</span>}</td>
                  <td><Link className="hover:text-accent" to={`/interventions/${i.project_id}`}>{i.project_title}</Link><div className="text-[12px] text-stone-400">{i.contact_company || i.contact_name}</div>{i.quotes?.length > 0 && <div className="text-[12px] text-stone-400">Devis {i.quotes.map((r) => r.number).join(', ')}</div>}</td>
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
