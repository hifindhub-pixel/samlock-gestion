import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { Loader2, Minus, Plus } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Affiche toutes les pages d'un PDF, ajustées à la largeur de l'écran (zoom 100 % à 300 %). */
export default function PdfPages({ url }) {
  const box = useRef(null);
  const [pages, setPages] = useState(null);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(1);
  const [w, setW] = useState(0);

  useEffect(() => {
    let dead = false, task;
    setPages(null); setErr('');
    (async () => {
      try {
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('Document introuvable (' + r.status + ')');
        const data = new Uint8Array(await r.arrayBuffer());
        task = pdfjs.getDocument({ data });
        const doc = await task.promise;
        const list = [];
        for (let i = 1; i <= doc.numPages; i++) list.push(await doc.getPage(i));
        if (!dead) setPages(list);
      } catch (e) { if (!dead) setErr(e.message || 'Lecture impossible'); }
    })();
    return () => { dead = true; try { task && task.destroy(); } catch {} };
  }, [url]);

  useEffect(() => {
    const el = box.current; if (!el) return;
    const f = () => setW(el.clientWidth);
    f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect();
  }, []);

  return (
    <div className="flex-1 min-h-0 relative">
      <div ref={box} className="absolute inset-0 overflow-auto bg-stone-300 py-3" style={{ WebkitOverflowScrolling: 'touch' }}>
        {!pages && !err && <div className="h-full grid place-items-center text-stone-500"><Loader2 className="animate-spin" /></div>}
        {err && <div className="p-6 text-center text-red-700">{err}</div>}
        {pages && w > 0 && (
          <div style={{ width: Math.max(w * zoom, w), padding: '0 ' + (zoom === 1 ? 10 : 10) + 'px' }} className="mx-auto">
            {pages.map((p, i) => <Page key={i} page={p} width={Math.max(w * zoom, w) - 20} />)}
          </div>
        )}
      </div>
      <div className="absolute right-3 bottom-[max(16px,env(safe-area-inset-bottom))] flex flex-col gap-2">
        <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.5).toFixed(1)))} className="w-12 h-12 rounded-full bg-stone-900 text-white shadow-lg grid place-items-center active:bg-stone-700" aria-label="Zoom +"><Plus size={20} /></button>
        <button onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))} className="w-12 h-12 rounded-full bg-stone-900 text-white shadow-lg grid place-items-center active:bg-stone-700" aria-label="Zoom −"><Minus size={20} /></button>
      </div>
    </div>
  );
}

function Page({ page, width }) {
  const ref = useRef(null);
  const base = page.getViewport({ scale: 1 });
  const scale = width / base.width;
  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const vp = page.getViewport({ scale: scale * dpr });
    const c = ref.current; if (!c) return;
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const t = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
    return () => { try { t.cancel(); } catch {} };
  }, [page, scale]);
  return <canvas ref={ref} style={{ width, height: base.height * scale }} className="block bg-white shadow-md mb-3" />;
}
