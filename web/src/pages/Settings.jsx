import { useEffect, useState } from 'react';
import { api, get, post, put } from '../lib/api.js';
import { Btn, Card, Field, Input, PageHeader, Select, Textarea, useFetch, useToast } from '../lib/ui.jsx';

function InboxCard({ f, set }) {
  const toast = useToast(); const [st, setSt] = useState(null); const [busy, setBusy] = useState(false);
  const load = () => get('/inbox/status').then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  const sync = async () => { setBusy(true); try { const r = await post('/inbox/sync', {}); toast(r.added ? `${r.added} e-mail(s) importé(s)` : 'Boîte à jour'); } catch (e) { toast(e.message, 'err'); } setBusy(false); load(); };
  return (
    <Card className="p-5"><div className="flex items-center gap-2 mb-1"><h2 className="font-semibold">Boîte mail (lecture)</h2>
      <span className={`text-[11.5px] font-medium rounded-md px-2 py-0.5 ${st?.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{st?.configured ? 'connectée' : 'non connectée'}</span></div>
      <p className="text-stone-500 mb-4">Les e-mails échangés avec un client apparaissent sur sa fiche. <b>Lecture seule</b> : rien n'est envoyé, supprimé ni marqué comme lu. Gmail : activez la validation en 2 étapes puis créez un « mot de passe d'application » (compte Google → Sécurité). Si l'envoi d'e-mails ci-dessus est déjà réglé avec la même boîte, laissez ces champs vides.</p>
      <div className="grid grid-cols-3 gap-3.5">
        <Field label="Serveur IMAP"><Input value={f.imap_host || ''} onChange={set('imap_host')} placeholder="imap.gmail.com" /></Field>
        <Field label="Identifiant"><Input value={f.imap_user || ''} onChange={set('imap_user')} placeholder="contact@samlock.fr" /></Field>
        <Field label="Mot de passe d'application"><Input type="password" value={f.imap_pass || ''} onChange={set('imap_pass')} placeholder={f.imap_pass_set ? '•••••••• (enregistré)' : ''} autoComplete="new-password" /></Field>
      </div>
      <div className="flex items-center gap-3 mt-4"><Btn loading={busy} onClick={sync} disabled={!st?.configured}>Synchroniser maintenant</Btn>
        <span className="text-[12.5px] text-stone-500">{st?.last_error ? <span className="text-rose-600">{st.last_error}</span> : st?.last_sync ? `${st.count} e-mails · dernière synchro ${new Date(st.last_sync).toLocaleString('fr-FR')}` : 'Enregistrez les paramètres puis synchronisez.'}</span></div>
    </Card>
  );
}

function PayCard({ f, set, setF }) {
  const [st, setSt] = useState(null);
  useEffect(() => { get('/payments/status').then(setSt).catch(() => {}); }, [f.stripe_secret_set]);
  return (
    <Card className="p-5"><div className="flex items-center gap-2 mb-1"><h2 className="font-semibold">Paiement en ligne et relances</h2>
      <span className={`text-[11.5px] font-medium rounded-md px-2 py-0.5 ${st?.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{st?.enabled ? 'paiement activé' : 'paiement non activé'}</span></div>
      <p className="text-stone-500 mb-4">Vos factures par e-mail contiennent un lien « Payer par carte » (Stripe). Aucune donnée bancaire ne passe par l'application ; la facture est marquée payée automatiquement. Créez un compte Stripe, copiez la clé secrète (sk_live_…), puis ajoutez un webhook vers l'adresse ci-dessous pour l'événement <b>checkout.session.completed</b> et collez sa clé de signature (whsec_…). Frais Stripe à votre charge (environ 1,5 % + 0,25 € par carte européenne).</p>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Clé secrète Stripe"><Input type="password" value={f.stripe_secret || ''} onChange={set('stripe_secret')} placeholder={f.stripe_secret_set ? '•••••••• (enregistrée)' : 'sk_live_…'} autoComplete="new-password" /></Field>
        <Field label="Clé de signature du webhook"><Input type="password" value={f.stripe_webhook_secret || ''} onChange={set('stripe_webhook_secret')} placeholder={f.stripe_webhook_secret_set ? '•••••••• (enregistrée)' : 'whsec_…'} autoComplete="new-password" /></Field>
      </div>
      <div className="mt-3 text-[12.5px] text-stone-500">Adresse du webhook : <code className="bg-stone-100 rounded px-1.5 py-0.5 select-all break-all">{location.origin}/api/public/stripe/webhook</code></div>
      <label className="mt-4 flex items-start gap-2.5 text-[13px] text-stone-700"><input type="checkbox" checked={f.auto_reminders !== '0'} onChange={(e) => setF({ ...f, auto_reminders: e.target.checked ? '1' : '0' })} className="w-4 h-4 mt-0.5 accent-orange-700" /><span><b>Préparer automatiquement les relances</b> (factures échues depuis plus de 2 jours, devis sans réponse depuis 7 jours). Elles arrivent dans « Validations » : rien ne part sans votre accord.</span></label>
    </Card>
  );
}

export default function Settings() {
  const { data } = useFetch(() => get('/settings')); const { data: usage } = useFetch(() => get('/agent/status'));
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false); const [testing, setTesting] = useState(false); const [testTo, setTestTo] = useState(''); const toast = useToast();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  let brackets = []; try { brackets = JSON.parse(f.travel_brackets || '[]'); } catch { brackets = []; }
  const setBr = (b) => setF({ ...f, travel_brackets: JSON.stringify(b) });
  const save = async () => { setBusy(true); try { const r = await put('/settings', f); setF({ ...r, smtp_pass: '' }); toast('Paramètres enregistrés'); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  const testMail = async () => { setTesting(true); try { await put('/settings', f); const r = await post('/settings/test-mail', { to: testTo || f.company_email }); toast(`E-mail de test envoyé à ${r.to}`); } catch (e) { toast(e.message, 'err'); } setTesting(false); };
  return (
    <div className="form-stack">
      <PageHeader title="Paramètres" subtitle="Ces informations apparaissent sur les devis et pilotent les calculs." actions={<Btn variant="primary" loading={busy} onClick={save}>Enregistrer</Btn>} />
      <div className="px-8 pb-10 max-w-3xl space-y-6">
        <Card className="p-5"><h2 className="font-semibold mb-4">Entreprise</h2>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Raison sociale"><Input value={f.company_name} onChange={set('company_name')} /></Field><Field label="SIREN / SIRET"><Input value={f.company_siret} onChange={set('company_siret')} /></Field>
            <Field label="Adresse" className="col-span-2"><Input value={f.company_address} onChange={set('company_address')} /></Field>
            <Field label="Téléphone"><Input value={f.company_phone} onChange={set('company_phone')} /></Field><Field label="E-mail"><Input value={f.company_email} onChange={set('company_email')} /></Field>
            <Field label="N° de TVA intracommunautaire"><Input value={f.company_vat_number} onChange={set('company_vat_number')} /></Field><Field label="Couleur des documents"><Input type="color" value={f.accent} onChange={set('accent')} className="!p-1" /></Field>
            <Field label="Forme juridique / capital social"><div className="flex gap-2"><Input value={f.company_legal_form || ''} onChange={set('company_legal_form')} className="!w-24" placeholder="SAS" /><Input value={f.company_capital || ''} onChange={set('company_capital')} placeholder="ex. 5 000 €" /></div></Field><div />
            <Field label="IBAN (affiché sur les factures)"><Input value={f.company_iban} onChange={set('company_iban')} /></Field><Field label="BIC"><Input value={f.company_bic} onChange={set('company_bic')} /></Field>
            <Field label="Mentions d’assurance (RC professionnelle, sur les devis)" className="col-span-2"><Textarea rows={4} value={f.company_insurance} onChange={set('company_insurance')} /></Field>
          </div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 mb-1"><h2 className="font-semibold">Envoi d'e-mails</h2><span className={`text-[11.5px] font-medium rounded-md px-2 py-0.5 ${f.mail_ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{f.mail_ready ? 'Actif' : 'Non configuré — envois simulés'}</span></div>
          <p className="text-stone-500 mb-4">Utilisez la boîte de l'entreprise (ex. contact@samlock.fr) : serveur SMTP, identifiant et mot de passe fournis par votre hébergeur de messagerie. Les messages partent de cette adresse ; les réponses arrivent dans la boîte habituelle.</p>
          <div className="grid grid-cols-3 gap-3.5">
            <Field label="Serveur SMTP"><Input value={f.smtp_host || ''} onChange={set('smtp_host')} placeholder="ssl0.ovh.net, smtp.gmail.com…" /></Field>
            <Field label="Port" hint="587 (STARTTLS) ou 465 (SSL)"><Input value={f.smtp_port || ''} onChange={set('smtp_port')} /></Field>
            <Field label="Identifiant"><Input value={f.smtp_user || ''} onChange={set('smtp_user')} placeholder="contact@samlock.fr" /></Field>
            <Field label="Mot de passe" className="col-span-2"><Input type="password" value={f.smtp_pass || ''} onChange={set('smtp_pass')} placeholder={f.smtp_pass_set ? '•••••••• (enregistré — laisser vide pour conserver)' : ''} autoComplete="new-password" /></Field>
            <Field label="Envoyer un test à"><div className="flex gap-2"><Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={f.company_email} /><Btn loading={testing} onClick={testMail}>Tester</Btn></div></Field>
          </div></Card>
        <PayCard f={f} set={set} setF={setF} />
      <InboxCard f={f} set={set} />
        <Card className="p-5"><h2 className="font-semibold mb-1">Assistant IA (chat et micro)</h2>
          <p className="text-stone-500 mb-4">L'assistant répond aux questions sur l'activité et prépare des <b>brouillons</b> de devis et de factures dictés. Rien n'est jamais envoyé ni validé sans vous, et aucun prix n'est inventé. Il apparaît dans le menu (et en bouton micro) dès que la clé est enregistrée. La clé se crée sur <b>platform.claude.com</b> (compte API, crédit prépayé à recharger), distincte de l'abonnement claude.ai.</p>
          <div className="grid grid-cols-3 gap-3.5">
            <Field label="Clé API Claude" className="col-span-3" hint="Commence par sk-ant-… ; elle n'est jamais réaffichée après enregistrement."><Input type="password" value={f.anthropic_api_key || ''} onChange={set('anthropic_api_key')} placeholder={f.anthropic_api_key_set ? '•••••••• (enregistrée — laisser vide pour conserver)' : 'sk-ant-…'} autoComplete="new-password" /></Field>
            <Field label="Plafond par mois (€)" hint="L'assistant se bloque une fois atteint. 0 = sans plafond."><Input inputMode="decimal" value={f.ai_budget_month ?? ''} onChange={set('ai_budget_month')} /></Field>
            <Field label="Modèle des brouillons" hint="Chiffre devis et factures"><Input value={f.agent_model || ''} onChange={set('agent_model')} /></Field>
            <Field label="Modèle du chat" hint="Questions simples (moins cher)"><Input value={f.chat_model || ''} onChange={set('chat_model')} /></Field>
          </div>
          {usage && f.anthropic_api_key_set && <p className="mt-3 text-[13px] text-stone-600">Consommation ce mois-ci : <b>{usage.month_eur.toFixed(2).replace('.', ',')} €</b>{usage.budget_eur > 0 ? <> sur {usage.budget_eur} €</> : null} · {usage.calls} appel(s) <span className="text-stone-400">(estimation ; le détail exact est sur platform.claude.com)</span></p>}
          <div className="mt-5 pt-4 border-t border-line">
            <h3 className="font-medium mb-1">Devis par WhatsApp <span className="text-stone-400 font-normal">(optionnel)</span></h3>
            <p className="text-stone-500 text-[13px] mb-3">Vous écrivez l’intervention à votre numéro WhatsApp Business, le brouillon est créé et le lien vous est renvoyé. Nécessite un compte Meta for Developers (WhatsApp Cloud API). URL du webhook à renseigner chez Meta : <code className="bg-stone-100 rounded px-1.5 py-0.5 text-[12px]">{location.origin}/api/public/whatsapp</code></p>
            <div className="grid grid-cols-2 gap-3.5">
              <Field label="Numéros autorisés" hint="Séparés par des virgules (ex. 06 12 34 56 78)"><Input value={f.whatsapp_allowed || ''} onChange={set('whatsapp_allowed')} /></Field>
              <Field label="Identifiant du numéro (Phone number ID)"><Input value={f.whatsapp_phone_id || ''} onChange={set('whatsapp_phone_id')} /></Field>
              <Field label="Jeton d'accès"><Input type="password" value={f.whatsapp_token || ''} onChange={set('whatsapp_token')} placeholder={f.whatsapp_token_set ? '•••••••• (enregistré)' : ''} autoComplete="new-password" /></Field>
              <Field label="Secret de l'application Meta"><Input type="password" value={f.whatsapp_app_secret || ''} onChange={set('whatsapp_app_secret')} placeholder={f.whatsapp_app_secret_set ? '•••••••• (enregistré)' : ''} autoComplete="new-password" /></Field>
              <Field label="Jeton de vérification du webhook" hint="Au choix : le même texte à saisir chez Meta"><Input value={f.whatsapp_verify_token || ''} onChange={set('whatsapp_verify_token')} /></Field>
            </div>
          </div>
        </Card>
        <Card className="p-5"><h2 className="font-semibold mb-1">Sauvegarde</h2><p className="text-stone-500 mb-3">Téléchargez une copie complète de vos données (clients, devis, factures, interventions, réglages). Conservez-la dans un endroit sûr : elle contient des informations confidentielles.</p><a href="/api/backup" download className="inline-flex items-center rounded-lg bg-stone-900 text-white text-[13.5px] font-medium px-3.5 py-2 hover:bg-stone-800">Télécharger une sauvegarde</a></Card>
        <Card className="p-5"><h2 className="font-semibold mb-1">Véhicule, déplacements & indemnités kilométriques</h2>
          <p className="text-stone-500 mb-4">Chaque facture émise reçoit son trajet calculé automatiquement (adresse de l’intervention ↔ adresse de départ) et la part d’indemnité kilométrique du barème fiscal.</p>
          <div className="grid grid-cols-3 gap-3.5">
            <Field label="Calcul des IK"><Select value={f.ik_enabled === '0' ? '0' : '1'} onChange={set('ik_enabled')}><option value="1">Activé</option><option value="0">Désactivé</option></Select></Field>
            <Field label="Adresse de départ" className="col-span-2"><Input value={f.ik_origin || ''} onChange={set('ik_origin')} placeholder="Dépôt / domicile" /></Field>
            <Field label="Véhicule"><Select value={f.ik_vehicle || 'voiture'} onChange={set('ik_vehicle')}><option value="voiture">Voiture</option><option value="moto">Moto (&gt; 50 cm³)</option><option value="cyclo">Cyclomoteur</option></Select></Field>
            <Field label="Puissance fiscale (CV)"><Input type="number" value={f.ik_cv || ''} onChange={set('ik_cv')} /></Field>
            <Field label="Motorisation"><Select value={f.ik_electric === '1' ? '1' : '0'} onChange={set('ik_electric')}><option value="0">Thermique / hybride</option><option value="1">100 % électrique (+ 20 %)</option></Select></Field>
            <Field label="Trajet pris en compte"><Select value={f.ik_round_trip === '0' ? '0' : '1'} onChange={set('ik_round_trip')}><option value="1">Aller-retour</option><option value="0">Aller simple</option></Select></Field>
          </div>
          <div className="mt-5 pt-4 border-t border-line">
            <h3 className="font-medium mb-1">Frais de déplacement facturés au client</h3>
            <p className="text-stone-500 text-[13px] mb-3">Tranches de distance depuis votre adresse de départ. « Référence » = code de l’article du catalogue ajouté au devis (bouton « Ajouter le déplacement »).</p>
            <div className="space-y-2">{brackets.map((b, k) => (
              <div key={k} className="grid grid-cols-12 gap-3 items-end">
                <Field label={k === 0 ? 'Jusqu’à (km)' : undefined} className="col-span-4"><Input type="number" value={b.max} onChange={(e) => setBr(brackets.map((x, i) => (i === k ? { ...x, max: Number(e.target.value) } : x)))} /></Field>
                <Field label={k === 0 ? 'Référence catalogue' : undefined} className="col-span-6"><Input value={b.ref} onChange={(e) => setBr(brackets.map((x, i) => (i === k ? { ...x, ref: e.target.value } : x)))} /></Field>
                <Btn className="col-span-2" variant="ghost" onClick={() => setBr(brackets.filter((_, i) => i !== k))}>Retirer</Btn>
              </div>))}
              <Btn size="sm" onClick={() => setBr([...brackets, { max: (brackets.at(-1)?.max || 0) + 50, ref: '' }])}>Ajouter une tranche</Btn></div>
          </div>
        </Card>
        <Card className="p-5"><h2 className="font-semibold mb-1">Calculs et valeurs par défaut</h2><p className="text-stone-500 mb-4">Marge = (prix de vente − coût de revient) ÷ prix de vente. Méthode appliquée partout : catalogue, devis, demandes de prix.</p>
          <div className="grid grid-cols-3 gap-3.5">
            <Field label="Taux horaire interne (€/h)"><Input type="number" value={f.default_labor_rate} onChange={set('default_labor_rate')} /></Field>
            <Field label="Marge par défaut (%)"><Input type="number" value={f.default_margin} onChange={set('default_margin')} /></Field>
            <Field label="Seuil d'alerte de marge (%)"><Input type="number" value={f.margin_alert} onChange={set('margin_alert')} /></Field>
            <Field label="TVA par défaut (%)"><Input type="number" value={f.vat_default} onChange={set('vat_default')} /></Field>
            <Field label="Acompte (%)"><Input type="number" value={f.deposit_rate} onChange={set('deposit_rate')} /></Field>
            <Field label="Validité des devis (jours)"><Input type="number" value={f.quote_validity_days} onChange={set('quote_validity_days')} /></Field>
          </div></Card>
      </div>
    </div>
  );
}
