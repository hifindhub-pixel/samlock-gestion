import { useCallback, useEffect, useRef, useState } from 'react';

// Dictée vocale du navigateur (gratuite, aucun envoi d'audio à l'appli). Nécessite une page sécurisée (https ou localhost).
export function useDictation(getText, setText) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const secure = typeof window === 'undefined' || window.isSecureContext;
  const [on, setOn] = useState(false); const [error, setError] = useState('');
  const rec = useRef(null);
  const stop = useCallback(() => { try { rec.current?.stop(); } catch { /* déjà arrêté */ } rec.current = null; setOn(false); }, []);
  const start = useCallback(() => {
    if (!SR || !secure) return;
    setError('');
    const base = (getText() || '').trim();
    const r = new SR(); r.lang = 'fr-FR'; r.continuous = true; r.interimResults = true;
    let finals = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finals += t + ' '; else interim += t; }
      setText([base, (finals + interim).trim()].filter(Boolean).join(' '));
    };
    r.onerror = (e) => { setError(e.error === 'not-allowed' ? "Micro refusé : autorisez-le dans le navigateur (cadenas près de l'adresse)." : e.error === 'no-speech' ? '' : 'Dictée interrompue.'); setOn(false); };
    r.onend = () => { rec.current = null; setOn(false); };
    try { r.start(); rec.current = r; setOn(true); } catch { setOn(false); }
  }, [SR, secure, getText, setText]);
  useEffect(() => () => { try { rec.current?.stop(); } catch { /* */ } }, []);
  return { supported: !!SR, secure, on, error, toggle: () => (on ? stop() : start()), stop };
}
