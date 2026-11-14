import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Kanban, Users, FileText, Package, ShieldCheck, HardHat, CalendarDays, Receipt, Landmark, CalendarCheck, Share2, Settings as Cog, Search, Plus, Command, LogOut, Menu, ArrowLeft, FileDown, Sparkles, Boxes, Car, Wrench } from 'lucide-react';
import { ConfirmHost, ToastProvider, cn, Avatar, BrandMark } from './lib/ui.jsx';
import { get, post } from './lib/api.js';
import Dashboard from './pages/Dashboard.jsx';
const Pipeline = lazy(() => import('./pages/Pipeline.jsx'));
const Contacts = lazy(() => import('./pages/Contacts.jsx'));
const ContactDetail = lazy(() => import('./pages/ContactDetail.jsx'));
const Catalog = lazy(() => import('./pages/Catalog.jsx'));
import Quotes from './pages/Quotes.jsx';
const QuoteEditor = lazy(() => import('./pages/QuoteEditor.jsx'));
const Validations = lazy(() => import('./pages/Validations.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
import SupplierPublic from './pages/SupplierPublic.jsx';
const Interventions = lazy(() => import('./pages/Interventions.jsx'));
const InterventionDetail = lazy(() => import('./pages/InterventionDetail.jsx'));
import Login from './pages/Login.jsx';
const Social = lazy(() => import('./pages/Social.jsx'));
const Invoices = lazy(() => import('./pages/Invoices.jsx'));
const Compta = lazy(() => import('./pages/Compta.jsx'));
const Agenda = lazy(() => import('./pages/Agenda.jsx'));
import SignPage from './pages/SignPage.jsx';
import SubPublic from './pages/SubPublic.jsx';
const Chat = lazy(() => import('./pages/Chat.jsx'));
const Planning = lazy(() => import('./pages/Planning.jsx'));
const Stock = lazy(() => import('./pages/Stock.jsx'));
const Ik = lazy(() => import('./pages/Ik.jsx'));
const SousTraitants = lazy(() => import('./pages/SousTraitants.jsx'));

const NAV = [
  { to: '/', label: 'Accueil', icon: LayoutDashboard, end: true },
  { to: '/pipeline', label: 'Demandes', icon: Kanban },
  { to: '/interventions', label: 'Interventions', icon: HardHat },
  { to: '/agenda', label: 'Agenda', icon: CalendarCheck },
  { to: '/planning', label: 'Planning', icon: CalendarDays },
  { to: '/devis', label: 'Devis', icon: FileText },
  { to: '/factures', label: 'Factures', icon: Receipt },
  { to: '/stock', label: 'Stock', icon: Boxes },
  { to: '/sous-traitants', label: 'Sous-traitants', icon: Wrench },
  { to: '/indemnites-km', label: 'Indemnités km', icon: Car },
  { to: '/comptabilite', label: 'Comptabilité', icon: Landmark },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/catalogue', label: 'Catalogue', icon: Package },
  { to: '/reseaux', label: 'Réseaux', icon: Share2 },
  { to: '/chat', label: 'Chat IA', icon: Sparkles },
  { to: '/validations', label: 'Validations', icon: ShieldCheck, badge: true },
];

function Sidebar({ pending, auth, open, setOpen }) {
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  return (
    <>
    {open && <div className="md:hidden fixed inset-0 z-[55] fade" style={{ background: 'rgba(28,25,23,.5)' }} onClick={() => setOpen(false)} />}
    <aside className={cn('flex w-[252px] md:w-[232px] shrink-0 flex-col bg-[#FF6D1A] text-white/90 h-full overflow-y-auto fixed md:static inset-y-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] left-0 z-[60] md:z-auto transition-transform duration-200 md:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
      <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
        <BrandMark variant="symbol-light" size={34} />
        <div className="leading-tight"><div className="font-semibold text-white text-[14px]">SAMLOCK</div><div className="text-[11px] text-white/80">Serrurerie · Gestion</div></div>
      </div>
      <button onClick={() => window.dispatchEvent(new Event('open-palette'))} className="mx-3 mb-3 flex items-center gap-2 rounded-lg bg-black/15 hover:bg-black/20 px-3 h-9 text-white/80 text-[13px]">
        <Search size={14} /> Rechercher <kbd className="ml-auto text-[10.5px] bg-black/20 rounded px-1.5 py-0.5 text-white">⌘K</kbd>
      </button>
      <nav className="px-3 flex flex-col gap-0.5">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn('flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13.5px] font-medium transition-colors', isActive ? 'bg-black/20 text-white' : 'hover:bg-black/20/60 hover:text-white')}>
            {({ isActive }) => (<>
              <n.icon size={16} className={isActive ? 'text-white' : 'text-white/70'} />
              {n.label}
              {n.badge && pending > 0 && <span className="ml-auto bg-white text-[#FF6D1A] text-[11px] font-semibold rounded-full min-w-5 h-5 px-1.5 grid place-items-center">{pending}</span>}
            </>)}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto p-3 space-y-0.5">
        <NavLink to="/parametres" className={({ isActive }) => cn('flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13.5px] font-medium', isActive ? 'bg-black/20 text-white' : 'hover:bg-black/20/60 hover:text-white')}>
          <Cog size={16} className="text-white/70" /> Paramètres
        </NavLink>
        {auth && <button onClick={async () => { await post('/auth/logout'); location.reload(); }} className="w-full flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13.5px] font-medium hover:bg-black/20/60 hover:text-white text-left"><LogOut size={16} className="text-white/70" /> Se déconnecter</button>}
      </div>
    </aside>
    </>
  );
}


// Mobile : chaque tableau est présenté en cartes (libellé de colonne devant chaque valeur).
function useResponsiveTables() {
  useEffect(() => {
    let raf = 0;
    const run = () => {
      raf = 0;
      document.querySelectorAll('main table:not(.rt-off)').forEach((t) => {
        t.classList.add('rt');
        const heads = [...t.querySelectorAll('thead th')].map((h) => (h.textContent || '').trim());
        t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => {
          const l = heads[i] || ''; if (td.dataset.label !== l) td.dataset.label = l;
          const txt = (td.textContent || '').trim();
          const wide = txt.length > 24 ? '1' : '';
          if ((td.dataset.wide || '') !== wide) { if (wide) td.dataset.wide = wide; else delete td.dataset.wide; }
          const act = !txt && td.querySelector('button, a, svg') ? '1' : '';
          if ((td.dataset.act || '') !== act) { if (act) td.dataset.act = act; else delete td.dataset.act; }
        }));
      });
    };
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(run); });
    mo.observe(document.body, { childList: true, subtree: true }); run();
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);
}

function MobileNav({ pending, setNavOpen }) {
  const loc = useLocation();
  const main = ['/', '/interventions', '/devis', '/agenda'];
  const items = NAV.filter((n) => main.includes(n.to));
  const cls = (a) => cn('relative flex flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-[10.5px] font-medium', a ? 'text-accent' : 'text-stone-500');
  const inMain = main.some((m) => (m === '/' ? loc.pathname === '/' : loc.pathname.startsWith(m)));
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-line grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cls(isActive)}>
          {({ isActive }) => (<><span className={cn('grid place-items-center h-7 w-12 rounded-full transition-colors', isActive && 'bg-orange-50')}><n.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} /></span>{n.label}</>)}
        </NavLink>
      ))}
      <button onClick={() => setNavOpen(true)} className={cls(!inMain)} aria-label="Menu">
        <span className={cn('relative grid place-items-center h-7 w-12 rounded-full', !inMain && 'bg-orange-50')}><Menu size={20} />{pending > 0 && <span className="absolute -top-0.5 right-1 bg-accent text-white text-[10px] rounded-full min-w-4 h-4 px-1 grid place-items-center">{pending}</span>}</span>
        Menu
      </button>
    </nav>
  );
}

const PdfPages = lazy(() => import('./lib/PdfPages.jsx'));
// Visionneuse PDF intégrée : jamais de sortie de l'appli (pas de bouton retour en mode installé).
function PdfViewer() {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const open = (u) => setUrl(u);
    const onEvt = (e) => open(e.detail);
    const onClick = (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented) return;
      const h = a.getAttribute('href') || '';
      if (h.startsWith('/api/') && (a.target === '_blank') && !a.hasAttribute('download')) { e.preventDefault(); open(h); }
    };
    const onKey = (e) => { if (e.key === 'Escape') setUrl(null); };
    window.addEventListener('open-pdf', onEvt); document.addEventListener('click', onClick, true); window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('open-pdf', onEvt); document.removeEventListener('click', onClick, true); window.removeEventListener('keydown', onKey); };
  }, []);
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-stone-100">
      <div className="flex items-center gap-2 px-3 bg-stone-900 text-white shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(56px + env(safe-area-inset-top))' }}>
        <button onClick={() => setUrl(null)} className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-stone-800 active:bg-stone-700 text-[14px] font-medium"><ArrowLeft size={18} /> Retour</button>
        <a href={url} download className="ml-auto flex items-center gap-1.5 h-10 px-3 rounded-lg active:bg-stone-800 text-[13px]"><FileDown size={17} /> Télécharger</a>
      </div>
      <Suspense fallback={<div className="flex-1 grid place-items-center text-stone-500">Chargement…</div>}><PdfPages url={url} /></Suspense>
    </div>
  );
}

function Palette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState({ contacts: [], quotes: [], items: [] });
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); } if (e.key === 'Escape') setOpen(false); };
    const o = () => setOpen(true);
    window.addEventListener('keydown', k); window.addEventListener('open-palette', o);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('open-palette', o); };
  }, []);
  useEffect(() => { if (open) { setQ(''); setIdx(0); } }, [open]);
  useEffect(() => { if (!open) return; const t = setTimeout(() => get('/search?q=' + encodeURIComponent(q)).then(setRes).catch(() => {}), 120); return () => clearTimeout(t); }, [q, open]);
  const actions = useMemo(() => [
    { label: 'Nouveau devis', icon: Plus, go: '/devis?new=1' },
    { label: 'Nouveau contact', icon: Plus, go: '/contacts?new=1' },
    { label: 'Nouvel article du catalogue', icon: Plus, go: '/catalogue?new=1' },
    { label: 'Ouvrir la file de validation', icon: Command, go: '/validations' },
  ].filter((a) => !q || a.label.toLowerCase().includes(q.toLowerCase())), [q]);
  const flat = [
    ...actions.map((a) => ({ ...a, group: 'Actions' })),
    ...res.contacts.map((c) => ({ label: c.company || c.name, sub: `${c.kind} · ${c.city || ''}`, go: `/contacts/${c.id}`, group: 'Contacts', avatar: c.name })),
    ...res.quotes.map((x) => ({ label: `${x.number || 'Brouillon'} — ${x.title || x.project_title}`, go: `/devis/${x.id}`, group: 'Devis', icon: FileText })),
    ...res.items.map((i) => ({ label: i.label, sub: i.ref, go: `/catalogue?q=${encodeURIComponent(i.label)}`, group: 'Catalogue', icon: Package })),
  ];
  if (!open) return null;
  const run = (it) => { setOpen(false); nav(it.go); };
  return (
    <div className="fixed inset-0 z-[70] fade pt-[14vh] px-4" style={{ background: 'rgba(28,25,23,.45)' }} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="pop mx-auto max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-line"><Search size={16} className="text-stone-400" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} placeholder="Client, devis, article, action…" className="flex-1 h-12 outline-none text-[15px]"
            onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, flat.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); } if (e.key === 'Enter' && flat[idx]) run(flat[idx]); }} />
        </div>
        <div className="max-h-[50vh] overflow-auto p-2 scroll-thin">
          {flat.length === 0 && <div className="p-6 text-center text-stone-400">Aucun résultat</div>}
          {flat.map((it, i) => (
            <div key={i}>
              {(i === 0 || flat[i - 1].group !== it.group) && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{it.group}</div>}
              <button onMouseEnter={() => setIdx(i)} onClick={() => run(it)} className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left', i === idx ? 'bg-orange-50' : '')}>
                {it.avatar ? <Avatar name={it.avatar} size={24} /> : it.icon && <it.icon size={16} className="text-stone-400" />}
                <span className="font-medium">{it.label}</span>{it.sub && <span className="text-stone-400 text-[12px]">{it.sub}</span>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => { const a = () => setOn(true), b = () => setOn(false); window.addEventListener('online', a); window.addEventListener('offline', b); return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); }; }, []);
  return on;
}

function Shell({ auth }) {
  const online = useOnline();
  const [pending, setPending] = useState(0);
  const loc = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  useResponsiveTables();
  useEffect(() => {
    const f = () => get('/dashboard').then((d) => setPending(d.pendingOutbox + d.pendingPrices)).catch(() => {});
    f(); const t = setInterval(f, 20000); return () => clearInterval(t);
  }, [loc.pathname]);
  return (
    <div className="h-full flex">
      <Sidebar pending={pending} auth={auth} open={navOpen} setOpen={setNavOpen} />
      <main className="flex-1 min-w-0 h-full overflow-auto scroll-thin pb-[env(safe-area-inset-bottom)]">
        {!online && <div className="sticky top-0 z-50 bg-amber-100 text-amber-900 text-[12.5px] text-center py-1.5 px-3 border-b border-amber-200">Hors ligne — consultation des données déjà ouvertes. Les modifications sont désactivées.</div>}
        <div className="md:hidden sticky top-0 z-40 flex items-center gap-3 px-3 bg-stone-900 text-white" style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(56px + env(safe-area-inset-top))' }}>
          <button onClick={() => setNavOpen(true)} aria-label="Menu" className="relative w-10 h-10 grid place-items-center rounded-lg active:bg-stone-800"><Menu size={22} />{pending > 0 && <span className="absolute top-1 right-0.5 bg-accent text-[10px] rounded-full min-w-4 h-4 px-1 grid place-items-center">{pending}</span>}</button>
          <BrandMark variant="symbol-light" size={26} /><span className="font-semibold text-[14px]">SAMLOCK</span>
          <button onClick={() => window.dispatchEvent(new Event('open-palette'))} aria-label="Rechercher" className="ml-auto w-10 h-10 grid place-items-center rounded-lg active:bg-stone-800"><Search size={20} /></button>
        </div>
        <Suspense fallback={<div className="p-8"><div className="h-8 w-48 rounded-lg bg-stone-200/70 animate-pulse" /><div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">{[0,1,2,3].map((i) => <div key={i} className="h-28 rounded-2xl bg-stone-200/50 animate-pulse" />)}</div></div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/interventions" element={<Interventions />} />
          <Route path="/interventions/:id" element={<InterventionDetail />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="/reseaux" element={<Social />} />
          <Route path="/factures" element={<Invoices />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/sous-traitants" element={<SousTraitants />} />
          <Route path="/indemnites-km" element={<Ik />} />
          <Route path="/comptabilite" element={<Compta />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/catalogue" element={<Catalog />} />
          <Route path="/devis" element={<Quotes />} />
          <Route path="/devis/:id" element={<QuoteEditor />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/validations" element={<Validations />} />
          <Route path="/parametres" element={<Settings />} />
        </Routes>
        </Suspense>
      </main>
      <Palette />
      <PdfViewer />
    </div>
  );
}


function Gate() {
  const [st, setSt] = useState(null); // null = chargement
  const check = () => get('/auth/me').then(setSt).catch(() => setSt({ auth_required: false, logged_in: true }));
  useEffect(() => { check(); const f = () => setSt((s) => ({ ...(s || {}), auth_required: true, logged_in: false })); window.addEventListener('auth-expired', f); return () => window.removeEventListener('auth-expired', f); }, []);
  if (!st) return null;
  if (!st.logged_in) return <Login onDone={() => { setSt(null); check(); }} />;
  return <Shell auth={st.auth_required} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/fournisseur/:token" element={<SupplierPublic />} />
          <Route path="/signer/:type/:token" element={<SignPage />} />
          <Route path="/soustraitant/:token" element={<SubPublic />} />
          <Route path="/*" element={<Gate />} />
        </Routes>
        <ConfirmHost />
      </ToastProvider>
    </BrowserRouter>
  );
}
