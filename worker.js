/**
 * Cloudflare Worker — MDA Playbook Backend v3.0
 * ===============================================
 * Nuevos endpoints en v3.0:
 *   GET/POST/DELETE /content/:sopId   → Contenido editado de SOP existente
 *   GET             /sop/list         → Lista de SOPs custom subidos
 *   POST            /sop/upload       → Subir nuevo SOP (admin)
 *   GET             /sop/:sopId       → Obtener HTML de SOP custom
 *   DELETE          /sop/:sopId       → Eliminar SOP custom (admin)
 */

const AI_MODEL='gpt-4o-mini';
const AI_MAX_TOKENS = 512;
const SESSION_TTL   = 60 * 60 * 24 * 7;
const COST_IN       = 0.15 / 1_000_000;  // gpt-4o-mini input
const COST_OUT      = 0.60 / 1_000_000;  // gpt-4o-mini output

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key',
};

const jsonR     = (d, s=200) => new Response(JSON.stringify(d), {status:s, headers:{'Content-Type':'application/json',...CORS}});
const htmlR     = (h, s=200) => new Response(h, {status:s, headers:{'Content-Type':'text/html;charset=utf-8',...CORS}});
const redirectR = (url)      => new Response(null, {status:302, headers:{Location:url}});

async function kvGet(env,key,fb=null){try{const r=await env.MDA_KV.get(key);return r?JSON.parse(r):fb;}catch{return fb;}}
async function kvPut(env,key,val,opts={}){await env.MDA_KV.put(key,JSON.stringify(val),opts);}
async function kvGetRaw(env,key){try{return await env.MDA_KV.get(key);}catch{return null;}}
async function kvPutRaw(env,key,val,opts={}){await env.MDA_KV.put(key,val,opts);}

async function getSession(req,env){
  const auth=req.headers.get('Authorization')||'';
  const token=auth.startsWith('Bearer ')?auth.slice(7):null;
  if(!token)return null;
  const s=await kvGet(env,`session_${token}`);
  if(!s)return null;
  await kvPut(env,`session_${token}`,s,{expirationTtl:SESSION_TTL});
  return{...s,token};
}
async function requireAuth(req,env){const s=await getSession(req,env);return s||{error:'Unauthorized',status:401};}
async function requireAdmin(req,env){
  const s=await getSession(req,env);
  if(!s)return{error:'Unauthorized',status:401};
  if(s.role!=='admin')return{error:'Forbidden',status:403};
  return s;
}

// ═══ DEBUG OPENAI ════════════════════════════════════════════════════════════
async function debugOpenAI(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const apiKey=env.OPENAI_API_KEY;
  if(!apiKey)return jsonR({error:'OPENAI_API_KEY no configurada'},500);
  const{model=AI_MODEL}=await req.json().catch(()=>({}));

  const resp=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
    body:JSON.stringify({
      model,
      max_tokens:20,
      messages:[{role:'user',content:'Di solo: OK'}]
    })
  });
  const data=await resp.json();
  return jsonR({
    httpStatus : resp.status,
    ok         : resp.ok,
    modelUsed  : model,
    response   : data.choices?.[0]?.message?.content||null,
    error      : data.error||null,
    usage      : data.usage||null,
  });
}

// ═══ EQUIPAMIENTO Y PLATAFORMAS MDA ═════════════════════════════════════════
async function equipamientoGet(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  let data={equipment:{},platforms:{}};
  try{
    const raw=await env.MDA_KV.get('mda_equipamiento');
    if(raw) data=JSON.parse(raw);
  }catch(e){ console.error('equipamientoGet KV error:',e.message); }
  return jsonR({ok:true,data});
}
async function equipamientoPost(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  let body;
  try{ body=await req.json(); }catch(e){ return jsonR({error:'JSON inválido'},400); }
  const{data}=body;
  if(!data)return jsonR({error:'data requerida'},400);
  try{
    await env.MDA_KV.put('mda_equipamiento',JSON.stringify(data));
    return jsonR({ok:true,savedAt:new Date().toISOString()});
  }catch(e){ return jsonR({error:'Error al guardar: '+e.message},500); }
}

export default {
  async fetch(request, env) {
    try {
      const {method}   = request;
      const {pathname} = new URL(request.url);
      if(method==='OPTIONS') return new Response(null,{status:204,headers:CORS});

      // Páginas públicas (sin autenticación — requeridas por Google OAuth verificación)
      if(pathname==='/about'&&method==='GET') return htmlR(`<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MDA Playbook — Mesa de Ayuda Capstone Copper</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:60px auto;padding:0 24px;color:#1a1a2e;line-height:1.7}
  h1{color:#003087;font-size:1.8rem;margin-bottom:4px}
  h2{color:#003087;font-size:1.1rem;margin-top:36px}
  .badge{display:inline-block;background:#003087;color:#fff;padding:3px 10px;border-radius:4px;font-size:.8rem;margin-bottom:24px}
  footer{margin-top:60px;font-size:.85rem;color:#666;border-top:1px solid #eee;padding-top:16px}
</style>
</head>
<body>
<h1>MDA Playbook</h1>
<span class="badge">Mesa de Ayuda · Capstone Copper</span>
<p>El <strong>MDA Playbook</strong> es una plataforma interna de gestión del conocimiento y soporte operacional, desarrollada por <strong>Tres60</strong> para el servicio de Mesa de Ayuda (MDA) en <strong>Capstone Copper — Minera Mantoverde</strong>.</p>
<h2>¿Qué hace esta aplicación?</h2>
<p>Centraliza procedimientos operativos (SOPs), permite consultas con asistencia de inteligencia artificial, y facilita la coordinación del equipo de soporte IT/OT en un entorno de minería a gran escala.</p>
<h2>Funcionalidades principales</h2>
<ul>
  <li>Consulta de procedimientos estándar (SOPs) con búsqueda asistida por IA</li>
  <li>Bitácora operacional con análisis automático de incidentes</li>
  <li>Gestión de equipamiento e inventario</li>
  <li>Módulo de listas de tareas y coordinación de turno</li>
  <li>Panel de administración de usuarios y control de acceso</li>
</ul>
<h2>Acceso</h2>
<p>Esta aplicación es de uso exclusivo para el personal autorizado del servicio MDA. El acceso se realiza mediante autenticación con cuenta Google corporativa, previa autorización del administrador del sistema.</p>
<h2>Responsable</h2>
<p>Tres60 — Servicios de Tecnología de la Información<br>
Contacto: <a href="mailto:soporte@tres60.cl">soporte@tres60.cl</a></p>
<footer>MDA Playbook v3.0 · Tres60 · Capstone Copper Chile · <a href="/privacy">Política de Privacidad</a></footer>
</body></html>`);

      if(pathname==='/privacy'&&method==='GET') return htmlR(`<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Política de Privacidad — MDA Playbook</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:60px auto;padding:0 24px;color:#1a1a2e;line-height:1.7}
  h1{color:#003087;font-size:1.8rem;margin-bottom:4px}
  h2{color:#003087;font-size:1.1rem;margin-top:36px}
  .date{color:#666;font-size:.9rem;margin-bottom:32px}
  footer{margin-top:60px;font-size:.85rem;color:#666;border-top:1px solid #eee;padding-top:16px}
</style>
</head>
<body>
<h1>Política de Privacidad</h1>
<p class="date">Última actualización: Noviembre 2024</p>
<p>Esta política de privacidad describe cómo <strong>MDA Playbook</strong>, operado por <strong>Tres60</strong>, recopila, usa y protege la información de los usuarios que acceden a esta plataforma.</p>
<h2>1. Información que recopilamos</h2>
<p>Al iniciar sesión con Google, recopilamos únicamente la información básica de perfil que Google comparte: nombre completo, dirección de correo electrónico e imagen de perfil. No recopilamos contraseñas ni información de pago.</p>
<h2>2. Uso de la información</h2>
<p>La información recopilada se utiliza exclusivamente para:</p>
<ul>
  <li>Autenticar al usuario y mantener su sesión activa dentro de la plataforma</li>
  <li>Identificar al usuario en el registro de actividades operacionales (bitácora)</li>
  <li>Controlar los permisos de acceso a los módulos de la aplicación</li>
</ul>
<h2>3. Almacenamiento de datos</h2>
<p>Los datos de sesión se almacenan de forma segura en Cloudflare KV (infraestructura de Cloudflare, Inc.) con un período de expiración de 7 días. No se almacenan datos en servidores propios ni se comparten con terceros fuera de la infraestructura operacional del servicio.</p>
<h2>4. Acceso de terceros</h2>
<p>Esta aplicación utiliza Google OAuth 2.0 para autenticación. Los scopes solicitados son: <code>openid</code>, <code>email</code> y <code>profile</code>. No se solicita ni se accede a ningún otro dato de la cuenta Google del usuario.</p>
<h2>5. Retención y eliminación</h2>
<p>Las sesiones expiran automáticamente a los 7 días de inactividad. Los administradores del sistema pueden revocar el acceso de cualquier usuario en cualquier momento. Para solicitar la eliminación de sus datos, contacte al administrador del servicio.</p>
<h2>6. Seguridad</h2>
<p>El acceso a la plataforma está restringido a usuarios previamente autorizados por el administrador. Todas las comunicaciones utilizan cifrado TLS. Los tokens de sesión se almacenan de forma segura y no son accesibles públicamente.</p>
<h2>7. Contacto</h2>
<p>Para consultas sobre esta política de privacidad o el tratamiento de sus datos personales, contacte a:<br>
<strong>Tres60 — Servicios de Tecnología de la Información</strong><br>
Correo: <a href="mailto:soporte@tres60.cl">soporte@tres60.cl</a></p>
<footer>MDA Playbook v3.0 · Tres60 · <a href="/about">Acerca de esta aplicación</a></footer>
</body></html>`);

      // Auth
      if(pathname==='/auth/login'&&method==='GET')      return await authLogin(request,env);
      if(pathname==='/auth/login-page'&&method==='GET') return authLoginPage(env);
      if(pathname==='/auth/login-local'&&method==='POST') return await authLoginLocal(request,env);
      if(pathname==='/auth/callback')                   return await authCallback(request,env);
      if(pathname==='/auth/logout')                     return await authLogout(request,env);
      if(pathname==='/auth/me'&&method==='GET')         return await authMe(request,env);

      // Users
      if(pathname==='/admin/users'){
        if(method==='GET')  return await usersGet(request,env);
        if(method==='POST') return await usersAdd(request,env);
      }
      const uMatch=pathname.match(/^\/admin\/users\/(.+)$/);
      if(uMatch){
        const uEmail=decodeURIComponent(uMatch[1]);
        if(method==='DELETE'&&!uEmail.endsWith('/password')) return await usersDelete(uEmail,request,env);
        if(method==='PATCH')  return await usersUpdate(uEmail,request,env);
      }
      // Gestión de contraseña local por usuario (solo admin)
      const pwMatch=pathname.match(/^\/admin\/users\/(.+)\/set-password$/);
      if(pwMatch&&method==='POST') return await adminSetPassword(decodeURIComponent(pwMatch[1]),request,env);
      const pwDel=pathname.match(/^\/admin\/users\/(.+)\/password$/);
      if(pwDel){
        if(method==='DELETE') return await adminDeletePassword(decodeURIComponent(pwDel[1]),request,env);
        if(method==='GET')    return await adminHasPassword(decodeURIComponent(pwDel[1]),request,env);
      }

      // Visibility
      if(pathname==='/admin/visibility'){
        if(method==='GET')  return await visibilityGet(request,env);
        if(method==='POST') return await visibilityPost(request,env);
      }

      // SOP Content
      const cMatch=pathname.match(/^\/content\/([^/]+)$/);
      if(cMatch){
        if(method==='GET')    return await contentGet(cMatch[1],request,env);
        if(method==='POST')   return await contentPost(cMatch[1],request,env);
        if(method==='DELETE') return await contentDelete(cMatch[1],request,env);
      }

      // Custom SOPs
      if(pathname==='/sop/list'&&method==='GET')   return await sopListGet(request,env);
      if(pathname==='/sop/upload'&&method==='POST') return await sopUpload(request,env);
      const sMatch=pathname.match(/^\/sop\/([^/]+)$/);
      if(sMatch){
        if(method==='GET')    return await sopGet(sMatch[1],request,env);
        if(method==='DELETE') return await sopDelete(sMatch[1],request,env);
      }

      // Glossary
      if(pathname==='/glossary'){
        if(method==='GET')  return await glossaryGet(request,env);
        if(method==='POST') return await glossaryPost(request,env);
      }
      const gMatch=pathname.match(/^\/glossary\/(.+)$/);
      if(gMatch&&method==='DELETE') return await glossaryDelete(decodeURIComponent(gMatch[1]),request,env);

      // Context
      const ctxM=pathname.match(/^\/context\/([^/]+)\/(contacts|systems|errors)$/);
      if(ctxM){
        if(method==='GET')  return await contextGet(ctxM[1],ctxM[2],request,env);
        if(method==='POST') return await contextPost(ctxM[1],ctxM[2],request,env);
      }

      // Feedback
      if(pathname==='/feedback'){
        if(method==='GET')  return await feedbackGet(request,env);
        if(method==='POST') return await feedbackPost(request,env);
      }
      const fbMatch=pathname.match(/^\/feedback\/(.+)$/);
      if(fbMatch&&method==='DELETE') return await feedbackDelete(fbMatch[1],request,env);

      // Chat
      if(pathname==='/chat'&&method==='POST') return await chatHandler(request,env);

      // Knowledge base
      if(pathname==='/knowledge'){
        if(method==='GET')  return await knowledgeGet(request,env);
        if(method==='POST') return await knowledgeAdd(request,env);
      }
      const kMatch=pathname.match(/^\/knowledge\/([^/]+)$/);
      if(kMatch){
        if(method==='PATCH')  return await knowledgeUpdate(kMatch[1],request,env);
        if(method==='DELETE') return await knowledgeDelete(kMatch[1],request,env);
      }
      if(pathname==='/knowledge/extract'&&method==='POST') return await knowledgeExtract(request,env);

      // Proc keywords
      if(pathname==='/proc/keywords'&&method==='GET')  return await procKeywordsGet(request,env);
      if(pathname==='/proc/keywords'&&method==='POST') return await procKeywordsPost(request,env);
      if(pathname==='/proc/index-all'&&method==='POST') return await procIndexAll(request,env);

      // Proc validación y acciones
      if(pathname==='/proc/validation'&&method==='GET')  return await procValidationGet(request,env);
      if(pathname==='/proc/validation'&&method==='POST') return await procValidationPost(request,env);
      const acMatch=pathname.match(/^\/proc\/acciones\/([^/]+)$/);
      if(acMatch&&method==='GET')  return await procAccionesGet(acMatch[1],request,env);
      if(acMatch&&method==='POST') return await procAccionesPost(acMatch[1],request,env);

      // Bitácora
      if(pathname==='/bitacora/periods'&&method==='GET')    return await bitacoraPeriods(request,env);
      if(pathname==='/bitacora/highlights'&&method==='GET') return await bitacoraHighlights(request,env);
      if(pathname==='/bitacora/ai'&&method==='POST')        return await bitacoraAI(request,env);
      const btM=pathname.match(/^\/bitacora\/([^/]+)\/([^/]+)$/);
      if(btM){
        if(method==='GET')  return await bitacoraGet(btM[1],btM[2],request,env);
        if(method==='POST') return await bitacoraAdd(btM[1],btM[2],request,env);
      }
      const beM=pathname.match(/^\/bitacora\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if(beM){
        if(method==='PATCH')  return await bitacoraEdit(beM[1],beM[2],beM[3],request,env);
        if(method==='DELETE') return await bitacoraDelete(beM[1],beM[2],beM[3],request,env);
      }

      // Equipamiento y plataformas MDA
      if(pathname==='/equipamiento'&&method==='GET')  return await equipamientoGet(request,env);
      if(pathname==='/equipamiento'&&method==='POST') return await equipamientoPost(request,env);

      // To Do's
      if(pathname==='/todos'&&method==='GET')  return await todosGet(request,env);
      if(pathname==='/todos'&&method==='POST') return await todosAdd(request,env);
      const tdM=pathname.match(/^\/todos\/([^/]+)$/);
      if(tdM){
        if(method==='PATCH')  return await todosPatch(tdM[1],request,env);
        if(method==='DELETE') return await todosDelete(tdM[1],request,env);
      }

      // Ping
      if(pathname==='/ping') return jsonR({ok:true,ts:Date.now(),version:'3.0'});
      if(pathname==='/debug/openai'&&method==='POST') return await debugOpenAI(request,env);

      return jsonR({error:'Not found'},404);

    } catch(err) {
      console.error('Worker error:', err.message, err.stack);
      return jsonR({error:'Internal server error', detail: err.message}, 500);
    }
  }
};


// ═══ PÁGINA DE LOGIN (sirve HTML con ambas opciones) ══════════════════════════
function authLoginPage(env){
  const workerUrl = env.WORKER_URL || '';
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Iniciar sesión — MDA Playbook</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:system-ui,-apple-system,sans-serif;
    background:linear-gradient(135deg,#001f5b 0%,#003087 60%,#0057b8 100%);
    min-height:100vh;display:flex;align-items:center;justify-content:center;
    padding:20px;
  }
  .card{
    background:#fff;border-radius:16px;padding:40px 36px;
    width:100%;max-width:400px;
    box-shadow:0 20px 60px rgba(0,0,0,.35);
  }
  .logo{text-align:center;margin-bottom:28px}
  .logo img{height:48px;margin-bottom:10px}
  .logo h1{color:#003087;font-size:1.35rem;font-weight:700;letter-spacing:-.3px}
  .logo p{color:#6b7280;font-size:.82rem;margin-top:2px}

  .divider{display:flex;align-items:center;gap:10px;margin:22px 0;color:#9ca3af;font-size:.78rem}
  .divider::before,.divider::after{content:'';flex:1;height:1px;background:#e5e7eb}

  .btn-google{
    display:flex;align-items:center;justify-content:center;gap:10px;
    width:100%;padding:11px 16px;border-radius:8px;
    border:1.5px solid #dadce0;background:#fff;color:#3c4043;
    font-size:.9rem;font-weight:500;cursor:pointer;text-decoration:none;
    transition:background .15s,border-color .15s;
  }
  .btn-google:hover{background:#f8f9fa;border-color:#bbb}
  .btn-google svg{flex-shrink:0}

  .field{margin-bottom:14px}
  .field label{display:block;font-size:.8rem;font-weight:600;color:#374151;margin-bottom:5px}
  .field input{
    width:100%;padding:10px 12px;border:1.5px solid #d1d5db;border-radius:8px;
    font-size:.9rem;color:#111827;transition:border-color .15s;outline:none;
  }
  .field input:focus{border-color:#003087;box-shadow:0 0 0 3px rgba(0,48,135,.1)}

  .btn-login{
    width:100%;padding:11px;border-radius:8px;border:none;
    background:#003087;color:#fff;font-size:.9rem;font-weight:600;
    cursor:pointer;margin-top:6px;transition:background .15s;
  }
  .btn-login:hover{background:#002070}
  .btn-login:disabled{background:#9ca3af;cursor:not-allowed}

  .msg{
    margin-top:14px;padding:10px 12px;border-radius:8px;font-size:.82rem;
    text-align:center;display:none;
  }
  .msg.error{background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5}
  .msg.ok{background:#f0fdf4;color:#166534;border:1px solid #86efac}

  .footer{text-align:center;margin-top:24px;font-size:.75rem;color:#9ca3af}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <h1>MDA Playbook</h1>
    <p>Mesa de Ayuda · Capstone Copper</p>
  </div>

  <!-- Google OAuth -->
  <a href="${workerUrl}/auth/login" class="btn-google">
    <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>
    Iniciar sesión con Google
  </a>

  <div class="divider">o con usuario y contraseña</div>

  <!-- Local auth form -->
  <form id="loginForm" autocomplete="on">
    <div class="field">
      <label for="email">Correo electrónico</label>
      <input type="email" id="email" name="email" placeholder="usuario@tres60.cl" required autocomplete="username">
    </div>
    <div class="field">
      <label for="password">Contraseña</label>
      <input type="password" id="password" name="password" placeholder="••••••••" required autocomplete="current-password">
    </div>
    <button type="submit" class="btn-login" id="submitBtn">Iniciar sesión</button>
  </form>

  <div class="msg" id="msg"></div>

  <div class="footer">Acceso restringido · Personal autorizado Tres60 / Capstone Copper</div>
</div>

<script>
const WORKER = '${workerUrl}';
const PAGES  = ${JSON.stringify(env.PAGES_URL || '')};

// Leer parámetro ?error= de la URL actual para mostrar mensajes previos
(function(){
  const p = new URLSearchParams(location.search);
  const e = p.get('error');
  if(e){
    const msg = document.getElementById('msg');
    const msgs = {
      not_authorized:'Tu cuenta no está autorizada en esta aplicación.',
      token_failed:'Error al autenticar con Google. Intenta nuevamente.',
      no_code:'No se recibió el código de autorización.',
      server_error:'Error interno del servidor.',
    };
    msg.textContent = msgs[e] || 'Error de autenticación: '+e;
    msg.className = 'msg error';
    msg.style.display = 'block';
  }
})();

document.getElementById('loginForm').addEventListener('submit', async function(e){
  e.preventDefault();
  const btn  = document.getElementById('submitBtn');
  const msg  = document.getElementById('msg');
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  btn.disabled  = true;
  btn.textContent = 'Verificando...';
  msg.style.display = 'none';

  try{
    const r = await fetch(WORKER+'/auth/login-local',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email, password}),
    });
    const data = await r.json();

    if(r.ok && data.session){
      msg.textContent = '¡Acceso concedido! Redirigiendo...';
      msg.className   = 'msg ok';
      msg.style.display = 'block';
      // Redirigir al frontend Pages con el token (mismo mecanismo que Google OAuth)
      const dest = PAGES ? PAGES+'/login.html?session='+data.session : '/?session='+data.session;
      setTimeout(()=>{ location.href = dest; }, 800);
    } else {
      const errMap = {
        not_authorized:'Tu cuenta no está autorizada en esta aplicación.',
        'Credenciales incorrectas':'Correo o contraseña incorrectos.',
      };
      msg.textContent = errMap[data.error] || data.error || 'Error al iniciar sesión.';
      msg.className   = 'msg error';
      msg.style.display = 'block';
      btn.disabled  = false;
      btn.textContent = 'Iniciar sesión';
    }
  } catch(err){
    msg.textContent = 'Error de conexión. Verifica tu red e intenta nuevamente.';
    msg.className   = 'msg error';
    msg.style.display = 'block';
    btn.disabled  = false;
    btn.textContent = 'Iniciar sesión';
  }
});
</script>
</body>
</html>`;
  return htmlR(html);
}

// ═══ LOCAL AUTH (usuario + contraseña) ═══════════════════════════════════════
async function pbkdf2Hash(password, salt){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', salt:enc.encode(salt), iterations:100000, hash:'SHA-256'},
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function localAuthSetPassword(email, password, env){
  const salt = crypto.randomUUID().replace(/-/g,'');
  const hash = await pbkdf2Hash(password, salt);
  await kvPut(env, `local_auth_${email}`, {hash, salt, updatedAt: new Date().toISOString()});
}

async function localAuthVerify(email, password, env){
  const stored = await kvGet(env, `local_auth_${email}`, null);
  if(!stored) return false;
  const hash = await pbkdf2Hash(password, stored.salt);
  return hash === stored.hash;
}

// POST /auth/login-local  {email, password}
async function authLoginLocal(request, env){
  const pagesUrl = env.PAGES_URL || '/';
  let body;
  try{ body = await request.json(); }
  catch{ return jsonR({error:'JSON inválido'},400); }

  const {email, password} = body;
  if(!email||!password) return jsonR({error:'email y password requeridos'},400);

  // Verificar que el usuario existe en la allowlist
  const users = await kvGet(env,'user_list',{});
  const user  = users[email];
  if(!user) return jsonR({error:'not_authorized'},403);

  // Verificar contraseña
  const ok = await localAuthVerify(email, password, env);
  if(!ok) return jsonR({error:'Credenciales incorrectas'},401);

  // Actualizar lastLogin
  users[email].lastLogin = new Date().toISOString();
  await kvPut(env,'user_list',users);

  // Crear sesión (mismo mecanismo que Google OAuth)
  const sessionId = crypto.randomUUID();
  await kvPut(env, `session_${sessionId}`, {
    email,
    name:    user.name,
    picture: user.picture || '',
    role:    user.role,
  }, {expirationTtl: SESSION_TTL});

  return jsonR({session: sessionId, name: user.name, role: user.role});
}

// POST /admin/users/:email/set-password  {password}   (solo admin)
async function adminSetPassword(email, request, env){
  const a = await requireAdmin(request, env);
  if(a.error) return jsonR(a, a.status);

  // Verificar que el usuario existe
  const users = await kvGet(env,'user_list',{});
  if(!users[email]) return jsonR({error:'Usuario no encontrado'},404);

  let body;
  try{ body = await request.json(); }
  catch{ return jsonR({error:'JSON inválido'},400); }

  const {password} = body;
  if(!password||password.length<6) return jsonR({error:'La contraseña debe tener al menos 6 caracteres'},400);

  await localAuthSetPassword(email, password, env);
  return jsonR({ok:true, message:'Contraseña establecida correctamente'});
}

// DELETE /admin/users/:email/password   (elimina auth local, solo admin)
async function adminDeletePassword(email, request, env){
  const a = await requireAdmin(request, env);
  if(a.error) return jsonR(a, a.status);
  await env.MDA_KV.delete(`local_auth_${email}`);
  return jsonR({ok:true, message:'Contraseña local eliminada'});
}

// GET /admin/users/:email/has-password  (solo admin, para saber si tiene pass)
async function adminHasPassword(email, request, env){
  const a = await requireAdmin(request, env);
  if(a.error) return jsonR(a, a.status);
  const stored = await kvGet(env, `local_auth_${email}`, null);
  return jsonR({email, hasLocalPassword: !!stored, updatedAt: stored?.updatedAt || null});
}

// ═══ GOOGLE OAUTH ════════════════════════════════════════════════════════════
function authLogin(request,env){
  const params=new URLSearchParams({
    client_id:env.GOOGLE_CLIENT_ID,
    redirect_uri:env.WORKER_URL+'/auth/callback',
    response_type:'code',
    scope:'openid email profile',
    state:crypto.randomUUID(),
    prompt:'select_account',
  });
  return redirectR('https://accounts.google.com/o/oauth2/v2/auth?'+params);
}

async function authCallback(request,env){
  const url      = new URL(request.url);
  const code     = url.searchParams.get('code');
  const pagesUrl = env.PAGES_URL || '/';

  if(!code) return redirectR(pagesUrl+'/login.html?error=no_code');

  try {
    // 1. Intercambiar código por access token
    const tokenResp = await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        code,
        client_id:     env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  env.WORKER_URL+'/auth/callback',
        grant_type:    'authorization_code',
      }),
    });

    if(!tokenResp.ok){
      const errText = await tokenResp.text().catch(()=>'');
      console.error('OAuth token error:', tokenResp.status, errText);
      return redirectR(pagesUrl+'/login.html?error=token_failed');
    }

    const tokens = await tokenResp.json();
    if(!tokens.access_token) return redirectR(pagesUrl+'/login.html?error=token_failed');

    // 2. Obtener info del usuario de Google
    const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{
      headers:{ Authorization:'Bearer '+tokens.access_token },
    });

    if(!userResp.ok) return redirectR(pagesUrl+'/login.html?error=userinfo_failed');

    const gUser = await userResp.json();
    const email = gUser.email;
    if(!email) return redirectR(pagesUrl+'/login.html?error=no_email');

    // 3. Verificar usuario en allowlist
    const users = await kvGet(env,'user_list',{});
    if(Object.keys(users).length === 0){
      // Primer login: crear admin automáticamente
      users[email]={
        name:gUser.name, role:'admin', picture:gUser.picture||'',
        addedAt:new Date().toISOString(), addedBy:'system', status:'active',
      };
      await kvPut(env,'user_list',users);
    } else if(!users[email]){
      return redirectR(pagesUrl+'/login.html?error=not_authorized&email='+encodeURIComponent(email));
    } else {
      users[email].lastLogin = new Date().toISOString();
      users[email].picture   = gUser.picture || users[email].picture;
      users[email].name      = gUser.name    || users[email].name;
      users[email].status    = 'active';
      await kvPut(env,'user_list',users);
    }

    // 4. Crear sesión y redirigir al frontend CON el token
    const sessionId = crypto.randomUUID();
    await kvPut(env,`session_${sessionId}`,{
      email,
      name:    users[email].name,
      picture: users[email].picture,
      role:    users[email].role,
    },{expirationTtl: SESSION_TTL});

    return redirectR(pagesUrl+'/login.html?session='+sessionId);

  } catch(err) {
    console.error('authCallback error:', err);
    return redirectR(pagesUrl+'/login.html?error=server_error');
  }
}

async function authLogout(request,env){
  const s=await getSession(request,env);
}

async function authMe(request,env){
  const s=await getSession(request,env);
  if(!s)return jsonR({authenticated:false},401);
  return jsonR({authenticated:true,email:s.email,name:s.name,picture:s.picture,role:s.role});
}

// ═══ USERS ═══════════════════════════════════════════════════════════════════
async function usersGet(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const users=await kvGet(env,'user_list',{});
  // Convertir objeto {email: {...}} a array [{email, ...props}]
  const list=Object.entries(users).map(function([email,u]){return{email,...u};});
  return jsonR({users:list});
}
async function usersAdd(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const{email,role,name}=await req.json();
  if(!email||!email.includes('@'))return jsonR({error:'Correo inválido'},400);
  const r=role&&['admin','agent'].includes(role)?role:'agent';
  const users=await kvGet(env,'user_list',{});
  if(users[email])return jsonR({error:'Este correo ya tiene acceso',existing:users[email]},409);
  users[email]={name:name||email.split('@')[0],role:r,picture:'',addedAt:new Date().toISOString(),addedBy:a.email,status:'invited'};
  await kvPut(env,'user_list',users);
  return jsonR({ok:true,email,role:r,status:'invited'});
}
async function usersDelete(email,req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  if(email===a.email)return jsonR({error:'No puedes eliminarte a ti mismo'},400);
  const users=await kvGet(env,'user_list',{});
  delete users[email];
  await kvPut(env,'user_list',users);
  return jsonR({ok:true});
}
async function usersUpdate(email,req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const{role}=await req.json();
  if(!['admin','agent'].includes(role))return jsonR({error:'Rol inválido'},400);
  const users=await kvGet(env,'user_list',{});
  if(!users[email])return jsonR({error:'Usuario no encontrado'},404);
  users[email].role=role;users[email].updatedAt=new Date().toISOString();users[email].updatedBy=a.email;
  await kvPut(env,'user_list',users);
  return jsonR({ok:true,email,role});
}

// ═══ VISIBILITY ═══════════════════════════════════════════════════════════════
async function visibilityGet(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  return jsonR({
    hidden : await kvGet(env,'hidden_procs',[]),
    deleted: await kvGet(env,'deleted_procs',[]),
    isAdmin: a.role==='admin'
  });
}
async function visibilityPost(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const{hidden}=await req.json();
  await kvPut(env,'hidden_procs',Array.isArray(hidden)?hidden:[]);
  return jsonR({ok:true});
}

// ═══ SOP CONTENT EDITING (editar contenido de SOPs existentes) ════════════
async function contentGet(sopId,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const edited=await kvGetRaw(env,`sop_edit_${sopId}`);
  return jsonR({content:edited||null,hasEdit:!!edited,sopId});
}
async function contentPost(sopId,req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const{html}=await req.json();
  if(!html)return jsonR({error:'html requerido'},400);
  await kvPutRaw(env,`sop_edit_${sopId}`,html);
  return jsonR({ok:true,sopId,savedAt:new Date().toISOString()});
}
async function contentDelete(sopId,req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  await env.MDA_KV.delete(`sop_edit_${sopId}`);
  return jsonR({ok:true,sopId,deletedAt:new Date().toISOString()});
}

// ═══ CUSTOM SOPs (subidos por el admin) ═══════════════════════════════════

async function sopListGet(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  // Devolver la lista directamente — nivel/grupo ya están en metadata del upload
  const list  =await kvGet(env,'custom_sop_list',[]);
  const hidden=await kvGet(env,'hidden_procs',[]);
  const deleted=await kvGet(env,'deleted_procs',[]);
  const hiddenSet =new Set(hidden);
  const deletedSet=new Set(deleted);
  // Admins ven todo (incluso ocultos); agentes solo los visibles y no eliminados
  const filtered=list.filter(s=>{
    if(deletedSet.has(s.sopId)) return false;
    if(a.role!=='admin'&&hiddenSet.has(s.sopId)) return false;
    return true;
  });
  return jsonR({sops:filtered,total:list.length});
}

async function sopUpload(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  let body;
  try{ body=await req.json(); }
  catch(e){ return jsonR({error:'Body JSON inválido: '+e.message},400); }
  const{html,meta}=body;
  if(!html||!meta||!meta.sopId)return jsonR({error:'Faltan campos requeridos'},400);
  if(typeof html!=='string'||html.length<10)return jsonR({error:'HTML inválido o vacío'},400);

  const sopId=meta.sopId.trim().toUpperCase();

  // Guardar HTML
  try{ await kvPutRaw(env,`custom_sop_${sopId}`,html); }
  catch(e){ return jsonR({error:'Error guardando HTML: '+e.message},500); }

  // Actualizar lista de SOPs custom
  let list=[];
  try{ list=await kvGet(env,'custom_sop_list',[]); }catch(e){ list=[]; }
  const idx=list.findIndex(s=>s.sopId===sopId);
  const entry={...meta,sopId,uploadedAt:new Date().toISOString(),uploadedBy:a.email};
  if(idx>=0)list[idx]=entry; else list.push(entry);
  try{ await kvPut(env,'custom_sop_list',list); }
  catch(e){ return jsonR({error:'Error guardando metadata: '+e.message},500); }

  // CRITICAL: si el sopId estaba en deleted_procs, quitarlo (re-publicación)
  try{
    let deleted=await kvGet(env,'deleted_procs',[]);
    if(deleted.includes(sopId)){
      deleted=deleted.filter(id=>id!==sopId);
      await kvPut(env,'deleted_procs',deleted);
    }
    // También quitar de hidden_procs para que sea visible
    let hidden=await kvGet(env,'hidden_procs',[]);
    if(hidden.includes(sopId)){
      hidden=hidden.filter(id=>id!==sopId);
      await kvPut(env,'hidden_procs',hidden);
    }
  }catch(e){}

  return jsonR({ok:true,sopId,entry,listCount:list.length});
}

async function sopGet(sopId,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const html=await kvGetRaw(env,`custom_sop_${sopId}`);
  if(!html)return jsonR({error:'No encontrado'},404);
  const edited=await kvGetRaw(env,`sop_edit_${sopId}`);
  return jsonR({html,editedContent:edited||null,hasEdit:!!edited});
}

async function sopDelete(sopId,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  if(a.role!=='admin')return jsonR({error:'Solo administradores pueden eliminar procedimientos'},403);

  // 1. Agregar a deleted_procs (eliminación permanente)
  let deleted=await kvGet(env,'deleted_procs',[]);
  if(!deleted.includes(sopId)){deleted.push(sopId);await kvPut(env,'deleted_procs',deleted);}

  // 2. Agregar a hidden_procs (ocultar inmediatamente)
  let hidden=await kvGet(env,'hidden_procs',[]);
  if(!hidden.includes(sopId)){hidden.push(sopId);await kvPut(env,'hidden_procs',hidden);}

  // 3. Si es SOP custom, eliminar datos de KV
  const customHtml=await kvGetRaw(env,`custom_sop_${sopId}`);
  if(customHtml){
    await env.MDA_KV.delete(`custom_sop_${sopId}`);
    await env.MDA_KV.delete(`sop_edit_${sopId}`);
    await env.MDA_KV.delete(`proc_keywords_${sopId}`);
    let list=await kvGet(env,'custom_sop_list',[]);
    list=list.filter(s=>s.sopId!==sopId);
    await kvPut(env,'custom_sop_list',list);
  }

  return jsonR({ok:true,deleted:sopId});
}


// ═══ VALIDACIÓN DE PROCEDIMIENTOS ════════════════════════════════════════════
async function procValidationGet(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const dates=await kvGet(env,'proc_validation',{});
  return jsonR({dates});
}
async function procValidationPost(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const{sopId,date}=await req.json();
  if(!sopId||!date)return jsonR({error:'sopId y date requeridos'},400);
  const dates=await kvGet(env,'proc_validation',{});
  dates[sopId]=date;
  await kvPut(env,'proc_validation',dates);
  return jsonR({ok:true,sopId,date});
}

// ═══ ACCIONES TÍPICAS (override editable) ════════════════════════════════════
async function procAccionesGet(sopId,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const acciones=await kvGet(env,`proc_acciones_${sopId}`,null);
  return jsonR({acciones,hasOverride:acciones!==null});
}
async function procAccionesPost(sopId,req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const{acciones}=await req.json();
  if(!Array.isArray(acciones))return jsonR({error:'acciones debe ser array'},400);
  await kvPut(env,`proc_acciones_${sopId}`,acciones.filter(Boolean));
  return jsonR({ok:true,sopId,count:acciones.length});
}

// ═══ BITÁCORA DE TURNO ═══════════════════════════════════════════════════════

// Chile: UTC-4 (estándar). lockUTC = fin del turno + 1h en UTC
function computeLockUTC(date, shift) {
  const [y,m,d] = date.split('-').map(Number);
  // Chile CLT = UTC-3 (invierno). Lock = 24h después del fin del turno.
  // Turno día:   fin 20:00 CLT (d) = 23:00 UTC (d).  Lock: 20:00 CLT (d+1) = 23:00 UTC (d+1)
  // Turno noche: fin 08:00 CLT (d+1) = 11:00 UTC (d+1). Lock: 08:00 CLT (d+2) = 11:00 UTC (d+2)
  if(shift==='dia')   return Date.UTC(y,m-1,d+1,23,0,0);  // 20:00 CLT del día siguiente
  if(shift==='noche') return Date.UTC(y,m-1,d+2,11,0,0);  // 08:00 CLT dos días después
  return Date.UTC(y,m-1,d+1,23,0,0);
}

function shiftLabel(shift) { return shift==='dia'?'Turno Día (08:00–20:00)':'Turno Noche (20:00–08:00)'; }


async function bitacoraHighlights(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const results=[];
  const now=new Date();
  // Fecha local Chile (UTC-3/UTC-4) para que coincida con lo que ve el agente
  function localDate(d,offsetDays){
    const x=new Date(d);
    if(offsetDays) x.setDate(x.getDate()+offsetDays);
    // Ajustar a hora Chile (-3h): restar 3h para obtener fecha local aprox.
    const clt=new Date(x.getTime()-3*3600000);
    return clt.toISOString().slice(0,10);
  }
  // Últimos 4 días × 2 turnos = 8 períodos (cubrimos posibles desfases)
  for(let i=0;i<4;i++){
    const d=new Date(now);
    d.setDate(d.getDate()-i);
    const dateStr=localDate(d);
    for(const shift of ['dia','noche']){
      try{
        const period=await kvGet(env,`bitacora_${dateStr}_${shift}`,null);
        if(period&&period.entries){
          period.entries
            .filter(e=>e.type==='highlight'||e.type==='escalation')
            .forEach(e=>results.push({
              ...e,
              periodDate:dateStr,
              periodShift:shift,
              periodLabel:period.label||''
            }));
        }
      }catch(err){}
    }
  }
  results.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  return jsonR({highlights:results.slice(0,10),total:results.length});
}

async function bitacoraPeriods(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  // Paginar hasta traer TODAS las claves (no limitarse a las 50 más antiguas)
  let allKeys=[];
  let cursor=undefined;
  let iterations=0;
  do{
    const opts={prefix:'bitacora_',limit:250};
    if(cursor) opts.cursor=cursor;
    const page=await env.MDA_KV.list(opts);
    allKeys=allKeys.concat(page.keys);
    cursor=page.list_complete?undefined:page.cursor;
    iterations++;
  }while(cursor && iterations<10); // máx 2500 claves = ~3.4 años de turnos

  const periods=allKeys
    .filter(k=>k.name.startsWith('bitacora_'))
    .map(k=>({key:k.name,id:k.name.replace('bitacora_','')}))
    .sort((a,b)=>b.id.localeCompare(a.id))
    .slice(0,60); // mostrar últimos 60 periodos (~30 días)
  return jsonR({periods,total:allKeys.length});
}

async function bitacoraGet(date,shift,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const key=`bitacora_${date}_${shift}`;
  let period=await kvGet(env,key,null);
  if(!period){
    // Crear período nuevo
    const lockUTC=computeLockUTC(date,shift);
    period={date,shift,label:shiftLabel(shift),lockUTC,entries:[],createdAt:new Date().toISOString()};
    await kvPut(env,key,period);
  }
  const isLocked=Date.now()>period.lockUTC;
  return jsonR({...period,isLocked});
}

async function bitacoraAdd(date,shift,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const key=`bitacora_${date}_${shift}`;
  const period=await kvGet(env,key,null);
  if(!period)return jsonR({error:'Período no existe'},404);
  if(Date.now()>period.lockUTC)return jsonR({error:'Este período ya está cerrado y en modo solo lectura.'},403);
  const{text,type}=await req.json();
  if(!text||!text.trim())return jsonR({error:'Texto requerido'},400);
  const entry={
    id:crypto.randomUUID(),
    text:text.trim(),
    type:type||'normal', // normal | highlight | escalation
    agentName:a.name,
    agentEmail:a.email,
    timestamp:new Date().toISOString(),
  };
  period.entries.push(entry);
  await kvPut(env,key,period);
  return jsonR({ok:true,entry});
}

async function bitacoraEdit(date,shift,entryId,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const key=`bitacora_${date}_${shift}`;
  const period=await kvGet(env,key,null);
  if(!period)return jsonR({error:'Período no existe'},404);
  if(Date.now()>period.lockUTC)return jsonR({error:'Período cerrado'},403);
  const idx=period.entries.findIndex(e=>e.id===entryId);
  if(idx<0)return jsonR({error:'Entrada no encontrada'},404);
  if(period.entries[idx].agentEmail!==a.email&&a.role!=='admin')return jsonR({error:'Solo puedes editar tus propias entradas'},403);
  const{text,type}=await req.json();
  period.entries[idx]={...period.entries[idx],text:text||period.entries[idx].text,type:type||period.entries[idx].type,editedAt:new Date().toISOString()};
  await kvPut(env,key,period);
  return jsonR({ok:true,entry:period.entries[idx]});
}

async function bitacoraDelete(date,shift,entryId,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const key=`bitacora_${date}_${shift}`;
  const period=await kvGet(env,key,null);
  if(!period)return jsonR({error:'Período no existe'},404);
  if(Date.now()>period.lockUTC)return jsonR({error:'Período cerrado'},403);
  const entry=period.entries.find(e=>e.id===entryId);
  if(!entry)return jsonR({error:'Entrada no encontrada'},404);
  if(entry.agentEmail!==a.email&&a.role!=='admin')return jsonR({error:'Sin permiso'},403);
  period.entries=period.entries.filter(e=>e.id!==entryId);
  await kvPut(env,key,period);
  return jsonR({ok:true});
}

async function bitacoraAI(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const apiKey=env.OPENAI_API_KEY;
  if(!apiKey)return jsonR({error:'OPENAI_API_KEY no configurada'},500);
  const{text,conversation}=await req.json();
  if(!text)return jsonR({error:'text requerido'},400);

  const systemPrompt=`Eres un asistente de escritura para la bitácora de turno de la Mesa de Ayuda TI de Capstone Copper Chile.
Tu función es revisar las anotaciones del agente e identificar:
1. Información faltante (¿quién autorizó?, ¿a qué usuario específico?, ¿qué sistema?, ¿qué hora?, ¿qué faena?)
2. Ambigüedades que puedan causar confusión a quien lea después
3. Verbos o acciones sin sujeto claro
4. Mejoras de redacción para mayor claridad y trazabilidad

Responde SOLO con JSON válido, sin markdown ni texto adicional:
{
  "questions": [
    {"field": "nombre del campo", "question": "¿pregunta específica y concisa?"}
  ],
  "improved_text": "versión mejorada de la anotación (si aplica, si no mejoró usa el texto original)",
  "is_complete": true/false,
  "feedback": "evaluación breve de la calidad de la anotación"
}

Sé específico y directo. Máximo 3 preguntas. Si el texto es claro y completo, devuelve is_complete:true y questions:[].`;

  const userMsgs=conversation||[{role:'user',content:`Revisa esta anotación de bitácora:\n\n"${text}"`}];
  const oaiMessages=[{role:'system',content:systemPrompt},...userMsgs];

  const r=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
    body:JSON.stringify({model:AI_MODEL,max_tokens:800,messages:oaiMessages}),
  });
  const d=await r.json();
  if(!r.ok)return jsonR({error:d?.error?.message||'Error IA'},502);
  try{
    const rawText=d.choices[0].message.content;
    const raw=rawText.trim().replace(/^```json\n?/,'').replace(/\n?```$/,'');
    const parsed=JSON.parse(raw);
    return jsonR({ok:true,result:parsed,rawText});
  }catch(e){
    const rawText=d.choices?.[0]?.message?.content||'';
    return jsonR({ok:true,result:{questions:[],improved_text:text,is_complete:true,feedback:'Respuesta de IA no estructurada.'},rawText});
  }
}


// ═══ TO DO'S ══════════════════════════════════════════════════════════════════

async function todosGet(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const todos=await kvGet(env,'todos_list',[]);
  return jsonR({todos,role:a.role});
}

async function todosAdd(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const body=await req.json();
  if(!body.actividad||!body.actividad.trim())return jsonR({error:'Actividad requerida'},400);
  const todos=await kvGet(env,'todos_list',[]);
  const todo={
    id: crypto.randomUUID(),
    actividad: body.actividad.trim(),
    prioridad: body.prioridad||'Media',
    estado: body.estado||'Pendiente',
    responsable: body.responsable||a.name||a.email,
    responsableEmail: body.responsableEmail||a.email,
    fechaLimite: body.fechaLimite||null,
    notas: body.notas||'',
    createdBy: a.email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  todos.push(todo);
  await kvPut(env,'todos_list',todos);
  return jsonR({ok:true,todo});
}

async function todosPatch(id,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const todos=await kvGet(env,'todos_list',[]);
  const idx=todos.findIndex(t=>t.id===id);
  if(idx<0)return jsonR({error:'No encontrado'},404);
  const body=await req.json();
  todos[idx]={...todos[idx],...body,id,updatedAt:new Date().toISOString()};
  await kvPut(env,'todos_list',todos);
  return jsonR({ok:true,todo:todos[idx]});
}

async function todosDelete(id,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  if(a.role!=='admin')return jsonR({error:'Solo admins pueden eliminar'},403);
  let todos=await kvGet(env,'todos_list',[]);
  todos=todos.filter(t=>t.id!==id);
  await kvPut(env,'todos_list',todos);
  return jsonR({ok:true});
}

// ═══ PROC KEYWORDS (alias de búsqueda) ═════════════════════════════════════
async function procKeywordsGet(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  return jsonR({keywords:await kvGet(env,'proc_keywords',{})});
}
async function procKeywordsPost(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status); // cualquier usuario autenticado puede indexar
  const{sopId,keywords,fullText}=await req.json();
  if(!sopId)return jsonR({error:'sopId requerido'},400);
  const kw=await kvGet(env,'proc_keywords',{});
  // Si se envía fullText (del viewer), extraer palabras relevantes
  if(fullText){
    const words=fullText.toLowerCase()
      .replace(/[^\w\sáéíóúüñ]/gi,' ')
      .split(/\s+/)
      .filter(w=>w.length>3)                         // solo palabras >3 chars
      .filter(w=>!/^(para|este|esta|esto|como|pero|que|los|las|del|con|por|una|uno)$/.test(w))
      .slice(0,300);                                  // max 300 palabras
    const unique=[...new Set(words)];
    kw[sopId]=unique.join(' ');
  } else {
    kw[sopId]=(keywords||'').trim();
  }
  await kvPut(env,'proc_keywords',kw);
  return jsonR({ok:true,sopId,indexed:kw[sopId].split(' ').length});
}

async function procIndexAll(req,env){
  // Indexa todos los SOPs custom desde KV (para el botón del panel admin)
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const list=await kvGet(env,'custom_sop_list',[]);
  const kw=await kvGet(env,'proc_keywords',{});
  let count=0;
  for(const sop of list){
    const html=await kvGetRaw(env,`custom_sop_${sop.sopId}`);
    if(!html) continue;
    const text=html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')
                   .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'')
                   .replace(/<[^>]+>/g,' ')
                   .replace(/\s{2,}/g,' ').trim().toLowerCase();
    const words=text.replace(/[^\w\sáéíóúüñ]/gi,' ')
      .split(/\s+/).filter(w=>w.length>3)
      .filter(w=>!/^(para|este|esta|esto|como|pero|que|los|las|del|con|por|una|uno)$/.test(w))
      .slice(0,400);
    kw[sop.sopId]=[...new Set(words)].join(' ');
    count++;
  }
  await kvPut(env,'proc_keywords',kw);
  return jsonR({ok:true,indexed:count,total:list.length});
}

// ═══ KNOWLEDGE BASE ══════════════════════════════════════════════════════════
async function knowledgeGet(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  let kb=await kvGet(env,'knowledge_base',[]);
  // Asegurar que todas las entradas tengan id (migración de entradas antiguas)
  let needsSave=false;
  kb=kb.map(k=>{
    if(!k.id){needsSave=true;return{...k,id:crypto.randomUUID()};}
    return k;
  });
  if(needsSave)await kvPut(env,'knowledge_base',kb);
  const filtered=a.role==='admin'?kb:kb.filter(k=>k.approved!==false);
  return jsonR({entries:filtered,total:kb.length});
}

async function knowledgeAdd(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const body=await req.json();
  // Acepta {content} (texto libre) o {situation,responses} (Q&A)
  const content=(body.content||body.situation||'').trim();
  if(!content)return jsonR({error:'Contenido requerido'},400);
  const kb=await kvGet(env,'knowledge_base',[]);
  const entry={
    id:crypto.randomUUID(),
    content:content,
    situation:content,
    responses:body.responses||[content],
    category:body.category||'General',
    source:body.source||'manual',
    approved:true,
    addedBy:a.email,
    addedAt:new Date().toISOString(),
  };
  kb.push(entry);
  await kvPut(env,'knowledge_base',kb);
  return jsonR({ok:true,entry});
}

async function knowledgeUpdate(id,req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const updates=await req.json();
  const kb=await kvGet(env,'knowledge_base',[]);
  const idx=kb.findIndex(k=>k.id===id);
  if(idx<0)return jsonR({error:'Entrada no encontrada'},404);
  kb[idx]={...kb[idx],...updates,updatedAt:new Date().toISOString(),updatedBy:a.email};
  if(updates.approved)kb[idx].approvedBy=a.email;
  await kvPut(env,'knowledge_base',kb);
  return jsonR({ok:true,entry:kb[idx]});
}

async function knowledgeDelete(id,req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const kb=(await kvGet(env,'knowledge_base',[])).filter(k=>k.id!==id);
  await kvPut(env,'knowledge_base',kb);
  return jsonR({ok:true});
}

async function knowledgeExtract(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const apiKey=env.OPENAI_API_KEY;
  if(!apiKey)return jsonR({error:'OPENAI_API_KEY no configurada'},500);
  const{conversation}=await req.json();
  if(!conversation)return jsonR({error:'conversation requerida'},400);

  const extractPrompt=`Analiza esta conversacion de un equipo de soporte tecnico de Mesa de Ayuda.
Extrae los aprendizajes practicos y accionables en formato JSON.
IMPORTANTE: Responde SOLO con un array JSON valido, sin texto adicional, sin markdown.

Formato requerido:
[
  {
    "situation": "descripcion breve del problema o consulta (max 80 chars)",
    "responses": ["accion concreta 1", "accion concreta 2", "accion concreta 3"],
    "category": "Conectividad|M365|Hardware|SAP|VHF|General|Escalamiento"
  }
]

Solo incluye aprendizajes concretos. Si no hay aprendizajes claros, devuelve [].

CONVERSACION:
${conversation.slice(0,4000)}`;

  const r=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
    body:JSON.stringify({model:AI_MODEL,max_tokens:1500,messages:[{role:'user',content:extractPrompt}]}),
  });
  const d=await r.json();
  if(!r.ok)return jsonR({error:d?.error?.message||'Error al extraer'},502);

  try{
    const rawText=d.choices[0].message.content;
    const text=rawText.trim().replace(/^```json\n?/,'').replace(/\n?```$/,'');
    const extracted=JSON.parse(text);
    if(!Array.isArray(extracted))return jsonR({error:'La IA no retornó un array'},422);
    return jsonR({ok:true,extracted,count:extracted.length});
  }catch(e){
    const rawText=d.choices?.[0]?.message?.content||'';
    return jsonR({error:'No se pudo parsear la respuesta de la IA',raw:rawText},422);
  }
}

// ═══ GLOSSARY, CONTEXT, FEEDBACK, AI (sin cambios de v2.1) ═══════════════
async function glossaryGet(req,env){const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);return jsonR({glossary:await kvGet(env,'glossary',{})});}
async function glossaryPost(req,env){const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);const{key,data}=await req.json();const g=await kvGet(env,'glossary',{});g[key]={...data,updatedAt:new Date().toISOString(),updatedBy:a.email};await kvPut(env,'glossary',g);return jsonR({ok:true});}
async function glossaryDelete(key,req,env){const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);const g=await kvGet(env,'glossary',{});delete g[key];await kvPut(env,'glossary',g);return jsonR({ok:true});}
async function contextGet(sopId,type,req,env){const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);return jsonR({data:await kvGet(env,`ctx_${sopId}_${type}`,[])});}
async function contextPost(sopId,type,req,env){const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);const{data}=await req.json();await kvPut(env,`ctx_${sopId}_${type}`,data);return jsonR({ok:true});}
async function feedbackGet(req,env){const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);return jsonR({feedback:await kvGet(env,'feedback',[])});}
async function feedbackPost(req,env){const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);const item=await req.json();const fb=await kvGet(env,'feedback',[]);fb.push({id:crypto.randomUUID(),...item,agentEmail:a.email,date:new Date().toISOString()});await kvPut(env,'feedback',fb);return jsonR({ok:true});}
async function feedbackDelete(id,req,env){const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);await kvPut(env,'feedback',(await kvGet(env,'feedback',[])).filter(f=>f.id!==id));return jsonR({ok:true});}
async function chatHandler(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const apiKey=env.OPENAI_API_KEY;
  if(!apiKey)return jsonR({error:'OPENAI_API_KEY no configurada'},500);
  const{system='',messages=[],sopId=''}=await req.json();

  const MAX_SYS_CHARS=120000;
  let usedChars=system.length;

  // 0. Auto-detectar SOP mencionado en el último mensaje del usuario
  let targetSop=sopId||'';
  if(!targetSop&&messages.length>0){
    const lastMsg=(messages[messages.length-1].content||'');
    const m=lastMsg.match(/SOP-[A-Z]{2,5}-\d+/i);
    if(m) targetSop=m[0].toUpperCase();
  }

  // 1. Knowledge Base
  const kb=await kvGet(env,'knowledge_base',[]);
  let kbText='';
  for(const k of kb.filter(k=>k.approved!==false)){
    const txt=(k.content||k.situation||'').trim();
    if(!txt) continue;
    const line='• '+txt.slice(0,1000);
    if(usedChars+kbText.length+line.length>MAX_SYS_CHARS*0.4) break;
    kbText+='\n'+line;
  }
  if(kbText) kbText='\n\n[BASE DE CONOCIMIENTO]\n'+kbText;
  usedChars+=kbText.length;

  // 2. Índice de keywords — todos los SOPs, 120 palabras c/u
  const procKw=await kvGet(env,'proc_keywords',{});
  let kwIndex='';
  const kwEntries=Object.entries(procKw);
  if(kwEntries.length>0){
    kwIndex='\n\n[ÍNDICE DE CONTENIDO DE PROCEDIMIENTOS]\n'+
      kwEntries.map(([sid,words])=>sid+': '+words.split(' ').slice(0,120).join(' ')).join('\n');
    usedChars+=kwIndex.length;
  }

  // 3. Catálogo de SOPs (metadatos completos)
  const customList=await kvGet(env,'custom_sop_list',[]);
  const deletedSet=new Set(await kvGet(env,'deleted_procs',[]));
  const visibleCustom=customList.filter(s=>!deletedSet.has(s.sopId));
  let sopCatalog='';
  if(visibleCustom.length>0){
    sopCatalog='\n\n[CATÁLOGO DE PROCEDIMIENTOS MDA]\n'+
      visibleCustom.map(s=>[
        'ID: '+s.sopId,
        'Título: '+(s.titulo||'').slice(0,80),
        'Dom: '+(s.dom||''),
        'Nivel: '+(s.nivel||''),
        'Grupo: '+(s.grupo||'Help_Desk_Support_Chile_Tech'),
        'Faenas: '+(s.faenas||'MVE,MBL,STG'),
      ].join(' | ')).join('\n');
    usedChars+=sopCatalog.length;
  }

  // 4. Contenido completo del SOP detectado (explícito o auto-detectado)
  let sopContent='';
  if(targetSop&&usedChars<MAX_SYS_CHARS-8000){
    const raw=await kvGetRaw(env,`custom_sop_${targetSop}`);
    if(raw){
      const budget=Math.min(12000,MAX_SYS_CHARS-usedChars-2000);
      const textOnly=raw
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'')
        .replace(/<[^>]+>/g,' ').replace(/\s{2,}/g,' ').trim();
      sopContent='\n\n[CONTENIDO COMPLETO DEL PROCEDIMIENTO '+targetSop+']\n'+textOnly.slice(0,budget);
    }
  }

  // Construir system prompt completo y array de mensajes para OpenAI
  const fullSystem=(system+kbText+kwIndex+sopCatalog+(sopContent?'\n'+sopContent:'')).trim();
  const oaiMessages=[];
  if(fullSystem) oaiMessages.push({role:'system',content:fullSystem});
  oaiMessages.push(...messages);

  const r=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
    body:JSON.stringify({model:AI_MODEL,max_tokens:800,messages:oaiMessages})
  });
  const d=await r.json();

  if(!r.ok)return jsonR({
    error:d?.error?.message||'Error IA',errorType:d?.error?.type,
    httpStatus:r.status,model:AI_MODEL,raw:JSON.stringify(d).slice(0,300)
  },502);

  const inT=d.usage?.prompt_tokens||0,outT=d.usage?.completion_tokens||0;
  return jsonR({
    response:d.choices[0].message.content,
    tokens:{in:inT,out:outT},
    cached:false,
    sopLoaded:targetSop||null
  });
}
