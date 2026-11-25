import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HardHat, Camera, MapPin, Receipt } from 'lucide-react';
import { get } from '../lib/api.js';
import { Card, Chips, Empty, MarginPill, PageHeader, SearchBox, Select, StageBadge, matches, useFetch, Avatar } from '../lib/ui.jsx';
import { money0 } from '../lib/format.js';

export default function Interventions() {
  const { data: all } = useFetch(() => get('/interventions'));
  const [q, setQ] = useState(''); const [stage, setStage] = useState('all'); const [order, setOrder] = useState('stage');
  if (!all) return null;
  const ORDERS = {
    stage: null,
    recent: (a, b) => String(b.updated_at).localeCompare(String(a.updated_at)),
    montant: (a, b) => b.planned.ht - a.planned.ht,
    marge: (a, b) => (a.planned.margin ?? 999) - (b.planned.margin ?? 999),
    client: (a, b) => (a.contact_company || a.contact_name).localeCompare(b.contact_company || b.contact_name, 'fr'),
    encaisser: (a, b) => (b.invoiced - b.paid) - (a.invoiced - a.paid),
  };
  const data = all.filter((p) => (stage === 'all' || p.stage === stage) && matches(p, q, (x) => `${x.title} ${x.contact_name} ${x.contact_company} ${x.city} ${x.address}`)).sort(ORDERS[order] || (() => 0));
  const groups = order === 'stage' ? [['intervention_en_cours', 'En cours'], ['devis_valide', 'À démarrer'], ['intervention_terminee', 'Livrés']] : [[null, `${data.length} intervention${data.length > 1 ? 's' : ''}`]];
  const cnt = (k) => all.filter((p) => k === 'all' || p.stage === k).length;
  return (
    <div>
      <PageHeader title="Interventions" subtitle="Devis signés : suivi, photos, sous-traitants, réception et facturation." />
      <div className="px-8 pb-10 space-y-8">
        <div className="flex items-center gap-3 flex-wrap">
          <Chips value={stage} onChange={setStage} options={[['all', 'Tous', cnt('all')], ['intervention_en_cours', 'En cours', cnt('intervention_en_cours')], ['devis_valide', 'À démarrer', cnt('devis_valide')], ['intervention_terminee', 'Livrés', cnt('intervention_terminee')]]} />
          <div className="md:ml-auto w-full md:w-auto flex flex-wrap items-center gap-2">
            <Select value={order} onChange={(e) => setOrder(e.target.value)} className="!w-full md:!w-52"><option value="stage">Grouper par état</option><option value="recent">Récemment modifiés</option><option value="montant">Montant (décroissant)</option><option value="marge">Marge (croissante)</option><option value="encaisser">Reste à encaisser</option><option value="client">Client (A → Z)</option></Select>
            <SearchBox value={q} onChange={setQ} placeholder="Client, intervention, ville…" />
          </div>
        </div>
        {data.length === 0 && all.length > 0 && <Card><Empty icon={HardHat} title="Aucun résultat">Modifiez la recherche ou le filtre.</Empty></Card>}
        {all.length === 0 && <Card><Empty icon={HardHat} title="Aucune intervention pour l'instant">Dès qu'un devis est signé, il apparaît ici automatiquement.</Empty></Card>}
        {groups.map(([gstage, label]) => {
          const rows = gstage ? data.filter((p) => p.stage === gstage) : data;
          if (!rows.length) return null;
          return (
            <section key={gstage || 'all'}>
              <h2 className="text-[12px] uppercase tracking-wide font-semibold text-stone-400 mb-3">{label} · {rows.length}</h2>
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((p) => (
                  <Link key={p.id} to={`/dossier/${p.id}`} className="group bg-white border border-line rounded-2xl overflow-hidden hover:shadow-md hover:border-stone-300 transition">
                    <div className="h-32 bg-stone-100 relative">
                      {p.cover ? <img src={`/api/files/${p.cover}/raw`} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-stone-300"><HardHat size={34} /></div>}
                      <div className="absolute top-2.5 left-2.5"><StageBadge stage={p.stage} /></div>
                      {p.draft_invoices > 0 && <div className="absolute top-2.5 right-2.5 bg-accent text-white text-[11px] font-semibold rounded-md px-2 py-0.5 flex items-center gap-1"><Receipt size={11} />{p.draft_invoices} facture{p.draft_invoices > 1 ? 's' : ''} à envoyer</div>}
                    </div>
                    <div className="p-4">
                      <div className="font-semibold leading-snug group-hover:text-accent">{p.title}</div>
                      <div className="flex items-center gap-1.5 text-stone-500 text-[12.5px] mt-1"><Avatar name={p.contact_name} size={18} />{p.contact_company || p.contact_name}</div>
                      {p.city && <div className="flex items-center gap-1.5 text-stone-400 text-[12.5px] mt-0.5"><MapPin size={12} />{p.city}</div>}
                      <div className="mt-3 pt-3 border-t border-line flex items-center justify-between text-[13px]">
                        <span className="num font-semibold">{money0(p.planned.ht)} <span className="text-stone-400 font-normal">HT</span></span>
                        <span className="flex items-center gap-3 text-stone-400"><span className="flex items-center gap-1"><Camera size={12} />{p.photos}</span><MarginPill value={p.planned.margin} /></span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-stone-100 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (p.paid / (p.planned.ht * 1.1 || 1)) * 100)}%` }} /></div>
                      <div className="text-[11.5px] text-stone-400 mt-1">Encaissé {money0(p.paid)} · facturé {money0(p.invoiced)} TTC</div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
