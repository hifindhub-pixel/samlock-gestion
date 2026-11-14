export async function api(path, { method = 'GET', body, form } = {}) {
  if (path === '/auth/logout') { try { navigator.serviceWorker?.controller?.postMessage('clear-data'); } catch { /* */ } }
  let res;
  try { res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
  }); } catch (e) { throw new Error(navigator.onLine === false ? 'Vous êtes hors ligne : action impossible pour le moment.' : 'Connexion au serveur impossible.'); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && data?.auth) window.dispatchEvent(new Event('auth-expired'));
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}
export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });
