import { Link, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { BellRing, Boxes, Car, Wrench, ShieldCheck, TrendingUp, FileText, AlertTriangle, ArrowRight, Hammer, Receipt, Plus, UserPlus, CalendarCheck, CheckCircle2, Clock } from 'lucide-react';
import { get, post } from '../lib/api.js';
import { money, money0, pct, ago, STAGE, STAGES, daysUntil } from '../lib/format.js';
import { Btn, Card, PageHeader, useFetch, useToast, cn, Avatar } from '../lib/ui.jsx';

function Kpi({ icon: Icon, label, value, sub, tone = 'stone', to }) {
  const tones = { stone: 'bg-stone-100 text-stone-600', orange: 'bg-orange-100 text-accent', emerald: 'bg-emerald-100 text-emerald-700', rose: 'bg-rose-100 text-rose-700' };
  const body = (
    <Card className="p-4 h-full hover:border-stone-300 transition-colors">
      <div className="flex items-center gap-2.5 text-stone-500 text-[12.5px]"><span className={cn('w-7 h-7 rounded-lg grid place-items-center', tones[tone])}><Icon size={15} /></span>{label}</div>
      <div className="num text-[26px] font-semibold tracking-tight mt-2.5 leading-none">{value}</div>
      {sub && <div className="text-stone-500 text-[12.5px] mt-1.5">{sub}</div>}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}


const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function QuickActions() {
  const nav = useNavigate(); const toast = useToast();
  const newQuote = async () => { try { const q = await post('/quotes', {}); nav(`/devis/${q.id}`); } catch (e) { toast(e.message, 'err'); } };
  const A = ({ icon: Icon, label, onClick, primary }) => (
    <button onClick={onClick} className={cn('flex items-center gap-2.5 h-12 px-4 rounded-2xl font-medium text-[14px] border shadow-sm transition active:scale-[.98]', primary ? 'bg-accent text-white border-accent' : 'bg-white text-stone-800 border-line hover:border-stone-300')}><Icon size={18} />{label}</button>
  );
  return (
    <div className="flex flex-wrap gap-2.5">
      <A primary icon={Plus} label="Nouveau devis" onClick={newQuote} />
      <A icon={UserPlus} label="Nouveau contact" onClick={() => nav('/contacts?new=1')} />
      <A icon={CalendarCheck} label="Nouvelle tâche" onClick={() => nav('/agenda?new=1')} />
    </div>
  );
}

function Today() {
  const { data, reload } = useFetch(() => get('/tasks?status=open'));
  const toast = useToast();
  if (!data) return null;
  const today = new Date().toISOString().slice(0, 10);
  const rows = data.filter((t) => t.due_at && t.due_at.slice(0, 10) <= today).slice(0, 5);
  const done = async (t) => { try { await post(`/tasks/${t.id}/done`, { done: true }); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3"><CalendarCheck size={16} className="text-accent" /><h2 className="font-semibold">Aujourd'hui</h2><Link to="/agenda" className="ml-auto text-accent text-[12.5px] font-medium flex items-center gap-1">Agenda <ArrowRight size={13} /></Link></div>
      {rows.length === 0 ? <div className="text-stone-400 py-4 text-center flex items-center justify-center gap-2"><CheckCircle2 size={16} /> Rien d'urgent aujourd'hui.</div> : (
        <div className="divide-y divide-line">{rows.map((t) => {
          const late = t.due_at.slice(0, 10) < today;
          return (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <button onClick={() => done(t)} aria-label="Terminer" className="w-6 h-6 rounded-full border-2 border-stone-300 hover:border-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1"><div className="font-medium truncate">{t.title}</div>{(t.contact_company || t.contact_name || t.project_title) && <div className="text-[12px] text-stone-500 truncate">{t.contact_company || t.contact_name}{t.project_title ? ` · ${t.project_title}` : ''}</div>}</div>
              <span className={cn('text-[12px] flex items-center gap-1 shrink-0', late ? 'text-rose-600' : 'text-stone-500')}><Clock size={12} />{late ? 'en retard' : (t.all_day ? "aujourd'hui" : t.due_at.slice(11, 16))}</span>
            </div>);
        })}</div>
      )}
    </Card>
  );
}

function Cash() {
  const { data } = useFetch(() => get('/dashboard/pilotage'));
  const max = useMemo(() => Math.max(1, ...(data?.months || []).flatMap((m) => [m.billed, m.cashed])), [data]);
  if (!data) return null;
  const H = 120;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap"><TrendingUp size={16} className="text-accent" /><h2 className="font-semibold">Facturé et encaissé · 6 mois</h2>
        <span className="ml-auto flex items-center gap-3 text-[12px] text-stone-500"><span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-accent" />Facturé HT</span><span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />Encaissé TTC</span></span></div>
      <svg viewBox={`0 0 ${data.months.length * 56} ${H + 26}`} className="w-full mt-3" role="img" aria-label="Facturé et encaissé par mois">
        {data.months.map((m, i) => {
          const x = i * 56 + 8; const h1 = (m.billed / max) * H; const h2 = (m.cashed / max) * H;
          return (
            <g key={m.m}>
              <rect x={x} y={H - h1} width="18" height={Math.max(h1, m.billed ? 2 : 0)} rx="4" className="fill-accent"><title>{`Facturé ${money0(m.billed)}`}</title></rect>
              <rect x={x + 21} y={H - h2} width="18" height={Math.max(h2, m.cashed ? 2 : 0)} rx="4" fill="#34d399"><title>{`Encaissé ${money0(m.cashed)}`}</title></rect>
              <text x={x + 19} y={H + 16} textAnchor="middle" fontSize="11" fill="#78716c">{MOIS[Number(m.m.slice(5)) - 1]}</text>
            </g>);
        })}
        <line x1="0" y1={H} x2={data.months.length * 56} y2={H} stroke="#e6e3d8" />
      </svg>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="rounded-xl bg-stone-50 px-3.5 py-2.5"><div className="text-[12px] text-stone-500">Taux de signature</div><div className="num text-[20px] font-semibold">{data.win_rate == null ? '—' : `${data.win_rate} %`}</div><div className="text-[11.5px] text-stone-400">sur {data.decided} devis tranchés</div></div>
        <div className="rounded-xl bg-stone-50 px-3.5 py-2.5"><div className="text-[12px] text-stone-500">Délai moyen de signature</div><div className="num text-[20px] font-semibold">{data.avg_sign_days == null ? '—' : `${data.avg_sign_days} j`}</div><div className="text-[11.5px] text-stone-400">de l'envoi à la signature</div></div>
      </div>
    </Card>
  );
}

function Interventions({ margin }) {
  const { data } = useFetch(() => get('/dashboard/interventions'));
  if (!data || !data.rows.length) return null;
  const rows = data.rows.filter((r) => r.stage === 'intervention_en_cours' || r.over > 0);
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1"><Hammer size={16} className="text-accent" /><h2 className="font-semibold">Rentabilité des interventions</h2></div>
      <div className="text-stone-500 text-[12.5px] mb-3">
        {data.tracked ? <>Marge réelle (vendu − dépenses − heures pointées) : <b className={cn('num', data.real_margin_pct < margin ? 'text-rose-600' : 'text-emerald-700')}>{pct(data.real_margin_pct)}</b> sur {data.tracked} intervention{data.tracked > 1 ? 's' : ''} suivi{data.tracked > 1 ? 's' : ''}.</> : 'Aucune dépense saisie pour l\'instant : la marge réelle apparaîtra dès la première dépense ou heure pointée.'}
        {data.untracked > 0 && data.tracked > 0 ? ` ${data.untracked} intervention${data.untracked > 1 ? 's' : ''} en cours sans dépense saisie.` : ''}
      </div>
      <div className="divide-y divide-line">{rows.slice(0, 6).map((r) => (
        <Link key={r.id} to={`/interventions/${r.id}`} className="flex items-center gap-3 py-2 text-[13.5px] hover:bg-stone-50 -mx-2 px-2 rounded-lg">
          <div className="min-w-0 flex-1"><div className="font-medium truncate">{r.who} <span className="text-stone-400 font-normal">· {r.title}</span></div>
            <div className="text-[12px] text-stone-500 num">Vendu {money0(r.sold_ht)} · dépensé {money0(r.spent_ht)}{r.planned_cost > 0 && <> · budget {money0(r.planned_cost)}</>}</div></div>
          {r.over > 0 && <span className="text-[12px] font-semibold text-rose-700 bg-rose-50 rounded-md px-2 py-0.5">+{money0(r.over)} au-dessus du budget</span>}
          <div className={cn('num font-semibold w-16 text-right', r.real_margin_pct == null ? 'text-stone-300' : r.real_margin_pct < margin ? 'text-rose-600' : 'text-emerald-700')}>{r.real_margin_pct == null ? '—' : pct(r.real_margin_pct)}</div>
        </Link>))}</div>
    </Card>
  );
}

function Reminders() {
  const { data, reload } = useFetch(() => get('/reminders'));
  const toast = useToast();
  if (!data) return null;
  const subs = data.subs.map((s) => ({ ...s, _k: 'sub' }));
  const rows = [
    ...data.invoices.map((i) => ({ k: 'invoice', id: i.id, who: i.contact_company || i.contact_name, what: `Facture ${i.number} — ${money(i.total_ttc)}`, late: `${i.days_late} j de retard`, tone: 'text-rose-600', pending: i.pending })),
    ...data.quotes.map((q) => ({ k: 'quote', id: q.id, who: q.contact_company || q.contact_name, what: `Devis ${q.number} — ${q.project_title}`, late: `sans réponse depuis ${q.days} j`, tone: 'text-amber-700', pending: q.pending })),
    ...subs.map((s) => ({ k: 'sub', id: s.id, who: s.company || s.name, what: 'Attestation à renouveler', late: [s.decennale_until && daysUntil(s.decennale_until) < 30 && 'décennale', s.urssaf_until && daysUntil(s.urssaf_until) < 30 && 'URSSAF'].filter(Boolean).join(' + '), tone: 'text-amber-700', pending: s.pending })),
  ];
  if (!rows.length) return null;
  const go = async (r) => { try { await post(`/reminders/${r.k}/${r.id}`); toast('Relance prête — à valider dans Validations'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3 flex-wrap"><BellRing size={16} className="text-accent" /><h2 className="font-semibold whitespace-nowrap">À relancer</h2><span className="text-stone-400 text-[12.5px]">{rows.length} · rien ne part sans votre validation</span></div>
      <div className="divide-y divide-line">{rows.slice(0, 6).map((r) => (
        <div key={r.k + r.id} className="flex items-center gap-3 py-2 text-[13.5px]">
          <div className="min-w-0 flex-1"><div className="font-medium truncate">{r.who} <span className="text-stone-400 font-normal">· {r.what}</span></div><div className={cn('text-[12px]', r.tone)}>{r.late}</div></div>
          {r.pending ? <span className="text-[12px] text-stone-400">En attente de validation</span> : <Btn size="sm" onClick={() => go(r)}>Préparer la relance</Btn>}
        </div>))}</div>
    </Card>
  );
}

export default function Dashboard() {
  const { data: d } = useFetch(() => get('/dashboard'));
  if (!d) return <div className="p-10 text-stone-400">Chargement…</div>;
  const open = ['devis_envoye', 'visite_technique'].reduce((a, s) => a + d.byStage[s].amount, 0);
  const signed = d.byStage.devis_valide.amount + d.byStage.intervention_en_cours.amount;
  const todo = d.pendingOutbox + d.pendingPrices;
  const alerts = d.subs.flatMap((s) => [['Assurance RC pro', s.decennale_until], ['Attestation URSSAF', s.urssaf_until]].map(([l, date]) => ({ s, l, date, n: daysUntil(date) }))).filter((a) => a.n != null && a.n < 45).sort((a, b) => a.n - b.n);
  const maxAmt = Math.max(1, ...STAGES.map((s) => d.byStage[s].amount));
  return (
    <div>
      <PageHeader title="Bonjour 👋" subtitle={new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} />
      <div className="px-8 pb-10 space-y-6 max-w-[1250px]">
        <QuickActions />
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <Kpi icon={ShieldCheck} tone={todo ? 'orange' : 'stone'} label="À valider" value={todo} sub={todo ? 'messages et prix en attente' : 'Tout est à jour'} to="/validations" />
          <Kpi icon={FileText} label="Devis en attente de réponse" value={money0(open)} sub={`${d.byStage.devis_envoye.count} envoyé${d.byStage.devis_envoye.count > 1 ? 's' : ''} · ${d.byStage.visite_technique.count} en préparation`} to="/devis" />
          <Kpi icon={Hammer} tone="emerald" label="Interventions acceptées" value={money0(signed)} sub={`${d.byStage.devis_valide.count + d.byStage.intervention_en_cours.count} intervention(s) à réaliser`} to="/interventions" />
          <Kpi icon={Receipt} tone={d.overdue ? 'orange' : 'stone'} label="À encaisser (TTC)" value={money0(d.receivable)} sub={d.overdue ? `dont ${money0(d.overdue)} en retard` : d.draftInvoices ? `${d.draftInvoices} facture(s) à envoyer` : 'Aucun retard'} to="/factures" />
          <Kpi icon={TrendingUp} tone="emerald" label="Marge moyenne des devis émis" value={pct(d.avg_margin)} sub={`Seuil d'alerte ${d.settings.margin_alert} %`} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Kpi icon={Car} tone="orange" label={`Indemnités km ${new Date().getFullYear()}`} value={d.ik ? money0(d.ik.ik) : '—'} sub={d.ik ? `${Math.round(d.ik.km)} km · ${d.ik.count} intervention${d.ik.count > 1 ? 's' : ''}` : 'Calcul désactivé'} to="/indemnites-km" />
          <Kpi icon={Boxes} tone={d.stock.out ? 'rose' : d.stock.low ? 'orange' : 'stone'} label="Stock" value={d.stock.out + d.stock.low} sub={d.stock.out + d.stock.low ? `${d.stock.out} rupture${d.stock.out > 1 ? 's' : ''} · ${d.stock.low} bas` : 'Aucune alerte'} to="/stock" />
          <Kpi icon={Wrench} tone={d.subsToPay.n ? 'orange' : 'stone'} label="Sous-traitants à régler" value={money0(d.subsToPay.t)} sub={d.subsToPay.n ? `${d.subsToPay.n} mission${d.subsToPay.n > 1 ? 's' : ''} terminée${d.subsToPay.n > 1 ? 's' : ''} (HT)` : 'Rien à régler'} to="/sous-traitants" />
        </div>
        <div className="grid lg:grid-cols-2 gap-6"><Today /><Cash /></div>
        <Reminders />
        <Interventions margin={Number(d.settings.margin_alert || 20)} />

        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-5">
            <div className="flex items-center justify-between mb-4"><h2 className="font-semibold">Pipeline</h2><Link to="/pipeline" className="text-accent text-[12.5px] font-medium flex items-center gap-1">Ouvrir <ArrowRight size={13} /></Link></div>
            <div className="space-y-2.5">
              {STAGES.map((s) => (
                <div key={s} className="flex items-center gap-3">
                  <div className="w-36 flex items-center gap-2 text-[13px]"><i className={cn('w-2 h-2 rounded-full', STAGE[s].dot)} />{STAGE[s].label}</div>
                  <div className="flex-1 h-6 bg-stone-100 rounded-md overflow-hidden"><div className={cn('h-full rounded-md opacity-80', STAGE[s].dot)} style={{ width: `${Math.max(d.byStage[s].count ? 4 : 0, (d.byStage[s].amount / maxAmt) * 100)}%` }} /></div>
                  <div className="w-8 text-right num text-stone-500">{d.byStage[s].count}</div>
                  <div className="w-24 text-right num font-medium">{money0(d.byStage[s].amount)}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold mb-3">Alertes sous-traitants</h2>
            {alerts.length === 0 && <div className="text-stone-400 py-6 text-center">Toutes les attestations sont valides.</div>}
            <div className="space-y-2.5">
              {alerts.slice(0, 5).map((a, i) => (
                <Link key={i} to={`/contacts/${a.s.id}`} className="flex items-start gap-2.5 group">
                  <AlertTriangle size={15} className={cn('mt-0.5', a.n < 0 ? 'text-rose-600' : 'text-amber-600')} />
                  <div className="leading-snug"><div className="font-medium group-hover:text-accent">{a.s.name}</div><div className="text-[12.5px] text-stone-500">{a.l} {a.n < 0 ? `expirée depuis ${-a.n} j — non affectable` : `expire dans ${a.n} j`}</div></div>
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="font-semibold mb-3">Activité récente</h2>
          <div className="divide-y divide-line">
            {d.recent.map((a) => (
              <div key={a.id} className="py-2.5 flex items-center gap-3">
                <Avatar name={a.contact_name} size={26} />
                <div className="flex-1 min-w-0"><span className="font-medium">{a.contact_name}</span> <span className="text-stone-500">— {a.text}</span></div>
                <span className="text-stone-400 text-[12px] shrink-0">{ago(a.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
