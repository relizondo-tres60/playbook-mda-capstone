/**
 * Cloudflare Worker — MDA Playbook Backend v3.0
 * ===============================================
 * Nuevos endpoints en v3.0:
 *   GET/POST/DELETE /content/:sopId   → Contenido editado de SOP existente
 *   GET             /sop/list         → Lista de SOPs custom subidos
 *   POST            /sop/upload       → Subir nuevo SOP (admin)
 *   GET             /sop/:sopId       → Obtener HTML de SOP custom
 *   DELETE          /sop/:sopId       → Eliminar SOP custom (admin)
 *
 * Verificador de Baja de Cuentas (offboarding):
 *   GET             /bajas            → Casos de baja + checklist maestra
 *   POST            /bajas            → Abrir caso de baja
 *   PATCH           /bajas/:id        → Verificar control, editar antecedentes o validar
 *   DELETE          /bajas/:id        → Eliminar caso (admin)
 *   GET/POST        /bajas/checklist  → Checklist maestra (POST solo admin)
 */

const AI_MODEL='claude-haiku-4-5-20251001';
const AI_MAX_TOKENS = 512;
const SESSION_TTL   = 60 * 60 * 24 * 7;
const COST_IN       = 3.0  / 1_000_000;
const COST_OUT      = 15.0 / 1_000_000;

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

// ═══ DEBUG ANTHROPIC ════════════════════════════════════════════════════════
async function debugAnthropic(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const apiKey=env.ANTHROPIC_API_KEY;
  if(!apiKey)return jsonR({error:'ANTHROPIC_API_KEY no configurada'},500);
  const{model=AI_MODEL}=await req.json().catch(()=>({}));

  const resp=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
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
    response   : data.content?.[0]?.text||null,
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

// ═══ VERIFICADOR DE BAJA DE CUENTAS (Offboarding) ═══════════════════════════
// Operacionaliza SOP-GIA-003 (Offboarding — Desactivacion de Cuenta AD),
// SOP-SAP-004 (bloqueo SAP), SOP-GIA-007 (MFA), SOP-EQU-* y SOP-VHF-*.
// Modelo de riesgo: mientras exista un item OBLIGATORIO aplicable sin verificar,
// el caso mantiene exposicion residual y acumula dias desde la fecha de egreso.

const BAJA_CHECKLIST = [
  // --- Identidad: AD / Entra ID (SOP-GIA-003 pasos 02, 03, 05) ---
  {key:'AD-01', grupo:'Identidad (AD / Entra ID)',        label:'Cuenta deshabilitada en Active Directory',                    obligatorio:true,  sop:'SOP-GIA-003'},
  {key:'AD-02', grupo:'Identidad (AD / Entra ID)',        label:'Sesiones activas revocadas en Entra ID',                      obligatorio:true,  sop:'SOP-GIA-003'},
  {key:'AD-03', grupo:'Identidad (AD / Entra ID)',        label:'Export de grupos adjunto al ticket (previo a remocion)',      obligatorio:true,  sop:'SOP-GIA-003'},
  {key:'AD-04', grupo:'Identidad (AD / Entra ID)',        label:'Removida de grupos de seguridad (excepto Domain Users)',      obligatorio:true,  sop:'SOP-GIA-003'},
  {key:'AD-05', grupo:'Identidad (AD / Entra ID)',        label:'Removida de listas de distribucion de correo',                obligatorio:true,  sop:'SOP-GIA-003'},
  {key:'AD-06', grupo:'Identidad (AD / Entra ID)',        label:'Cuenta movida a OU Disabled (Users / Vendors)',               obligatorio:true,  sop:'SOP-GIA-003'},
  {key:'AD-07', grupo:'Identidad (AD / Entra ID)',        label:'Campo Description actualizado: DISABLED - fecha - motivo',    obligatorio:false, sop:'SOP-GIA-003'},
  {key:'AD-08', grupo:'Identidad (AD / Entra ID)',        label:'Metodos MFA y dispositivos de confianza eliminados',          obligatorio:true,  sop:'SOP-GIA-007'},

  // --- Correo y colaboracion M365 (SOP-GIA-003 paso 04) ---
  {key:'M365-01', grupo:'Correo y Colaboracion (M365)',   label:'Buzon gestionado segun instruccion del ADC/RRHH',             obligatorio:true,  sop:'SOP-GIA-003'},
  {key:'M365-02', grupo:'Correo y Colaboracion (M365)',   label:'Licencias M365 liberadas',                                    obligatorio:false, sop:'SOP-GIA-003'},
  {key:'M365-03', grupo:'Correo y Colaboracion (M365)',   label:'OneDrive: propiedad transferida al jefatura/manager',         obligatorio:false, sop:'SOP-GIA-003'},
  {key:'M365-04', grupo:'Correo y Colaboracion (M365)',   label:'Teams / SharePoint: propiedad de sitios reasignada',          obligatorio:false, sop:'SOP-GIA-003'},

  // --- Aplicaciones de negocio (SOP-SAP-004) ---
  {key:'SAP-01', grupo:'Aplicaciones de Negocio',         label:'Bloqueo SAP solicitado a SAP-Chile_Tech',                     obligatorio:true,  sop:'SOP-SAP-004'},
  {key:'SAP-02', grupo:'Aplicaciones de Negocio',         label:'Bloqueo SAP confirmado por escrito (N.o de ticket)',          obligatorio:true,  sop:'SOP-SAP-004'},
  {key:'APP-01', grupo:'Aplicaciones de Negocio',         label:'Licencias de software liberadas (Adobe u otras)',             obligatorio:false, sop:'SOP-APP-006'},
  {key:'APP-02', grupo:'Aplicaciones de Negocio',         label:'Power BI: workspaces y datasets reasignados',                 obligatorio:false, sop:'SOP-APP-006'},
  {key:'APP-03', grupo:'Aplicaciones de Negocio',         label:'Plataformas de terceros notificadas (Ariba y similares)',     obligatorio:false, sop:'SOP-GIA-003'},

  // --- Acceso remoto y perimetral (SOP-GIA-003 paso 07) ---
  {key:'VPN-01', grupo:'Acceso Remoto y Perimetral',      label:'VPN FortiClient: certificados revocados',                     obligatorio:true,  sop:'SOP-GIA-003'},
  {key:'VPN-02', grupo:'Acceso Remoto y Perimetral',      label:'Bastion Host: usuario eliminado',                             obligatorio:true,  sop:'SOP-GIA-003'},
  {key:'VPN-03', grupo:'Acceso Remoto y Perimetral',      label:'Verificacion post-revocacion: sin sesiones activas',          obligatorio:true,  sop:'SOP-GIA-003'},

  // --- Entorno OT (criticidad industrial) ---
  {key:'OT-01', grupo:'Entorno OT / Operaciones',         label:'Accesos a sistemas OT revocados (PI Vision, SCADA/DCS)',      obligatorio:true,  sop:'SOP-CYB-003'},
  {key:'OT-02', grupo:'Entorno OT / Operaciones',         label:'Revocacion OT confirmada por el ADC de seguridad Capstone',   obligatorio:true,  sop:'SOP-CYB-003'},

  // --- Equipamiento y comunicaciones ---
  {key:'EQU-01', grupo:'Equipamiento y Comunicaciones',   label:'Equipo computacional devuelto y registrado en inventario',    obligatorio:false, sop:'SOP-EQU-004'},
  {key:'EQU-02', grupo:'Equipamiento y Comunicaciones',   label:'Equipo resguardado / formateado segun politica',              obligatorio:false, sop:'SOP-EQU-005'},
  {key:'VHF-01', grupo:'Equipamiento y Comunicaciones',   label:'Radio VHF devuelta y desprogramada',                          obligatorio:false, sop:'SOP-VHF-002'},
  {key:'TEL-01', grupo:'Equipamiento y Comunicaciones',   label:'Telefonia movil / anexo liberado',                            obligatorio:false, sop:'SOP-COL-003'},
  {key:'ACC-01', grupo:'Equipamiento y Comunicaciones',   label:'Credencial de acceso fisico devuelta',                        obligatorio:false, sop:'SOP-EQU-004'},

  // --- Cierre y evidencia ---
  {key:'CIE-01', grupo:'Cierre y Evidencia',              label:'Evidencia de cada paso adjunta al ticket',                    obligatorio:true,  sop:'SOP-GIA-003'},
  {key:'CIE-02', grupo:'Cierre y Evidencia',              label:'Ticket cerrado con resumen de accesos revocados',             obligatorio:true,  sop:'SOP-GIA-003'},
];

async function bajasChecklistGet(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const custom=await kvGet(env,'bajas_checklist',null);
  return jsonR({checklist:custom&&custom.length?custom:BAJA_CHECKLIST,esPersonalizada:!!(custom&&custom.length)});
}

async function bajasChecklistPost(req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  let body;try{body=await req.json();}catch{return jsonR({error:'JSON invalido'},400);}
  const {checklist}=body;
  if(!Array.isArray(checklist)||!checklist.length)return jsonR({error:'checklist requerida'},400);
  await kvPut(env,'bajas_checklist',checklist);
  return jsonR({ok:true,total:checklist.length});
}

function nuevaBaja(body,checklist,a){
  const items={};
  checklist.forEach(function(c){
    items[c.key]={estado:'pendiente',evidencia:'',ticketRef:'',verificadoPor:'',verificadoAt:null};
  });
  return {
    id: crypto.randomUUID(),
    ticket:        (body.ticket||'').trim(),
    nombre:        (body.nombre||'').trim(),
    username:      (body.username||'').trim(),
    email:         (body.email||'').trim(),
    empresa:       (body.empresa||'').trim(),
    cargo:         (body.cargo||'').trim(),
    sitio:         body.sitio||'',
    tipo:          body.tipo||'Empleado',
    fechaEgreso:   body.fechaEgreso||null,
    urgencia:      body.urgencia||'Normal',
    solicitante:   (body.solicitante||'').trim(),
    instruccionBuzon: body.instruccionBuzon||'Redirigir 30 dias',
    notas:         (body.notas||'').trim(),
    items:         items,
    estado:        'En Proceso',
    validadoPor:   '',
    validadoAt:    null,
    historial:     [{at:new Date().toISOString(),by:a.email,accion:'Caso de baja creado'}],
    createdBy:     a.email,
    createdAt:     new Date().toISOString(),
    updatedAt:     new Date().toISOString(),
  };
}

async function bajasGet(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const custom=await kvGet(env,'bajas_checklist',null);
  return jsonR({
    bajas:     await kvGet(env,'bajas_list',[]),
    checklist: custom&&custom.length?custom:BAJA_CHECKLIST,
    role:      a.role,
    email:     a.email,
  });
}

async function bajasAdd(req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  let body;try{body=await req.json();}catch{return jsonR({error:'JSON invalido'},400);}
  if(!body.nombre||!body.nombre.trim())  return jsonR({error:'Nombre del usuario requerido'},400);
  if(!body.username||!body.username.trim()) return jsonR({error:'Cuenta AD (username) requerida'},400);
  const custom=await kvGet(env,'bajas_checklist',null);
  const checklist=custom&&custom.length?custom:BAJA_CHECKLIST;
  const bajas=await kvGet(env,'bajas_list',[]);
  const baja=nuevaBaja(body,checklist,a);
  bajas.push(baja);
  await kvPut(env,'bajas_list',bajas);
  return jsonR({ok:true,baja});
}

async function bajasPatch(id,req,env){
  const a=await requireAuth(req,env);if(a.error)return jsonR(a,a.status);
  const bajas=await kvGet(env,'bajas_list',[]);
  const idx=bajas.findIndex(b=>b.id===id);
  if(idx<0)return jsonR({error:'Caso no encontrado'},404);
  let body;try{body=await req.json();}catch{return jsonR({error:'JSON invalido'},400);}
  const prev=bajas[idx];
  const hist=Array.isArray(prev.historial)?prev.historial.slice():[];
  const now=new Date().toISOString();

  // Actualizacion de un item del checklist
  if(body.item&&body.item.key){
    const k=body.item.key;
    const it=Object.assign({},prev.items&&prev.items[k]?prev.items[k]:{estado:'pendiente',evidencia:'',ticketRef:''});
    if(body.item.estado)              it.estado=body.item.estado;
    if(body.item.evidencia!==undefined) it.evidencia=body.item.evidencia;
    if(body.item.ticketRef!==undefined) it.ticketRef=body.item.ticketRef;
    if(it.estado==='pendiente'){ it.verificadoPor=''; it.verificadoAt=null; }
    else { it.verificadoPor=a.name||a.email; it.verificadoAt=now; }
    prev.items=Object.assign({},prev.items,{[k]:it});
    hist.push({at:now,by:a.email,accion:k+' -> '+it.estado});
  }

  // Validacion de segunda linea (segregacion de funciones)
  if(body.validar===true){
    if(prev.createdBy===a.email&&a.role!=='admin')
      return jsonR({error:'La validacion de segunda linea debe hacerla un agente distinto al que abrio el caso'},403);
    prev.validadoPor=a.name||a.email; prev.validadoAt=now;
    hist.push({at:now,by:a.email,accion:'Validacion de segunda linea'});
  }
  if(body.validar===false){
    prev.validadoPor=''; prev.validadoAt=null;
    hist.push({at:now,by:a.email,accion:'Validacion de segunda linea revertida'});
  }

  // Campos de cabecera
  const editables=['ticket','nombre','username','email','empresa','cargo','sitio','tipo',
                   'fechaEgreso','urgencia','solicitante','instruccionBuzon','notas','estado'];
  editables.forEach(function(f){ if(body[f]!==undefined) prev[f]=body[f]; });

  prev.historial=hist.slice(-120);
  prev.updatedAt=now;
  bajas[idx]=prev;
  await kvPut(env,'bajas_list',bajas);
  return jsonR({ok:true,baja:prev});
}

async function bajasDelete(id,req,env){
  const a=await requireAdmin(req,env);if(a.error)return jsonR(a,a.status);
  const bajas=await kvGet(env,'bajas_list',[]);
  await kvPut(env,'bajas_list',bajas.filter(b=>b.id!==id));
  return jsonR({ok:true});
}

export default {
  async fetch(request, env) {
    try {
      const {method}   = request;
      const {pathname} = new URL(request.url);
      if(method==='OPTIONS') return new Response(null,{status:204,headers:CORS});

      // Auth
      if(pathname==='/auth/login')                      return await authLogin(request,env);
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
        if(method==='DELETE') return await usersDelete(decodeURIComponent(uMatch[1]),request,env);
        if(method==='PATCH')  return await usersUpdate(decodeURIComponent(uMatch[1]),request,env);
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
      if(pathname==='/debug/anthropic'&&method==='POST') return await debugAnthropic(request,env);

      // Verificador de Baja de Cuentas (offboarding)
      if(pathname==='/bajas/checklist'&&method==='GET')  return await bajasChecklistGet(request,env);
      if(pathname==='/bajas/checklist'&&method==='POST') return await bajasChecklistPost(request,env);
      if(pathname==='/bajas'&&method==='GET')  return await bajasGet(request,env);
      if(pathname==='/bajas'&&method==='POST') return await bajasAdd(request,env);
      const bjM=pathname.match(/^\/bajas\/([^/]+)$/);
      if(bjM){
        if(method==='PATCH')  return await bajasPatch(bjM[1],request,env);
        if(method==='DELETE') return await bajasDelete(bjM[1],request,env);
      }

      return jsonR({error:'Not found'},404);

    } catch(err) {
      console.error('Worker error:', err.message, err.stack);
      return jsonR({error:'Internal server error', detail: err.message}, 500);
    }
  }
};


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
  const apiKey=env.ANTHROPIC_API_KEY;
  if(!apiKey)return jsonR({error:'ANTHROPIC_API_KEY no configurada'},500);
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

  const msgs=conversation||[{role:'user',content:`Revisa esta anotación de bitácora:

"${text}"`}];

  const r=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:AI_MODEL,max_tokens:800,system:systemPrompt,messages:msgs}),
  });
  if(!r.ok)return jsonR({error:'Error IA'},502);
  try{
    const raw=d.content[0].text.trim().replace(/^```json\n?/,'').replace(/\n?```$/,'');
    const parsed=JSON.parse(raw);
    return jsonR({ok:true,result:parsed,rawText:d.content[0].text});
  }catch(e){
    return jsonR({ok:true,result:{questions:[],improved_text:text,is_complete:true,feedback:'Respuesta de IA no estructurada.'},rawText:d.content[0].text});
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
  const apiKey=env.ANTHROPIC_API_KEY;
  if(!apiKey)return jsonR({error:'ANTHROPIC_API_KEY no configurada'},500);
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

  const r=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:AI_MODEL,max_tokens:1500,messages:[{role:'user',content:extractPrompt}]}),
  });
  if(!r.ok)return jsonR({error:'Error al extraer'},502);

  try{
    const text=d.content[0].text.trim().replace(/^```json\n?/,'').replace(/\n?```$/,'');
    const extracted=JSON.parse(text);
    if(!Array.isArray(extracted))return jsonR({error:'La IA no retornó un array'},422);
    return jsonR({ok:true,extracted,count:extracted.length});
  }catch(e){
    return jsonR({error:'No se pudo parsear la respuesta de la IA',raw:d.content[0].text},422);
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
  const apiKey=env.ANTHROPIC_API_KEY;
  if(!apiKey)return jsonR({error:'ANTHROPIC_API_KEY no configurada'},500);
  const{system='',messages=[],sopId=''}=await req.json();

  const MAX_SYS_CHARS=160000;
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

  // Bloque cacheable (base + KB + keywords + catálogo) + dinámico (contenido SOP)
  const cachedText=(system+kbText+kwIndex+sopCatalog).trim();
  const systemBlocks=[];
  if(cachedText){
    systemBlocks.push({type:'text',text:cachedText,cache_control:{type:'ephemeral'}});
  }
  if(sopContent){
    systemBlocks.push({type:'text',text:sopContent}); // dinámico, sin caché
  }

  async function callAnthropic(useCache){
    const sysVal=useCache&&systemBlocks.length?systemBlocks:(cachedText||system||undefined);
    const hdrs={'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'};
    if(useCache) hdrs['anthropic-beta']='prompt-caching-2024-07-31';
    return fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:hdrs,
      body:JSON.stringify({model:AI_MODEL,max_tokens:800,system:sysVal,messages})
    });
  }

  let r=await callAnthropic(true);
  let d=await r.json();
  if(!r.ok&&d?.error?.message){r=await callAnthropic(false);d=await r.json();}

  if(!r.ok)return jsonR({
    error:d?.error?.message||'Error IA',errorType:d?.error?.type,
    httpStatus:r.status,model:AI_MODEL,raw:JSON.stringify(d).slice(0,300)
  },502);

  const inT=d.usage?.input_tokens||0,outT=d.usage?.output_tokens||0;
  const cacheRead=d.usage?.cache_read_input_tokens||0;
  const cacheWrite=d.usage?.cache_creation_input_tokens||0;
  return jsonR({
    response:d.content[0].text,
    tokens:{in:inT,out:outT,cacheRead,cacheWrite},
    cached:cacheRead>0,
    sopLoaded:targetSop||null
  });
}
