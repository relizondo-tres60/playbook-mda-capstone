/**
 * Cloudflare Worker — MDA Playbook Backend v2.1
 * ===============================================
 * Autenticación: Google OAuth External + Lista de acceso controlada por el admin
 * El admin agrega correos manualmente al panel. Solo esos correos pueden ingresar.
 * No se requiere ser admin de Google Workspace.
 *
 * Variables de entorno requeridas:
 *   GOOGLE_CLIENT_ID      → Google Cloud Console (app tipo External)
 *   GOOGLE_CLIENT_SECRET  → Google Cloud Console
 *   PAGES_URL             → URL de Cloudflare Pages
 *   WORKER_URL            → URL de este Worker
 *   ANTHROPIC_API_KEY     → Opcional, para bot IA
 *   ADMIN_KEY             → Clave admin (default: Tres60admin)
 *
 * KV Namespace binding: MDA_KV
 */

const AI_MODEL      = 'claude-sonnet-4-6';
const AI_MAX_TOKENS = 512;
const SESSION_TTL   = 60 * 60 * 24 * 7;
const COST_IN       = 3.0  / 1_000_000;
const COST_OUT      = 15.0 / 1_000_000;

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key',
};

const jsonR     = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const redirectR = (url)        => new Response(null, { status: 302, headers: { Location: url } });

async function kvGet(env, key, fb = null) {
  try { const r = await env.MDA_KV.get(key); return r ? JSON.parse(r) : fb; } catch { return fb; }
}
async function kvPut(env, key, val, opts = {}) {
  await env.MDA_KV.put(key, JSON.stringify(val), opts);
}

async function getSession(req, env) {
  const auth  = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const s = await kvGet(env, `session_${token}`);
  if (!s) return null;
  await kvPut(env, `session_${token}`, s, { expirationTtl: SESSION_TTL });
  return { ...s, token };
}

async function requireAuth(req, env) {
  const s = await getSession(req, env);
  return s || { error: 'Unauthorized', status: 401 };
}

async function requireAdmin(req, env) {
  const s = await getSession(req, env);
  if (!s) return { error: 'Unauthorized', status: 401 };
  if (s.role !== 'admin') return { error: 'Forbidden', status: 403 };
  return s;
}

// ── ROUTER ───────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const { method } = request;
    const { pathname } = new URL(request.url);

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (pathname === '/auth/login')    return authLogin(request, env);
    if (pathname === '/auth/callback') return authCallback(request, env);
    if (pathname === '/auth/logout')   return authLogout(request, env);
    if (pathname === '/auth/me' && method === 'GET') return authMe(request, env);

    if (pathname === '/admin/users') {
      if (method === 'GET')    return usersGet(request, env);
      if (method === 'POST')   return usersAdd(request, env);
    }
    if (pathname.startsWith('/admin/users/') && method === 'DELETE')
      return usersDelete(decodeURIComponent(pathname.slice(13)), request, env);
    if (pathname.startsWith('/admin/users/') && method === 'PATCH')
      return usersUpdate(decodeURIComponent(pathname.slice(13)), request, env);

    if (pathname === '/admin/visibility') {
      if (method === 'GET')  return visibilityGet(request, env);
      if (method === 'POST') return visibilityPost(request, env);
    }

    if (pathname === '/glossary') {
      if (method === 'GET')  return glossaryGet(request, env);
      if (method === 'POST') return glossaryPost(request, env);
    }
    if (pathname.startsWith('/glossary/') && method === 'DELETE')
      return glossaryDelete(decodeURIComponent(pathname.slice(10)), request, env);

    const ctxM = pathname.match(/^\/context\/([^/]+)\/(contacts|systems|errors)$/);
    if (ctxM) {
      if (method === 'GET')  return contextGet(ctxM[1], ctxM[2], request, env);
      if (method === 'POST') return contextPost(ctxM[1], ctxM[2], request, env);
    }

    if (pathname === '/feedback') {
      if (method === 'GET')  return feedbackGet(request, env);
      if (method === 'POST') return feedbackPost(request, env);
    }
    if (pathname.startsWith('/feedback/') && method === 'DELETE')
      return feedbackDelete(pathname.slice(10), request, env);

    if (pathname === '/chat' && method === 'POST') return chatHandler(request, env);
    if (pathname === '/ping') return jsonR({ ok: true, ts: Date.now() });

    return jsonR({ error: 'Not found' }, 404);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// GOOGLE OAUTH  — External (no requiere admin de Workspace)
// ═══════════════════════════════════════════════════════════════════════

function authLogin(request, env) {
  const params = new URLSearchParams({
    client_id    : env.GOOGLE_CLIENT_ID,
    redirect_uri : env.WORKER_URL + '/auth/callback',
    response_type: 'code',
    scope        : 'openid email profile',
    state        : crypto.randomUUID(),
    prompt       : 'select_account',
    // ↑ Sin "hd": acepta cualquier cuenta Google.
    // El control de acceso lo hace el Worker con la lista de usuarios autorizados.
  });
  return redirectR('https://accounts.google.com/o/oauth2/v2/auth?' + params);
}

async function authCallback(request, env) {
  const url      = new URL(request.url);
  const code     = url.searchParams.get('code');
  const pagesUrl = env.PAGES_URL || '/';

  if (!code) return redirectR(pagesUrl + '/login.html?error=no_code');

  // Intercambiar código por tokens
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method : 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body   : new URLSearchParams({
      code,
      client_id    : env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri : env.WORKER_URL + '/auth/callback',
      grant_type   : 'authorization_code',
    }),
  });
  const tokens = await tokenResp.json();
  if (!tokens.access_token) return redirectR(pagesUrl + '/login.html?error=token_failed');

  // Obtener datos del usuario desde Google
  const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: 'Bearer ' + tokens.access_token },
  });
  const gUser = await userResp.json();
  const email = gUser.email;

  // ── Control de acceso: solo correos pre-autorizados por el admin ──────────
  const users = await kvGet(env, 'user_list', {});

  if (Object.keys(users).length === 0) {
    // Primer usuario en entrar → se convierte en Admin automáticamente
    users[email] = {
      name     : gUser.name,
      role     : 'admin',
      picture  : gUser.picture || '',
      addedAt  : new Date().toISOString(),
      addedBy  : 'system (primer usuario)',
      status   : 'active',
    };
    await kvPut(env, 'user_list', users);

  } else if (!users[email]) {
    // Correo no autorizado → rechazar con mensaje claro
    const errUrl = pagesUrl + '/login.html?error=not_authorized&email=' + encodeURIComponent(email);
    return redirectR(errUrl);

  } else {
    // Usuario conocido → actualizar datos de último login
    users[email].lastLogin = new Date().toISOString();
    users[email].picture   = gUser.picture || users[email].picture;
    users[email].name      = gUser.name    || users[email].name;
    users[email].status    = 'active';
    await kvPut(env, 'user_list', users);
  }

  // Crear sesión
  const sessionId = crypto.randomUUID();
  await kvPut(env, `session_${sessionId}`, {
    email  : email,
    name   : users[email].name,
    picture: users[email].picture,
    role   : users[email].role,
  }, { expirationTtl: SESSION_TTL });

  return redirectR(`${pagesUrl}?session=${sessionId}`);
}

async function authLogout(request, env) {
  const s = await getSession(request, env);
  if (s) await env.MDA_KV.delete(`session_${s.token}`);
  return redirectR((env.PAGES_URL || '/') + '/login.html');
}

async function authMe(request, env) {
  const s = await getSession(request, env);
  if (!s) return jsonR({ authenticated: false }, 401);
  return jsonR({ authenticated: true, email: s.email, name: s.name, picture: s.picture, role: s.role });
}

// ═══════════════════════════════════════════════════════════════════════
// GESTIÓN DE USUARIOS (allowlist)
// El admin agrega correos ANTES de que el usuario intente entrar.
// ═══════════════════════════════════════════════════════════════════════

async function usersGet(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  const users = await kvGet(env, 'user_list', {});
  return jsonR({ users });
}

async function usersAdd(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  const { email, role, name } = await request.json();
  if (!email || !email.includes('@')) return jsonR({ error: 'Correo inválido' }, 400);
  const r = role && ['admin','agent'].includes(role) ? role : 'agent';
  const users = await kvGet(env, 'user_list', {});
  if (users[email]) return jsonR({ error: 'Este correo ya tiene acceso', existing: users[email] }, 409);
  users[email] = {
    name    : name || email.split('@')[0],
    role    : r,
    picture : '',
    addedAt : new Date().toISOString(),
    addedBy : auth.email,
    status  : 'invited',   // aún no ha iniciado sesión
  };
  await kvPut(env, 'user_list', users);
  return jsonR({ ok: true, email, role: r, status: 'invited' });
}

async function usersDelete(email, request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  if (email === auth.email) return jsonR({ error: 'No puedes eliminarte a ti mismo' }, 400);
  const users = await kvGet(env, 'user_list', {});
  if (!users[email]) return jsonR({ error: 'Usuario no encontrado' }, 404);
  delete users[email];
  await kvPut(env, 'user_list', users);
  return jsonR({ ok: true });
}

async function usersUpdate(email, request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  const { role } = await request.json();
  if (!['admin','agent'].includes(role)) return jsonR({ error: 'Rol inválido (admin|agent)' }, 400);
  const users = await kvGet(env, 'user_list', {});
  if (!users[email]) return jsonR({ error: 'Usuario no encontrado' }, 404);
  users[email].role      = role;
  users[email].updatedAt = new Date().toISOString();
  users[email].updatedBy = auth.email;
  await kvPut(env, 'user_list', users);
  return jsonR({ ok: true, email, role });
}

// ═══════════════════════════════════════════════════════════════════════
// VISIBILIDAD, GLOSARIO, CONTEXTO, FEEDBACK, IA  (sin cambios)
// ═══════════════════════════════════════════════════════════════════════
async function visibilityGet(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  return jsonR({ hidden: await kvGet(env, 'hidden_procs', []), isAdmin: auth.role === 'admin' });
}
async function visibilityPost(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  const { hidden } = await request.json();
  await kvPut(env, 'hidden_procs', Array.isArray(hidden) ? hidden : []);
  return jsonR({ ok: true });
}
async function glossaryGet(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  return jsonR({ glossary: await kvGet(env, 'glossary', {}) });
}
async function glossaryPost(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  const { key, data } = await request.json();
  const g = await kvGet(env, 'glossary', {});
  g[key] = { ...data, updatedAt: new Date().toISOString(), updatedBy: auth.email };
  await kvPut(env, 'glossary', g);
  return jsonR({ ok: true });
}
async function glossaryDelete(key, request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  const g = await kvGet(env, 'glossary', {});
  delete g[key];
  await kvPut(env, 'glossary', g);
  return jsonR({ ok: true });
}
async function contextGet(sopId, type, request, env) {
  const auth = await requireAuth(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  return jsonR({ data: await kvGet(env, `ctx_${sopId}_${type}`, []) });
}
async function contextPost(sopId, type, request, env) {
  const auth = await requireAuth(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  const { data } = await request.json();
  await kvPut(env, `ctx_${sopId}_${type}`, data);
  return jsonR({ ok: true });
}
async function feedbackGet(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  return jsonR({ feedback: await kvGet(env, 'feedback', []) });
}
async function feedbackPost(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  const item = await request.json();
  const fb = await kvGet(env, 'feedback', []);
  fb.push({ id: crypto.randomUUID(), ...item, agentEmail: auth.email, date: new Date().toISOString() });
  await kvPut(env, 'feedback', fb);
  return jsonR({ ok: true });
}
async function feedbackDelete(id, request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  await kvPut(env, 'feedback', (await kvGet(env, 'feedback', [])).filter(f => f.id !== id));
  return jsonR({ ok: true });
}
async function chatHandler(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.error) return jsonR(auth, auth.status);
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonR({ error: 'ANTHROPIC_API_KEY no configurada' }, 500);
  const { system = '', messages = [], sopId = '' } = await request.json();
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body   : JSON.stringify({ model: AI_MODEL, max_tokens: AI_MAX_TOKENS, system, messages }),
  });
  const d = await r.json();
  if (!r.ok) return jsonR({ error: d?.error?.message || 'Error IA' }, 502);
  const inT = d.usage.input_tokens, outT = d.usage.output_tokens;
  return jsonR({ response: d.content[0].text, cost: Math.round((inT*COST_IN+outT*COST_OUT)*10000)/10000 });
}
