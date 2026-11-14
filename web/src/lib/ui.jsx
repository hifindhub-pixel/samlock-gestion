import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, Check, AlertTriangle, Loader2, Trash2, Search, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { STAGE, QSTATUS, KIND1, pct } from './format.js';

export const cn = (...a) => a.filter(Boolean).join(' ');

export function Btn({ variant = 'default', size = 'md', icon: Icon, children, className, loading, ...p }) {
  const v = {
    default: 'bg-white border border-stone-300 text-stone-800 hover:bg-stone-50 active:bg-stone-100 shadow-[0_1px_0_rgba(0,0,0,.03)]',
    primary: 'bg-accent text-white hover:bg-orange-800 border border-transparent shadow-sm',
    dark: 'bg-stone-900 text-white hover:bg-stone-800 border border-transparent',
    ghost: 'text-stone-600 hover:bg-stone-100 border border-transparent',
    danger: 'bg-white border border-rose-200 text-rose-700 hover:bg-rose-50',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 border border-transparent',
  }[variant];
  const s = { sm: 'h-7 px-2.5 text-[12.5px] gap-1.5', md: 'h-8.5 px-3 text-[13px] gap-1.5', lg: 'h-10 px-4 text-sm gap-2' }[size];
  return (
    <button {...p} disabled={p.disabled || loading} className={cn('inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none', v, s, className)}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : Icon && <Icon size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  );
}

export const Card = ({ className, children, ...p }) => <div {...p} className={cn('bg-white border border-line rounded-xl', className)}>{children}</div>;

export function Badge({ children, className }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-medium', className)}>{children}</span>;
}
export const StageBadge = ({ stage }) => <Badge className={STAGE[stage]?.chip}><i className={cn('w-1.5 h-1.5 rounded-full', STAGE[stage]?.dot)} />{STAGE[stage]?.label}</Badge>;
export const QStatusBadge = ({ status }) => <Badge className={QSTATUS[status]?.chip}>{QSTATUS[status]?.label}</Badge>;
export const KindBadge = ({ kind }) => <Badge className="bg-stone-100 text-stone-700">{KIND1[kind]}</Badge>;

export function MarginPill({ value, threshold = 20 }) {
  if (value == null) return <span className="text-stone-400">—</span>;
  const tone = value < threshold ? 'bg-rose-50 text-rose-700' : value < threshold + 8 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700';
  return <span className={cn('num inline-block rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold', tone)}>{pct(value)}</span>;
}

export function Avatar({ name, size = 28 }) {
  const initials = (name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const hue = [...(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return <span className="inline-flex items-center justify-center rounded-full font-semibold shrink-0" style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 35% 92%)`, color: `hsl(${hue} 40% 30%)` }}>{initials}</span>;
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="block text-[12px] font-medium text-stone-600 mb-1">{label}</span>}
      {children}
      {hint && <span className="block text-[11.5px] text-stone-400 mt-1">{hint}</span>}
    </label>
  );
}
const inputCls = 'w-full h-9 rounded-lg border border-stone-300 bg-white px-3 text-[13.5px] outline-none transition focus:border-accent focus:ring-3 focus:ring-orange-200/70 placeholder:text-stone-400 disabled:bg-stone-50';
export const Input = ({ className, ...p }) => <input {...p} className={cn(inputCls, className)} />;
export const Select = ({ className, children, ...p }) => <select {...p} className={cn(inputCls, 'pr-8', className)}>{children}</select>;
export const Textarea = ({ className, ...p }) => <textarea {...p} className={cn(inputCls, 'h-auto py-2 leading-relaxed', className)} />;

export function Modal({ open, onClose, title, children, footer, width = 520 }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-3 md:pt-[8vh] px-3 md:px-4 fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{ background: 'rgba(28,25,23,.45)' }}>
      <div className="pop bg-white rounded-2xl shadow-2xl w-full max-h-[84vh] flex flex-col" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="font-semibold text-[15px]">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-stone-100 text-stone-500"><X size={16} /></button>
        </div>
        <div className="p-5 overflow-auto scroll-thin form-stack">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 bg-stone-50/60 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 520 }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{ background: 'rgba(28,25,23,.35)' }}>
      <div className="absolute right-0 top-0 bottom-0 bg-white shadow-2xl flex flex-col pop" style={{ width, maxWidth: '100vw' }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="font-semibold text-[15px]">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-stone-100 text-stone-500"><X size={16} /></button>
        </div>
        <div className="p-5 overflow-auto flex-1 scroll-thin">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 bg-stone-50/60">{footer}</div>}
      </div>
    </div>
  );
}

/* Notifications */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone = 'ok', action) => {
    const id = Math.random();
    setItems((l) => [...l, { id, text, tone, action }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), action ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center">
        {items.map((t) => (
          <div key={t.id} className="pop flex items-center gap-3 bg-stone-900 text-white rounded-xl pl-3 pr-3.5 py-2.5 shadow-xl text-[13px]">
            {t.tone === 'err' ? <AlertTriangle size={15} className="text-rose-400" /> : <Check size={15} className="text-emerald-400" />}
            {t.text}
            {t.action && <button onClick={t.action.run} className="font-semibold text-orange-300 hover:text-orange-200">{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function PageHeader({ title, subtitle, actions, tabs }) {
  return (
    <div className="px-8 pt-7 pb-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 md:gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-serif tracking-tight">{title}</h1>
          {subtitle && <p className="text-stone-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs}
    </div>
  );
}

export const Empty = ({ icon: Icon, title, children }) => (
  <div className="text-center py-14 text-stone-500">
    {Icon && <Icon size={28} className="mx-auto mb-3 text-stone-300" />}
    <div className="font-medium text-stone-700">{title}</div>
    <div className="mt-1 max-w-sm mx-auto">{children}</div>
  </div>
);

/** Charge une ressource ; recharge à la demande. */
export function useFetch(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    try { const d = await fn(); if (my === seq.current) { setData(d); setError(null); } }
    catch (e) { if (my === seq.current) setError(e); }
    finally { if (my === seq.current) setLoading(false); }
  }, deps); // eslint-disable-line
  useEffect(() => { setLoading(true); load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

export function useDebounced(fn, ms = 450) {
  const t = useRef();
  return useCallback((...a) => { clearTimeout(t.current); t.current = setTimeout(() => fn(...a), ms); }, [fn, ms]);
}

/** Champ numérique qui accepte la virgule française. */
export function NumInput({ value, onChange, className, step = 'any', ...p }) {
  const [txt, setTxt] = useState(value == null ? '' : String(value).replace('.', ','));
  const focus = useRef(false);
  useEffect(() => { if (!focus.current) setTxt(value == null ? '' : String(value).replace('.', ',')); }, [value]);
  return (
    <input {...p} inputMode="decimal" className={cn(inputCls, className)} value={txt}
      onFocus={(e) => { focus.current = true; e.target.select(); p.onFocus?.(e); }}
      onBlur={(e) => { focus.current = false; setTxt(value == null ? '' : String(value).replace('.', ',')); p.onBlur?.(e); }}
      onChange={(e) => {
        const v = e.target.value; setTxt(v);
        const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
        onChange(isNaN(n) ? 0 : n);
      }} />
  );
}

/** Logo SAMLOCK (charte graphique). variant : symbol|horizontal|stacked + -dark (fond clair) | -light (fond foncé). */
export function BrandMark({ variant = 'horizontal-dark', size = 32, name = 'M', className }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <div className={cn('rounded-lg bg-accent grid place-items-center text-white font-bold', className)} style={{ height: size, width: size }}>{name[0]}</div>;
  return <img src={`/api/public/brand/${variant}.png`} alt="SAMLOCK" height={size} style={{ height: size, width: 'auto' }} onError={() => setOk(false)} className={className} />;
}


/* Boîte de confirmation du logiciel (remplace confirm()/prompt() du navigateur).
   ask({ title, message, confirmLabel, tone: 'danger' | 'default', requireText }) → Promise<boolean> */
let openAsk = null;
export const ask = (opts) => new Promise((resolve) => {
  if (!openAsk) return resolve(window.confirm(typeof opts === 'string' ? opts : opts.message));
  openAsk(typeof opts === 'string' ? { message: opts } : opts, resolve);
});

export function ConfirmHost() {
  const [st, setSt] = useState(null); const [txt, setTxt] = useState('');
  useEffect(() => { openAsk = (o, resolve) => { setTxt(''); setSt({ o, resolve }); }; return () => { openAsk = null; }; }, []);
  const done = (v) => { st?.resolve(v); setSt(null); };
  useEffect(() => {
    if (!st) return;
    const h = (e) => { if (e.key === 'Escape') done(false); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  if (!st) return null;
  const { title, message, confirmLabel, tone = 'danger', requireText, cancelLabel } = st.o;
  const danger = tone === 'danger'; const locked = requireText && txt !== requireText;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center px-4 fade" style={{ background: 'rgba(28,25,23,.5)' }} onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div className="pop bg-white rounded-2xl shadow-2xl w-full max-w-[440px] p-6" role="alertdialog" aria-modal="true">
        <div className="flex gap-4">
          <span className={cn('w-10 h-10 rounded-full grid place-items-center shrink-0', danger ? 'bg-rose-50 text-rose-600' : 'bg-orange-50 text-accent')}>{danger ? <Trash2 size={18} /> : <AlertTriangle size={18} />}</span>
          <div className="min-w-0">
            <h3 className="font-semibold text-[16px] leading-snug">{title || 'Confirmer'}</h3>
            {message && <p className="text-stone-600 text-[13.5px] mt-1.5 leading-relaxed whitespace-pre-line">{message}</p>}
          </div>
        </div>
        {requireText && (
          <div className="mt-4">
            <div className="text-[12.5px] text-stone-500 mb-1.5">Pour confirmer, tapez <b className="text-stone-800">{requireText}</b></div>
            <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !locked && done(true)} className="w-full h-10 px-3 rounded-lg border border-stone-300 bg-white outline-none focus:border-accent focus:ring-2 focus:ring-orange-100" />
          </div>
        )}
        <div className="flex justify-end gap-2.5 mt-6">
          <Btn onClick={() => done(false)}>{cancelLabel || 'Annuler'}</Btn>
          <button autoFocus={!requireText} disabled={locked} onClick={() => done(true)} className={cn('h-9 px-4 rounded-lg text-[13.5px] font-medium text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed', danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-accent hover:bg-orange-800')}>{confirmLabel || (danger ? 'Supprimer' : 'Confirmer')}</button>
        </div>
      </div>
    </div>
  );
}


/* ---- Recherche, tri et filtre communs à toutes les listes ---- */
export function SearchBox({ value, onChange, placeholder = 'Rechercher…', className }) {
  return (
    <div className={cn('relative w-full md:w-72', className)}>
      <Search size={14} className="absolute left-3 top-2.5 text-stone-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-9 pl-9 pr-8 rounded-lg border border-stone-300 bg-white outline-none focus:border-accent focus:ring-3 focus:ring-orange-200/70 text-[13.5px]" />
      {value && <button onClick={() => onChange('')} className="absolute right-2 top-2 p-0.5 rounded text-stone-400 hover:text-stone-700" aria-label="Effacer"><X size={14} /></button>}
    </div>
  );
}

const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Filtre texte (insensible aux accents/casse, tous les mots) sur les champs retournés par `text(row)`. */
export const matches = (row, q, text) => !q || q.trim().split(/\s+/).every((w) => norm(text(row)).includes(norm(w)));

/** Tri : cols = { cle: (row) => valeur }. Retourne { rows, key, dir, toggle, th(cle, libellé, opts) }. */
export function useSort(rows, cols, initial = null) {
  const [st, setSt] = useState(initial || { key: null, dir: 'asc' });
  const toggle = (k) => setSt((s) => (s.key !== k ? { key: k, dir: 'asc' } : s.dir === 'asc' ? { key: k, dir: 'desc' } : { key: null, dir: 'asc' }));
  const sorted = (() => {
    const get = st.key && cols[st.key]; if (!get) return rows;
    const m = st.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null || x === '') return y == null || y === '' ? 0 : 1; // vides toujours en bas
      if (y == null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true, sensitivity: 'base' })) * m;
    });
  })();
  const th = (k, label, { right = false, className = '' } = {}) => (
    <th className={cn(className)} aria-sort={st.key === k ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => toggle(k)} className={cn('inline-flex items-center gap-1 uppercase tracking-wide whitespace-nowrap hover:text-stone-700 transition-colors', right && 'flex-row-reverse', st.key === k && 'text-stone-800')}>
        {label}{st.key === k ? (st.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ChevronsUpDown size={11} className="opacity-40" />}
      </button>
    </th>
  );
  return { rows: sorted, key: st.key, dir: st.dir, toggle, th };
}

/** Pastilles de filtre (une seule active). options = [[valeur, libellé, compteur?]] */
export function Chips({ value, onChange, options }) {
  return (
    <div className="chips w-full md:w-auto flex gap-1.5 md:gap-1 md:flex-wrap overflow-x-auto md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0 max-w-[100vw] md:max-w-none">
      {options.map(([k, l, n]) => (
        <button key={k} onClick={() => onChange(k)} className={cn('shrink-0 whitespace-nowrap px-3.5 md:px-3 h-8 rounded-full md:rounded-lg text-[13px] font-medium border md:border-transparent', value === k ? 'bg-stone-900 text-white border-stone-900' : 'text-stone-600 bg-white md:bg-transparent border-line hover:bg-stone-100')}>
          {l}{n != null && <span className="opacity-60 ml-1 num">{n}</span>}
        </button>
      ))}
    </div>
  );
}
