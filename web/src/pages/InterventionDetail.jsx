import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Expenses from './Expenses.jsx';
import Billing from './Billing.jsx';
import { Wallet, Camera, FileText, Upload, Trash2, HardHat, Users, Receipt, ClipboardCheck, Play, Send, CheckCircle2, AlertTriangle, MapPin, ChevronLeft, FileDown, Plus, ShieldCheck, Clock } from 'lucide-react';
import { get, post, put, del, api } from '../lib/api.js';
import { Btn, Card, Empty, Field, Input, MarginPill, Modal, PageHeader, StageBadge, Select, Textarea, NumInput, Badge, useFetch, useToast, cn } from '../lib/ui.jsx';
import { money, money0, dateFr } from '../lib/format.js';
import { InvBadge, KIND_INV } from './Invoices.jsx';

const TABS = [['apercu', 'Vue d\'ensemble', HardHat], ['photos', 'Photos & documents', Camera], ['st', 'Sous-traitants', Users], ['dep', 'Dépenses', Wallet], ['fact', 'Facturation', Receipt]];

export default function InterventionDetail() {
  const { id } = useParams(); const toast = useToast();
  const { data: d, reload } = useFetch(() => get(`/dossier/${id}`), [id]);
  const [tab, setTab] = useState(new URLSearchParams(window.location.search).get('tab') || 'apercu');
  if (!d) return null;
  const { project: p, contact: c, planned: pl } = d;
  const act = async (fn, ok) => { try { await fn(); await reload(); ok && toast(ok); } catch (e) { toast(e.message, 'err'); } };
  const pendingValidations = d.invoices.filter((i) => i.status === 'brouillon').length;

  return (
    <div>
      <div className="px-8 pt-5"><Link to="/factures" className="inline-flex items-center gap-1 text-[12.5px] text-stone-500 hover:text-stone-800"><ChevronLeft size={14} />Factures</Link></div>
      <PageHeader title={c.company || c.name} subtitle={<span className="flex items-center gap-3 flex-wrap"><Link to={`/contacts/${c.id}`} className="hover:text-accent">Fiche client</Link>{p.address && <span>{[p.address, p.city].filter(Boolean).join(', ')}</span>}</span>} />
      <div className="px-8 pb-12 pt-6">
        <Billing d={d} id={id} reload={reload} act={act} />
      </div>
    </div>
  );
}
