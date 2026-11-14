import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Trash2 } from 'lucide-react';
import { post } from '../lib/api.js';
import { Btn, Input, cn } from '../lib/ui.jsx';

const SUGGESTIONS = [
  'Quelles factures sont en retard de paiement ?',
  'Quels devis envoyés attendent une réponse ?',
  'Quel est mon chiffre d’affaires signé ce mois-ci ?',
  'Quelles attestations de sous-traitants expirent bientôt ?',
];
const KEY = 'samlock_chat';

export default function Chat() {
  const [msgs, setMsgs] = useState(() => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } });
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs)); } catch {} end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  const send = async (q) => {
    const content = (q ?? text).trim(); if (!content || busy) return;
    const next = [...msgs, { role: 'user', content }]; setMsgs(next); setText(''); setBusy(true);
    try { const r = await post('/chat', { messages: next }); setMsgs([...next, { role: 'assistant', content: r.reply }]); }
    catch (e) { setMsgs([...next, { role: 'assistant', content: e.message || 'Erreur', error: true }]); }
    setBusy(false);
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-3xl flex-col md:h-[calc(100dvh-7rem)]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-[26px] leading-tight">Chat IA</h1>
          <p className="text-sm text-stone-500">Posez vos questions sur vos devis, factures, interventions et contacts. Lecture seule : rien n’est modifié ni envoyé.</p>
        </div>
        {msgs.length > 0 && <Btn icon={Trash2} onClick={() => setMsgs([])} title="Nouvelle conversation">Effacer</Btn>}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4">
        {!msgs.length && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-accent"><Sparkles size={22} /></div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => <button key={s} className="rounded-full border border-stone-200 px-3 py-1.5 text-left text-[13px] text-stone-700 hover:bg-stone-50" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14.5px] leading-relaxed', m.role === 'user' ? 'bg-accent text-white' : m.error ? 'bg-red-50 text-red-700' : 'bg-stone-100 text-stone-800')}>{m.content}</div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="rounded-2xl bg-stone-100 px-3.5 py-2.5 text-sm text-stone-500">Réflexion…</div></div>}
        <div ref={end} />
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Input className="flex-1" placeholder="Votre question…" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
        <Btn variant="primary" icon={Send} type="submit" disabled={busy || !text.trim()}>Envoyer</Btn>
      </form>
    </div>
  );
}
