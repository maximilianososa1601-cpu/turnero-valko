// turnero-client.js — Librería compartida
const API = `${location.protocol}//${location.hostname}${location.port?':'+location.port:''}/api`;
const WS_URL = `${location.protocol==='https:'?'wss':'ws'}://${location.hostname}${location.port?':'+location.port:''}/ws`;

const Auth = {
  get token()  { return sessionStorage.getItem('tk'); },
  get user()   { try { return JSON.parse(sessionStorage.getItem('tu')); } catch { return null; } },
  set(token, user) { sessionStorage.setItem('tk', token); sessionStorage.setItem('tu', JSON.stringify(user)); },
  clear()      { sessionStorage.removeItem('tk'); sessionStorage.removeItem('tu'); },
  isLoggedIn() { return !!this.token; },
};

async function _req(method, path, body) {
  const opts = { method, headers: { Authorization: Auth.token ? `Bearer ${Auth.token}` : '' } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(`${API}${path}`, opts);
  if (r.status === 401) { Auth.clear(); location.href = '/login'; return; }
  if (!r.ok) { const e = await r.json().catch(()=>({error:r.statusText})); throw new Error(e.error||r.statusText); }
  return r.json();
}
const apiGet  = p    => _req('GET',    p);
const apiPost = (p,b)=> _req('POST',   p, b);
const apiPut  = (p,b)=> _req('PUT',    p, b);
const apiDel  = p    => _req('DELETE', p);

async function apiDownload(path, filename) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${Auth.token}` } });
  if (!r.ok) throw new Error('Error al descargar');
  const blob = await r.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

async function login(username, password, org_slug = null) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, ...(org_slug ? { org_slug } : {}) }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Error de autenticación');
  Auth.set(data.token, data.user);
  return data;
}

async function logout() {
  try { await apiPost('/auth/logout'); } catch {}
  Auth.clear(); location.href = '/login';
}

function requireLogin(roles = []) {
  if (!Auth.isLoggedIn()) { location.href = '/login'; return false; }
  const user = Auth.user;
  if (roles.length && !roles.includes(user?.rol)) {
    alert(`Acceso denegado. Requiere: ${roles.join(' o ')}`);
    Auth.clear(); location.href = '/login'; return false;
  }
  return user;
}

function getOrgFromURL() { return new URLSearchParams(location.search).get('org'); }

class TurneroWS {
  constructor({ view, orgId, sucId, handlers = {} }) {
    this.view = view; this.orgId = orgId; this.sucId = sucId;
    this.handlers = handlers; this.retries = 0; this.connect();
  }
  connect() {
    this.ws = new WebSocket(WS_URL);
    this.ws.onopen = () => {
      this.retries = 0;
      if (Auth.token) this.ws.send(JSON.stringify({ type: 'auth', token: Auth.token }));
      this.ws.send(JSON.stringify({ type: 'subscribe', view: this.view, org_id: this.orgId, suc_id: this.sucId }));
      this.handlers.onOpen?.();
    };
    this.ws.onmessage = e => {
      try { const m = JSON.parse(e.data); (this.handlers[m.type] || this.handlers.default)?.(m.data, m); } catch {}
    };
    this.ws.onclose = () => {
      const d = Math.min(1000 * 2 ** Math.min(this.retries++, 5), 30000);
      this.handlers.onClose?.();
      setTimeout(() => this.connect(), d);
    };
    this.ws.onerror = () => {};
  }
}

function formatTime(s)  { if (!s) return '—'; return new Date(s).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}); }
function formatDate(s)  { if (!s) return '—'; return new Date(s).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}); }
function formatSecs(s)  {
  if (s==null||isNaN(s)) return '—'; s=parseInt(s);
  if(s<60) return `${s}s`; if(s<3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}
function liveClock(el) {
  const t=()=>el.textContent=new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  t(); setInterval(t,1000);
}
