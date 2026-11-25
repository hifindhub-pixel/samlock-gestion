import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Share2, Copy, Check, Trash2, Download, Instagram, Facebook, Linkedin, MapPin, ExternalLink } from 'lucide-react';
import { get, post, put, del } from '../lib/api.js';
import { Badge, Btn, Card, Empty, Input, PageHeader, Textarea, useFetch, useToast, cn } from '../lib/ui.jsx';
import { dateFr } from '../lib/format.js';

const ICON = { instagram: Instagram, facebook: Facebook, linkedin: Linkedin, google: MapPin };
const ST = { brouillon: ['Brouillon', 'bg-stone-100 text-stone-700'], approuve: ['Validée — à publier', 'bg-amber-50 text-amber-800'], publie: ['Publiée', 'bg-emerald-50 text-emerald-700'] };

function Post({ p, reload }) {
  const toast = useToast(); const [text, setText] = useState(p.text); const [url, setUrl] = useState(''); const Icon = ICON[p.network] || Share2;
  const dirty = text !== p.text; const locked = p.status === 'publie';
  const act = async (fn, msg) => { try { await fn(); await reload(); msg && toast(msg); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card className="overflow-hidden">
      <div className="grid sm:grid-cols-[220px_1fr]">
        <div className="bg-stone-100 grid grid-cols-2 gap-px content-start">{p.file_ids.slice(0, 4).map((id, k) => <img key={id} src={`/api/files/${id}/raw`} alt="" className={cn('w-full aspect-square object-cover', p.file_ids.length === 1 && 'col-span-2')} />)}</div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2"><Icon size={16} className="text-stone-500" /><span className="font-medium">{p.network_label}</span><Badge className={ST[p.status][1]}>{ST[p.status][0]}</Badge>
            <Link to={`/dossier/${p.project_id}`} className="ml-auto text-[12.5px] text-stone-500 hover:text-accent truncate">{p.project_title}</Link></div>
          <Textarea rows={7} value={text} disabled={locked} onChange={(e) => setText(e.target.value)} className="text-[13.5px]" />
          <div className="flex flex-wrap gap-2 items-center">
            {dirty && !locked && <Btn size="sm" variant="primary" onClick={() => act(() => put(`/social/${p.id}`, { text }), 'Texte enregistré')}>Enregistrer</Btn>}
            {p.status === 'brouillon' && !dirty && <Btn size="sm" variant="primary" icon={Check} onClick={() => act(() => post(`/social/${p.id}/approve`), 'Publication validée')}>Valider</Btn>}
            <Btn size="sm" icon={Copy} onClick={() => { navigator.clipboard?.writeText(text); toast('Texte copié'); }}>Copier le texte</Btn>
            {p.file_ids.map((id, k) => <a key={id} href={`/api/files/${id}/raw`} download><Btn size="sm" icon={Download}>Photo {k + 1}</Btn></a>)}
            {p.status !== 'publie' && <button className="ml-auto text-stone-300 hover:text-rose-600" onClick={() => act(() => del(`/social/${p.id}`))}><Trash2 size={15} /></button>}
          </div>
          {p.status === 'approuve' && <div className="flex gap-2 items-center border-t border-line pt-3"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Lien de la publication (optionnel)" className="flex-1" /><Btn size="sm" variant="success" onClick={() => act(() => post(`/social/${p.id}/published`, { url }), 'Marquée comme publiée')}>J'ai publié</Btn></div>}
          {p.status === 'publie' && <div className="text-[12.5px] text-stone-500 flex items-center gap-2">Publiée le {dateFr(p.published_at)}{p.published_url && <a href={p.published_url} target="_blank" rel="noreferrer" className="text-accent flex items-center gap-1"><ExternalLink size={12} />voir</a>}</div>}
        </div>
      </div>
    </Card>
  );
}

export default function Social() {
  const { data, reload } = useFetch(() => get('/social'));
  const { data: ch } = useFetch(() => get('/interventions'));
  const toast = useToast();
  if (!data || !ch) return null;
  const eligible = ch.filter((c) => c.photos > 0);
  const create = async (id, network, kind) => { try { await post(`/dossier/${id}/social/draft`, { network, kind }); await reload(); toast('Brouillon créé'); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div>
      <PageHeader title="Réseaux sociaux" subtitle="Des brouillons prêts à publier, créés depuis les photos d’intervention autorisées par le client." />
      <div className="px-8 pb-12 space-y-6 max-w-5xl">
        <Card className="p-4">
          <div className="text-[12px] font-medium text-stone-600 mb-2">Créer une publication depuis une intervention</div>
          {eligible.length === 0 ? <div className="text-stone-400 text-[13px]">Aucune intervention avec photos.</div> : (
            <div className="divide-y divide-line">{eligible.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="w-10 h-10 rounded-lg bg-stone-100 overflow-hidden shrink-0">{c.cover && <img src={`/api/files/${c.cover}/raw`} className="w-full h-full object-cover" alt="" />}</div>
                <div className="min-w-0"><div className="font-medium truncate">{c.title}</div><div className="text-[12px] text-stone-400">{c.photos} photo(s) · {c.city}</div></div>
                <div className="md:ml-auto w-full md:w-auto flex flex-wrap gap-1.5">
                  {[['instagram', 'realisation', 'Instagram'], ['facebook', 'realisation', 'Facebook'], ['linkedin', 'realisation', 'LinkedIn'], ['instagram', 'avant_apres', 'Avant/après']].map(([n, k, l]) => <Btn key={l} size="sm" onClick={() => create(c.id, n, k)}>{l}</Btn>)}
                </div></div>))}</div>)}
          <p className="text-[11.5px] text-stone-400 mt-3">Seuls les interventions dont le client a coché « publication de photos » à la signature peuvent être publiés. Ni nom ni adresse du client ne figurent dans le texte.</p>
        </Card>
        {data.posts.length === 0 ? <Card><Empty icon={Share2} title="Aucune publication">Créez un brouillon ci-dessus, relisez-le, validez-le, puis copiez-le sur le réseau.</Empty></Card> : data.posts.map((p) => <Post key={p.id} p={p} reload={reload} />)}
        <p className="text-[12px] text-stone-400">La publication reste manuelle (copier/coller + photos) : la publication automatique demande une application validée par Meta/LinkedIn, prévue plus tard.</p>
      </div>
    </div>
  );
}
