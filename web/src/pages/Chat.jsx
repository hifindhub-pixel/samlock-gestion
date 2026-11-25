import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Mic, Send, Sparkles, Trash2 } from 'lucide-react';
import { post } from '../lib/api.js';
import { Btn, cn } from '../lib/ui.jsx';
import { useDictation } from '../lib/useDictation.js';

const QUESTIONS = [
  'Quelles factures sont en retard de paiement ?',
  'Quels devis envoyés attendent une réponse ?',
  'Quels articles sont sous leur seuil de stock ?',
];
const EXAMPLES = [
  { label: 'Préparer un devis', text: 'Prépare un devis pour M. Martin, 12 rue des Lilas à Montpellier : remplacement d’un cylindre et 3 clés.' },
  { label: 'Préparer une facture', text: 'Prépare une facture pour Mme Durand, 4 avenue de Lodève à Montpellier : ouverture de porte claquée, 120 € TTC.' },
];
const KEY = 'samlock_assistant';

export default function Chat() {
  const nav = useNavigate();
  const [msgs, setMsgs] = useState(() => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } });
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const end = useRef(null); const textRef = useRef(''); textRef.current = text;
  const dict = useDictation(useCallback(() => textRef.current, []), setText);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs)); } catch { /* */ } end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  const send = async (q) => {
    const content = (q ?? text).trim(); if (!content || busy) return;
    dict.stop();
    const next = [...msgs, { role: 'user', content }]; setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await post('/chat', { messages: next.map(({ role, content }) => ({ role, content })) });
      setMsgs([...next, { role: 'assistant', content: r.reply, action: r.action || null }]);
    } catch (e) { setMsgs([...next, { role: 'assistant', content: e.message || 'Erreur', error: true }]); }
    setBusy(false);
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-3xl flex-col p-3 md:h-[calc(100dvh-2rem)] md:p-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[26px] leading-tight">Assistant</h1>
          <p className="text-sm text-stone-500">Posez une question ou dictez une demande. L’assistant prépare des <b>brouillons</b> de devis et de factures : rien n’est envoyé ni validé sans vous.</p>
        </div>
        {msgs.length > 0 && <Btn icon={Trash2} onClick={() => setMsgs([])} title="Nouvelle conversation">Effacer</Btn>}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4">
        {!msgs.length && (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-orange-50 text-accent"><Sparkles size={22} /></div>
            <div className="flex flex-wrap justify-center gap-2">
              {QUESTIONS.map((s) => <button key={s} className="rounded-full border border-stone-200 px-3 py-1.5 text-left text-[13px] text-stone-700 hover:bg-stone-50" onClick={() => send(s)}>{s}</button>)}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((s) => <button key={s.label} className="rounded-full border border-orange-200 bg-orange-50/60 px-3 py-1.5 text-[13px] text-orange-900 hover:bg-orange-50" onClick={() => setText(s.text)}>{s.label} (exemple)</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn('flex flex-col gap-1.5', m.role === 'user' ? 'items-end' : 'items-start')}>
            <div className={cn('max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14.5px] leading-relaxed', m.role === 'user' ? 'bg-accent text-white' : m.error ? 'bg-red-50 text-red-700' : 'bg-stone-100 text-stone-800')}>{m.content}</div>
            {m.action && <Btn variant="primary" icon={ArrowRight} onClick={() => nav(m.action.url)}>{m.action.label}</Btn>}
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="rounded-2xl bg-stone-100 px-3.5 py-2.5 text-sm text-stone-500">Réflexion…</div></div>}
        <div ref={end} />
      </div>
      {dict.error && <div className="mt-2 text-[12.5px] text-red-700">{dict.error}</div>}
      {dict.supported && !dict.secure && <div className="mt-2 text-[12.5px] text-stone-500">Le bouton micro nécessite l’adresse sécurisée (https), disponible une fois l’appli hébergée. D’ici là, utilisez le micro du clavier du téléphone.</div>}
      <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={3000}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send(); } }}
          placeholder={dict.on ? 'Je vous écoute…' : 'Votre question ou votre demande…'}
          className="min-h-[44px] flex-1 resize-none rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[14.5px] outline-none focus:border-accent focus:ring-2 focus:ring-orange-100" />
        {dict.supported && dict.secure && <button type="button" onClick={dict.toggle} aria-label={dict.on ? 'Arrêter la dictée' : 'Dicter'} className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full border', dict.on ? 'animate-pulse border-red-500 bg-red-500 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50')}><Mic size={19} /></button>}
        <Btn variant="primary" icon={Send} type="submit" disabled={busy || !text.trim()}>Envoyer</Btn>
      </form>
    </div>
  );
}
