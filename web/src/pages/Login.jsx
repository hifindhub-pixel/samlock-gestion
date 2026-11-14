import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { post } from '../lib/api.js';
import { BrandMark, Btn, Input } from '../lib/ui.jsx';

export default function Login({ onDone }) {
  const [user, setUser] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [show, setShow] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post('/auth/login', { user, password }); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-full grid place-items-center bg-[#FF6D1A] p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-7">
        <div className="mb-7 flex flex-col items-center"><BrandMark variant="stacked-dark" size={110} /><div className="text-[12.5px] text-stone-500 mt-3">Gestion · accès sécurisé</div></div>
        <label className="block mb-3"><span className="block text-[12px] font-medium text-stone-600 mb-1">Identifiant</span><Input autoFocus autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} /></label>
        <label className="block mb-4"><span className="block text-[12px] font-medium text-stone-600 mb-1">Mot de passe</span><div className="relative"><Input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-11" />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} title={show ? 'Masquer' : 'Afficher'} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        {err && <div className="text-rose-600 text-[13px] mb-3">{err}</div>}
        <Btn variant="primary" size="lg" className="w-full" loading={busy} disabled={!user || !password} icon={Lock} type="submit">Se connecter</Btn>
        <p className="text-[11.5px] text-stone-400 mt-4 text-center">La session se ferme après une période d'inactivité.</p>
      </form>
    </div>
  );
}
