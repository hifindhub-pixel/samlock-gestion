import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LayoutGrid, Percent, Wallet, Receipt, Landmark, Download, Upload, Check, X, RefreshCw, CheckCircle2, AlertTriangle, Link2, Info, TrendingUp } from 'lucide-react';
import { api, get, post, put } from '../lib/api.js';
import { Badge, Btn, Card, Chips, Empty, Input, NumInput, PageHeader, SearchBox, Select, Modal, Field, ask, matches, useFetch, useSort, useToast, cn, MarginPill } from '../lib/ui.jsx';
import { money, money0, pct, dateFr } from '../lib/format.js';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`; };

const SECTIONS = [
  ['apercu', 'Vue d’ensemble', LayoutGrid], ['marges', 'Marges', Percent], ['tresorerie', 'Trésorerie', Wallet],
  ['tva', 'TVA', Receipt], ['banque', 'Banque', Landmark], ['export', 'Export & logiciel comptable', Download],
];

function Stat({ label, value, sub, tone = 'text-stone-900' }) {
  return <Card className="p-4"><div className="text-[12px] text-stone-500">{label}</div><div className={cn('text-[22px] font-semibold num mt-1 leading-none', tone)}>{value}</div>{sub && <div className="text-[12px] text-stone-400 mt-1.5">{sub}</div>}</Card>;
}
const Note = ({ children }) => <div className="flex gap-2 text-[12.5px] text-stone-500 bg-stone-50 border border-line rounded-lg px-3 py-2.5"><Info size={14} className="mt-0.5 shrink-0 text-stone-400" /><div>{children}</div></div>;

/* ------------------------------------------------------------------ Vue d'ensemble */
function Overview() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: d } = useFetch(() => get(`/compta/overview?year=${year}`), [year]);
  if (!d) return <div className="text-stone-400 p-6">Chargement…</div>;
  const max = Math.max(1, ...d.series.flatMap((s) => [s.invoiced_ht, s.expenses_ht]));
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><h2 className="font-semibold text-[16px]">Exercice</h2>
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="!w-28">{[0, 1, 2, 3].map((k) => { const y = new Date().getFullYear() - k; return <option key={y} value={y}>{y}</option>; })}</Select></div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Facturé HT" value={money0(d.invoiced_ht)} sub={`${money0(d.invoiced_ttc)} TTC`} />
        <Stat label="Encaissé TTC" value={money0(d.collected_ttc)} tone="text-emerald-700" />
        <Stat label="Reste à encaisser" value={money0(d.receivable_ttc)} tone="text-amber-700" sub={d.overdue_ttc ? `dont ${money0(d.overdue_ttc)} en retard` : 'aucun retard'} />
        <Stat label="Dépenses HT" value={money0(d.expenses_ht)} sub={d.unpaid_expenses_ttc ? `${money0(d.unpaid_expenses_ttc)} TTC à payer` : 'tout est réglé'} />
        <Stat label="Résultat estimé HT" value={money0(d.result_ht)} tone={d.result_ht < 0 ? 'text-rose-600' : 'text-emerald-700'} sub="facturé − dépenses − heures pointées" />
      </div>
      <Card className="p-5">
        <div className="flex items-center gap-4 mb-4"><h3 className="font-semibold">Mois par mois</h3>
          <span className="flex items-center gap-1.5 text-[12px] text-stone-500"><i className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Facturé HT</span>
          <span className="flex items-center gap-1.5 text-[12px] text-stone-500"><i className="w-2.5 h-2.5 rounded-sm bg-rose-400" />Dépenses HT</span></div>
        <div className="flex items-end gap-2 h-44">
          {d.series.map((s) => (
            <div key={s.month} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="flex items-end gap-0.5 h-36 w-full justify-center" title={`${monthLabel(s.month)} — facturé ${money0(s.invoiced_ht)} · dépenses ${money0(s.expenses_ht)}`}>
                <div className="w-[38%] max-w-[18px] rounded-t bg-emerald-500" style={{ height: `${(s.invoiced_ht / max) * 100}%`, minHeight: s.invoiced_ht ? 2 : 0 }} />
                <div className="w-[38%] max-w-[18px] rounded-t bg-rose-400" style={{ height: `${(s.expenses_ht / max) * 100}%`, minHeight: s.expenses_ht ? 2 : 0 }} />
              </div>
              <div className="text-[11px] text-stone-400">{MONTHS[Number(s.month.slice(5)) - 1]}</div>
            </div>))}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Marges */
function Margins({ alertPct }) {
  const { data } = useFetch(() => get('/compta/margins'));
  const [q, setQ] = useState('');
  const rows = useMemo(() => (data?.rows || []).filter((r) => matches(r, q, (x) => `${x.who} ${x.title} ${x.city}`)), [data, q]);
  const sort = useSort(rows, { who: (r) => r.who, sold: (r) => r.sold_ht, cost: (r) => r.planned_cost, pm: (r) => r.planned_margin_pct, spent: (r) => r.spent_ht, rm: (r) => r.real_margin_pct, billed: (r) => r.billed_pct });
  if (!data) return <div className="text-stone-400 p-6">Chargement…</div>;
  const t = data.totals;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Vendu HT (interventions signées)" value={money0(t.sold_ht)} />
        <Stat label="Marge prévue" value={pct(t.planned_margin_pct)} sub="d'après les coûts des devis" />
        <Stat label="Marge réelle (partielle)" value={pct(t.real_margin_pct)} tone={t.real_margin_pct != null && t.real_margin_pct < alertPct ? 'text-rose-600' : 'text-emerald-700'} sub={t.tracked ? `${t.tracked} intervention(s) avec dépenses saisies` : 'aucune dépense saisie'} />
        <Stat label="Seuil d'alerte" value={`${alertPct} %`} sub="réglable dans Paramètres" />
      </div>
      <div className="flex items-center"><SearchBox className="ml-auto" value={q} onChange={setQ} placeholder="Client, intervention, ville…" /></div>
      <Card className="overflow-x-auto">
        {sort.rows.length === 0 ? <Empty icon={Percent} title="Aucune intervention">Les marges apparaissent dès qu'un devis est signé.</Empty> : (
          <table className="w-full text-[13.5px]">
            <thead><tr className="text-left text-[11.5px] text-stone-400 border-b border-line">{sort.th('who', 'Intervention', { className: 'px-4 py-2.5' })}{sort.th('sold', 'Vendu', { right: true, className: 'text-right' })}{sort.th('cost', 'Coût prév.', { right: true, className: 'text-right' })}{sort.th('pm', 'Marge prév.', { right: true, className: 'text-right' })}{sort.th('spent', 'Dépensé', { right: true, className: 'text-right' })}{sort.th('rm', 'Marge réelle', { right: true, className: 'text-right pr-4' })}</tr></thead>
            <tbody>{sort.rows.map((r) => (
              <tr key={r.id} className="border-b border-line/70 hover:bg-stone-50">
                <td className="px-4 py-2.5"><Link to={`/interventions/${r.id}`} className="font-medium hover:text-accent">{r.who}</Link><div className="text-[12px] text-stone-400 truncate max-w-[210px]">{r.title} · facturé {pct(r.billed_pct, 0)}</div></td>
                <td className="text-right num">{money0(r.sold_ht)}</td>
                <td className="text-right num text-stone-500">{r.planned_cost ? money0(r.planned_cost) : '—'}</td>
                <td className="text-right"><MarginPill value={r.planned_margin_pct} /></td>
                <td className="text-right num">{r.spent_ht ? money0(r.spent_ht) : <span className="text-stone-300">—</span>}</td>
                <td className="text-right pr-4">{r.real_margin_pct == null ? <span className="text-stone-300">—</span> : <MarginPill value={r.real_margin_pct} />}</td>
              </tr>))}</tbody>
          </table>)}
      </Card>
      <Note>Marge réelle = vendu HT − dépenses saisies − heures pointées. Tant qu'aucune dépense n'est saisie sur une intervention, elle reste « — » plutôt que d'afficher une fausse marge de 100 %.</Note>
    </div>
  );
}

/* ------------------------------------------------------------------ Trésorerie */
function Cashflow() {
  const { data: d, reload } = useFetch(() => get('/compta/cashflow?months=6'));
  const toast = useToast(); const [val, setVal] = useState('');
  if (!d) return <div className="text-stone-400 p-6">Chargement…</div>;
  const saveOpening = async () => { try { await put('/compta/opening', { value: val }); toast('Solde enregistré'); setVal(''); reload(); } catch (e) { toast(e.message, 'err'); } };
  const max = Math.max(1, ...d.rows.flatMap((r) => [r.in, r.out]));
  const low = d.rows.find((r) => r.cumulative != null && r.cumulative < 0);
  return (
    <div className="space-y-5">
      <Card className="p-5 flex items-center gap-5 flex-wrap">
        <div><div className="text-[12px] text-stone-500">Solde de départ</div>
          <div className="text-[24px] font-semibold num leading-none mt-1">{d.opening ? money(d.opening.value) : '—'}</div>
          <div className="text-[12px] text-stone-400 mt-1.5">{d.opening ? `${d.opening.source}${d.opening.date ? ` · ${dateFr(d.opening.date)}` : ''}` : 'à renseigner pour obtenir la prévision de solde'}</div></div>
        <div className="ml-auto flex items-end gap-2">
          <Field label="Saisir le solde du compte (€)"><NumInput value={val} onChange={setVal} className="w-40 h-9 rounded-lg border border-stone-300 bg-white px-3 num text-right outline-none focus:border-accent focus:ring-3 focus:ring-orange-200/70" /></Field>
          <Btn disabled={val === '' || val == null} onClick={saveOpening}>Enregistrer</Btn>
        </div>
      </Card>
      {low && <div className="flex gap-2.5 rounded-lg bg-rose-50 text-rose-800 px-4 py-3 text-[13.5px]"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><div>Le solde prévu devient négatif en <b>{monthLabel(low.month)}</b> ({money0(low.cumulative)}). Relancez les factures en retard ou décalez des paiements.</div></div>}
      <Card className="overflow-hidden">
        <table className="w-full text-[13.5px]">
          <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-stone-400 border-b border-line"><th className="px-4 py-2.5">Mois</th><th className="w-[34%]"> </th><th className="text-right">Encaissements</th><th className="text-right">Décaissements</th><th className="text-right">Net</th><th className="text-right pr-4">Solde prévu</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.month} className={cn('border-b border-line/70', r.current && 'bg-orange-50/40', r.past && 'text-stone-500')}>
              <td className="px-4 py-2.5 font-medium whitespace-nowrap">{monthLabel(r.month)}{r.current && <Badge className="ml-2 bg-orange-100 text-accent">en cours</Badge>}{r.past && <span className="ml-2 text-[11px] text-stone-400 font-normal">réalisé</span>}</td>
              <td><div className="flex flex-col gap-0.5"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${(r.in / max) * 100}%` }} /><div className="h-1.5 rounded bg-rose-400" style={{ width: `${(r.out / max) * 100}%` }} /></div></td>
              <td className="text-right num text-emerald-700">{r.in ? money0(r.in) : '—'}</td><td className="text-right num text-rose-600">{r.out ? money0(r.out) : '—'}</td>
              <td className={cn('text-right num font-medium', r.net < 0 && 'text-rose-600')}>{money0(r.net)}</td>
              <td className={cn('text-right num font-semibold pr-4', r.cumulative != null && r.cumulative < 0 && 'text-rose-600')}>{r.cumulative == null ? <span className="text-stone-300">—</span> : money0(r.cumulative)}</td>
            </tr>))}</tbody>
        </table>
      </Card>
      <Note>{d.note} {d.late_invoices > 0 && <b>{d.late_invoices} facture(s) en retard comptée(s) sur le mois en cours.</b>} Les salaires, charges sociales, loyers et emprunts ne sont pas saisis dans le logiciel : ils ne figurent pas dans cette prévision.</Note>
    </div>
  );
}

/* ------------------------------------------------------------------ TVA */
function Vat() {
  const y = new Date().getFullYear(); const [from, setFrom] = useState(`${y}-01-01`); const [to, setTo] = useState(`${y}-12-31`);
  const { data: d } = useFetch(() => get(`/compta/vat?from=${from}&to=${to}`), [from, to]);
  const Tbl = ({ title, rows, total, tone }) => (
    <Card className="overflow-hidden"><div className="px-4 py-3 font-semibold border-b border-line">{title}</div>
      <table className="w-full text-[13.5px]"><thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-stone-400 border-b border-line"><th className="px-4 py-2">Taux</th><th className="text-right">Base HT</th><th className="text-right pr-4">TVA</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.rate} className="border-b border-line/70"><td className="px-4 py-2">{String(r.rate).replace('.', ',')} %</td><td className="text-right num">{money(r.base)}</td><td className="text-right num pr-4">{money(r.vat)}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-4 text-stone-400 text-center">Aucune opération sur la période.</td></tr>}
          <tr><td className="px-4 py-2.5 font-semibold" colSpan={2}>Total</td><td className={cn('text-right num font-semibold pr-4', tone)}>{money(total)}</td></tr></tbody></table></Card>
  );
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-40" /><span className="text-stone-400">→</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-40" /></div>
      {!d ? <div className="text-stone-400 p-6">Chargement…</div> : <>
        <div className="grid lg:grid-cols-3 gap-4">
          <Stat label="TVA collectée" value={money(d.total_collected)} sub="sur les factures émises" />
          <Stat label="TVA déductible" value={money(d.total_deductible)} sub="sur les dépenses saisies" />
          <Stat label={d.net >= 0 ? 'TVA à payer (estimée)' : 'Crédit de TVA (estimé)'} value={money(Math.abs(d.net))} tone={d.net >= 0 ? 'text-amber-700' : 'text-emerald-700'} />
        </div>
        <div className="grid lg:grid-cols-2 gap-4"><Tbl title="TVA collectée par taux" rows={d.collected} total={d.total_collected} /><Tbl title="TVA déductible par taux" rows={d.deductible} total={d.total_deductible} /></div>
        <Note>{d.note}</Note></>}
    </div>
  );
}

/* ------------------------------------------------------------------ Banque */
function Bank() {
  const toast = useToast(); const fileRef = useRef(null);
  const [st, setSt] = useState('new'); const [q, setQ] = useState(''); const [pick, setPick] = useState(null); const [busy, setBusy] = useState(false);
  const { data: d, reload } = useFetch(() => get(`/bank/transactions?status=${st}`), [st]);
  const rows = useMemo(() => (d?.rows || []).filter((r) => matches(r, q, (x) => `${x.label} ${x.amount}`)), [d, q]);
  const sort = useSort(rows, { date: (r) => r.date, label: (r) => r.label, amount: (r) => r.amount }, { key: 'date', dir: 'desc' });
  const importFile = async (file) => {
    if (!file) return; setBusy(true);
    try { const form = new FormData(); form.append('file', file); const r = await api('/bank/import', { method: 'POST', form }); toast(`${r.added} opération(s) importée(s)${r.duplicates ? `, ${r.duplicates} déjà connue(s)` : ''}`); setSt('new'); reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } };
  const match = (t, body, msg) => act(() => post(`/bank/transactions/${t.id}/match`, body), msg);
  if (!d) return <div className="text-stone-400 p-6">Chargement…</div>;
  const c = d.counts;
  return (
    <div className="space-y-5">
      <Card className="p-5 flex items-center gap-4 flex-wrap">
        <span className="w-10 h-10 rounded-xl bg-stone-100 grid place-items-center text-stone-500"><Landmark size={18} /></span>
        <div className="min-w-0 flex-1"><div className="font-semibold">Relevé bancaire</div>
          <div className="text-[12.5px] text-stone-500">Téléchargez le relevé (CSV ou OFX) depuis l'espace de votre banque, puis déposez-le ici. Les doublons sont ignorés : vous pouvez réimporter sans risque.</div></div>
        <input ref={fileRef} type="file" accept=".csv,.ofx,.qif,.txt" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
        <Btn variant="primary" icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>Importer un relevé</Btn>
      </Card>
      {d.total === 0 ? <Card><Empty icon={Landmark} title="Aucune opération">Importez un premier relevé : les encaissements seront rapprochés de vos factures automatiquement.</Empty></Card> : <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Solde (dernier relevé)" value={d.balance ? money(d.balance.value) : '—'} sub={d.balance ? `au ${dateFr(d.balance.date)}` : 'colonne « solde » absente du fichier'} />
          <Stat label="À traiter" value={c.new || 0} tone={c.new ? 'text-amber-700' : 'text-stone-900'} />
          <Stat label="Rapprochées" value={c.matched || 0} tone="text-emerald-700" />
          <Stat label="Ignorées" value={c.ignored || 0} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Chips value={st} onChange={setSt} options={[['new', 'À traiter', c.new || 0], ['matched', 'Rapprochées', c.matched || 0], ['ignored', 'Ignorées', c.ignored || 0], ['all', 'Toutes', d.total]]} />
          <SearchBox className="ml-auto" value={q} onChange={setQ} placeholder="Libellé, montant…" />
        </div>
        <Card className="overflow-hidden">
          <table className="w-full text-[13.5px]">
            <thead><tr className="text-left text-[11.5px] text-stone-400 border-b border-line">{sort.th('date', 'Date', { className: 'px-4 py-2.5 w-28' })}{sort.th('label', 'Libellé')}{sort.th('amount', 'Montant', { right: true, className: 'text-right' })}<th className="uppercase tracking-wide">Rapprochement</th><th /></tr></thead>
            <tbody>{sort.rows.map((t) => (
              <tr key={t.id} className="border-b border-line/70 hover:bg-stone-50 align-top">
                <td className="px-4 py-2.5 text-stone-500 whitespace-nowrap">{dateFr(t.date)}</td>
                <td className="py-2.5 max-w-[360px]"><div className="truncate" title={t.label}>{t.label}</div></td>
                <td className={cn('text-right num font-medium py-2.5 whitespace-nowrap', t.amount > 0 ? 'text-emerald-700' : 'text-stone-800')}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</td>
                <td className="py-2.5 pl-4">
                  {t.status === 'matched' && <span className="flex items-center gap-1.5 text-emerald-700 text-[12.5px]"><CheckCircle2 size={13} />{t.invoice ? `Facture ${t.invoice.number}` : t.expense ? `Dépense « ${t.expense.label} »` : 'Rapprochée'}</span>}
                  {t.status === 'ignored' && <span className="text-stone-400 text-[12.5px]">Ignorée</span>}
                  {t.status === 'new' && (t.suggestion
                    ? <div className="text-[12.5px]"><div className="text-stone-700">{t.suggestion.text}</div><div className="text-stone-400">{t.suggestion.sure ? 'Montant identique' : 'À vérifier'}</div></div>
                    : <span className="text-stone-400 text-[12.5px]">Aucune correspondance évidente</span>)}
                </td>
                <td className="text-right pr-4 py-2 whitespace-nowrap">
                  {t.status === 'new' && <div className="flex gap-1.5 justify-end">
                    {t.suggestion && <Btn size="sm" variant="primary" icon={Check} onClick={() => match(t, t.suggestion.type === 'invoice' ? { invoice_id: t.suggestion.id } : { expense_id: t.suggestion.id }, t.suggestion.type === 'invoice' ? 'Facture marquée payée' : 'Dépense marquée payée')}>Valider</Btn>}
                    <Btn size="sm" icon={Link2} onClick={() => setPick(t)}>Choisir…</Btn>
                    <Btn size="sm" variant="ghost" icon={X} title="Ignorer" onClick={() => act(() => post(`/bank/transactions/${t.id}/ignore`, {}))} />
                  </div>}
                  {t.status !== 'new' && <Btn size="sm" variant="ghost" onClick={() => act(() => post(`/bank/transactions/${t.id}/reset`, {}))}>Annuler</Btn>}
                </td>
              </tr>))}</tbody>
          </table>
          {sort.rows.length === 0 && <Empty title="Aucune opération">Rien dans cette vue.</Empty>}
        </Card></>}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-2"><TrendingUp size={15} className="text-stone-400" /><h3 className="font-semibold">Connexion bancaire automatique</h3><Badge className="bg-stone-100 text-stone-600">non activée</Badge></div>
        <p className="text-[13px] text-stone-600 leading-relaxed">L'import de relevé fonctionne avec toutes les banques et ne coûte rien. Une connexion directe (les opérations arrivent seules chaque jour) est possible avec un agrégateur bancaire agréé : Powens, Bridge ou, si la société est chez Qonto, l'API Qonto. Elle demande un contrat et un abonnement mensuel — à décider ensemble avant de l'activer.</p>
      </Card>
      <PickModal t={pick} cands={d.candidates} onClose={() => setPick(null)} onPick={async (body) => { const t = pick; setPick(null); await match(t, body, 'Rapprochement enregistré'); }} />
    </div>
  );
}
function PickModal({ t, cands, onClose, onPick }) {
  const [sel, setSel] = useState('');
  if (!t) return null;
  const inc = t.amount > 0;
  const opts = inc ? cands.invoices.map((i) => [`i${i.id}`, `${i.number} — ${i.cc || i.cn} — ${money(i.total_ttc)}`]) : cands.expenses.map((e) => [`e${e.id}`, `${e.label}${e.supplier ? ` — ${e.supplier}` : ''} — ${money(e.amount_ht * (1 + e.vat / 100))} TTC`]);
  return (
    <Modal open onClose={onClose} title="Rapprocher cette opération" footer={<><Btn onClick={onClose}>Annuler</Btn><Btn variant="primary" disabled={!sel} onClick={() => onPick(inc ? { invoice_id: Number(sel.slice(1)) } : { expense_id: Number(sel.slice(1)) })}>Rapprocher</Btn></>}>
      <div className="space-y-3">
        <div className="rounded-lg bg-stone-50 border border-line px-3 py-2.5 text-[13.5px]"><div className="font-medium">{t.label}</div><div className="text-stone-500 num">{dateFr(t.date)} · {money(t.amount)}</div></div>
        <Field label={inc ? 'Facture encaissée' : 'Dépense payée'} hint={inc ? 'La facture sera marquée « payée » à la date de l’opération.' : 'La dépense sera marquée « payée ».'}>
          <Select value={sel} onChange={(e) => setSel(e.target.value)}><option value="">Choisir…</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        {opts.length === 0 && <p className="text-[12.5px] text-stone-400">{inc ? 'Aucune facture envoyée en attente de paiement.' : 'Aucune dépense non payée.'}</p>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Export & logiciel comptable */
function AccountingPanel({ acc, reload }) {
  const toast = useToast(); const y = new Date().getFullYear(); const [from, setFrom] = useState(`${y}-01-01`); const [to, setTo] = useState(`${y}-12-31`); const [url, setUrl] = useState(acc.webhook_url || '');
  const cur = acc.providers.find((p) => p.id === acc.provider);
  const save = async (patch) => { await put('/settings', patch); reload(); toast('Connecteur mis à jour'); };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3"><Landmark size={16} className="text-stone-400" /><h3 className="font-semibold">Comptabilité</h3>
        <Badge className={cur?.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}>{cur?.ready ? 'Connecteur prêt' : 'À configurer'}</Badge></div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="text-[12px] font-medium text-stone-600">Logiciel comptable</div>
          <Select value={acc.provider} onChange={(e) => save({ accounting_provider: e.target.value })}>{acc.providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
          {acc.provider === 'webhook' && <div className="flex gap-2"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hook.eu1.make.com/…" /><Btn onClick={() => save({ accounting_webhook_url: url })}>OK</Btn></div>}
          {acc.provider === 'pennylane' && !cur.ready && <p className="text-[12.5px] text-stone-500">Définir la variable d'environnement <code className="bg-stone-100 rounded px-1">PENNYLANE_TOKEN</code> (jeton API Pennylane). À tester d'abord avec le sandbox Pennylane.</p>}
          {acc.provider === 'export' && <p className="text-[12.5px] text-stone-500">Aucune transmission automatique : exportez la période et importez-la dans Tiime/Pennylane (ou transmettez-la à l'expert-comptable).</p>}
          {acc.provider !== 'export' && <p className="text-[12.5px] text-stone-500">La transmission se fait facture par facture, sur votre clic, une fois la facture envoyée.</p>}
        </div>
        <div className="space-y-3">
          <div className="text-[12px] font-medium text-stone-600">Export de la période</div>
          <div className="flex gap-2 items-center"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="text-stone-400">→</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="flex gap-2"><a href={`/api/accounting/export?format=csv&from=${from}&to=${to}`}><Btn icon={Download}>Tableur (CSV)</Btn></a><a href={`/api/accounting/export?format=fec&from=${from}&to=${to}`}><Btn icon={Download}>FEC (écritures)</Btn></a></div>
          <p className="text-[11.5px] text-stone-400">Comptes par défaut : 411 clients, 706 prestations, 4457 TVA, 512 banque — à faire valider par le comptable.</p>
        </div>
      </div>
    </Card>
  );
}


function Export() {
  const { data: acc, reload } = useFetch(() => get('/accounting'));
  const { data: inv } = useFetch(() => get('/invoices'));
  const toast = useToast();
  if (!acc || !inv) return <div className="text-stone-400 p-6">Chargement…</div>;
  const rows = inv.filter((i) => i.status !== 'brouillon');
  const syncOf = (id) => acc.sync.find((x) => x.invoice_id === id && x.provider === acc.provider);
  const push = async (id) => { try { await post(`/invoices/${id}/sync`); toast('Transmise à la comptabilité'); } catch (e) { toast(e.message, 'err'); } reload(); };
  return (
    <div className="space-y-5">
      <AccountingPanel acc={acc} reload={reload} />
      {acc.provider !== 'export' && (
        <Card className="overflow-hidden"><div className="px-4 py-3 font-semibold border-b border-line">Transmission des factures émises</div>
          <table className="w-full text-[13.5px]"><tbody>{rows.map((i) => (
            <tr key={i.id} className="border-b border-line/70 last:border-0"><td className="px-4 py-2.5 font-medium num">{i.number}</td><td className="text-stone-500">{i.contact_company || i.contact_name}</td><td className="text-right num">{money(i.total_ttc)}</td>
              <td className="text-right pr-4">{syncOf(i.id)?.status === 'ok' ? <span className="inline-flex items-center gap-1 text-emerald-700 text-[12px]"><CheckCircle2 size={13} />Transmise</span> : syncOf(i.id)?.status === 'error' ? <span className="inline-flex items-center gap-2 text-rose-600 text-[12px]" title={syncOf(i.id).error}><AlertTriangle size={13} />Erreur<Btn size="sm" icon={RefreshCw} onClick={() => push(i.id)}>Réessayer</Btn></span> : <Btn size="sm" onClick={() => push(i.id)}>Transmettre</Btn>}</td></tr>))}
            {rows.length === 0 && <tr><td className="px-4 py-6 text-center text-stone-400">Aucune facture émise.</td></tr>}</tbody></table></Card>)}
    </div>
  );
}

/* ------------------------------------------------------------------ Page */
export default function Compta() {
  const [params, setParams] = useSearchParams(); const t = params.get('t') || 'apercu';
  const { data: S } = useFetch(() => get('/settings'));
  const alertPct = Number(S?.margin_alert || 20);
  const cur = SECTIONS.find((s) => s[0] === t) || SECTIONS[0];
  return (
    <div>
      <PageHeader title="Comptabilité" subtitle="Marges, trésorerie, TVA, banque et export vers votre comptable. Estimations de gestion : la comptabilité officielle reste celle de votre expert-comptable." />
      <div className="px-8 pb-10 flex flex-col md:flex-row gap-6">
        <nav className="chips md:w-52 shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible -mx-1 px-1 pb-1">
          {SECTIONS.map(([k, l, Icon]) => (
            <button key={k} onClick={() => setParams(k === 'apercu' ? {} : { t: k })} className={cn('flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13.5px] font-medium text-left whitespace-nowrap shrink-0', cur[0] === k ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100')}><Icon size={15} className="shrink-0" />{l}</button>))}
        </nav>
        <div className="min-w-0 flex-1">
          {cur[0] === 'apercu' && <Overview />}
          {cur[0] === 'marges' && <Margins alertPct={alertPct} />}
          {cur[0] === 'tresorerie' && <Cashflow />}
          {cur[0] === 'tva' && <Vat />}
          {cur[0] === 'banque' && <Bank />}
          {cur[0] === 'export' && <Export />}
        </div>
      </div>
    </div>
  );
}
