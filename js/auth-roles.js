/*!
 * auth-roles.js — MDA Playbook v3.0
 * ────────────────────────────────────────────────────────────────────
 * Arquitectura extensible:
 *   - Barra de navegación global (horizontal, fixed top)
 *   - Toolbar de admin por SOP (visible/oculto/editar contenido)
 *   - Panel de admin (usuarios, visibilidad)
 *   - Modal de subida de nuevos SOPs
 *   - Modal de edición de contenido
 *   - Módulos futuros: añadir items a NAV_MAIN y NAV_ADMIN
 */
(function () {
'use strict';

// ═══════════════════════════════════════════════════════
// CONFIGURACIÓN EXTENSIBLE DE NAVEGACIÓN
// Para agregar nuevas funcionalidades, añadir items aquí
// ═══════════════════════════════════════════════════════
var NAV_MAIN = [
  { id: 'catalog',   label: '&#128203; Cat\u00e1logo', roles: ['admin','agent'],
    href: function() { return base() + 'Catalogo_Servicios_MDA_Capstone.html'; } },

];

var NAV_ADMIN = [
  { id: 'users',      label: '&#128101; Usuarios y Roles',       action: 'openTab', tab: 'users' },
  { id: 'visibility', label: '&#128065; Visibilidad de SOPs',    action: 'openTab', tab: 'vis' },
  { id: 'upload',     label: '&#11014;&#65039; Subir Procedimiento', action: 'openUploadModal' },
  { id: 'knowledge', label: '\ud83d\udcda Base de Conocimiento', action: 'openTab', tab: 'knowledge' },
  { id: 'feedback',  label: '&#128172; Feedback Interno',        action: 'goFeedback' },
  { id: 'divider' },
  { id: 'shifts',     label: '&#128211; Bit\u00e1cora de Turno',  action: 'goShifts' },
  { id: 'ai_draft',   label: '&#9997;&#65039; Redacci\u00f3n con IA', soon: true },
  { id: 'analytics',  label: '&#128202; Estad\u00edsticas',      soon: true },
];

// ═══════════════════════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════════════════════
window.PlaybookAuth = {
  user: null, hiddenProcs: [], workerUrl: '', session: '',
  ready: false, onReady: null,
  isSOP: false, sopId: '', sopTitle: '',
};
var A = window.PlaybookAuth;

// ═══════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════
function base() {
  return window.location.pathname.includes('/procedimientos/') ? '../' : '';
}

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function authFetch(url, opts) {
  opts = opts || {};
  if (!opts.headers) opts.headers = {};
  opts.headers['Authorization'] = 'Bearer ' + A.session;
  return fetch(url, opts);
}

A.authFetch = authFetch;

function showToast(msg, isError) {
  var t = document.getElementById('ar-toast');
  if (!t) { t = document.createElement('div'); t.id = 'ar-toast'; document.body.appendChild(t); }
  t.innerHTML = msg;
  t.style.background = isError ? '#c0392b' : '#1a6b3a';
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._to);
  t._to = setTimeout(function() {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
  }, 3000);
}

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {
  A.workerUrl = (window.CFG && CFG.workerUrl) || localStorage.getItem('mda_worker_url') || '';
  A.session   = localStorage.getItem('mda_session') || '';
  A.isSOP     = !!document.querySelector('.sop-id');

  if (A.isSOP) {
    var sopEl   = document.querySelector('.sop-id');
    var sopMatch = sopEl ? sopEl.textContent.match(/SOP-[A-Z]+-\d+/) : null;
    A.sopId    = sopMatch ? sopMatch[0] : '';
    A.sopTitle = document.title.replace(/SOP-[A-Z]+-\d+\s*[^\w]*/,'').trim();
  }

  var urlParams = new URLSearchParams(window.location.search);
  var fromUrl   = urlParams.get('session');
  if (fromUrl) {
    A.session = fromUrl;
    localStorage.setItem('mda_session', fromUrl);
    var newUrl = window.location.pathname;
    if (urlParams.get('sop')) newUrl += '?sop=' + urlParams.get('sop');
    window.history.replaceState({}, document.title, newUrl);
  }

  injectCSS();
  if (!A.session) { redirectToLogin(); return; }
  verifySession();
});

// ═══════════════════════════════════════════════════════
// SESSION
// ═══════════════════════════════════════════════════════
function verifySession() {
  if (!A.workerUrl) {
    A.user = { email: 'demo@capstonecopper.com', name: 'Demo', role: 'admin' };
    finishBoot();
    return;
  }
  authFetch(A.workerUrl + '/auth/me')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.authenticated) { redirectToLogin(); return; }
      A.user = { email: d.email, name: d.name, picture: d.picture, role: d.role };
      finishBoot();
    })
    .catch(function () {
      A.user = { email: 'local', name: 'Sin conexi\u00f3n', role: 'agent' };
      finishBoot();
    });
}

function finishBoot() {
  A.ready = true;
  buildNav();
  loadVisibility();
  if (A.isSOP && A.user.role === 'admin') buildSOPToolbar();
  if (A.onReady) A.onReady(A.user);
  // Chat IA en el catálogo (no en SOPs)
  if (!A.isSOP) setTimeout(buildCatalogAIChat, 100);
}

function redirectToLogin() {
  if (!window.location.pathname.includes('login.html'))
    window.location.href = base() + 'login.html';
}

// ═══════════════════════════════════════════════════════
// CSS
// ═══════════════════════════════════════════════════════
function injectCSS() {
  var css = [
    /* ── Global nav ── */
    '#mda-nav{position:fixed;top:0;left:0;right:0;height:48px;background:linear-gradient(135deg,#1a1a2e 0%,#0d2d5a 100%);display:flex;align-items:center;padding:0 16px;gap:4px;z-index:9000;box-shadow:0 2px 12px rgba(0,0,0,.4)}',
    '#mda-nav .nav-brand{color:#fff;font-weight:800;font-size:14px;letter-spacing:.5px;white-space:nowrap;margin-right:8px;display:flex;align-items:center;gap:6px}',
    '#mda-nav .nav-sep{width:1px;height:24px;background:rgba(255,255,255,.2);margin:0 8px}',
    '#mda-nav .nav-link{color:rgba(255,255,255,.8);text-decoration:none;font-size:12px;font-weight:600;padding:6px 10px;border-radius:6px;transition:all .15s;white-space:nowrap}',
    '#mda-nav .nav-link:hover{background:rgba(255,255,255,.12);color:#fff}',
    '#mda-nav .nav-link.active{background:rgba(255,255,255,.15);color:#fff}',
    '#mda-nav .nav-spacer{flex:1}',
    /* Admin dropdown */
    '#mda-nav .nav-admin-wrap{position:relative}',
    '#mda-nav .nav-admin-btn{background:#ff6b00;color:#fff;border:none;cursor:pointer;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px;white-space:nowrap}',
    '#mda-nav .nav-admin-btn:hover{background:#cc5500}',
    '#mda-nav .nav-admin-dropdown{position:absolute;top:calc(100% + 6px);right:0;background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);min-width:220px;overflow:hidden;display:none;z-index:9100}',
    '#mda-nav .nav-admin-wrap:hover .nav-admin-dropdown{display:block}',
    '#mda-nav .nav-admin-dropdown .dd-item{display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:12px;font-weight:600;color:#1a1a2e;cursor:pointer;border:none;background:none;width:100%;text-align:left;text-decoration:none;transition:background .1s}',
    '#mda-nav .nav-admin-dropdown .dd-item:hover{background:#f0f3f8}',
    '#mda-nav .nav-admin-dropdown .dd-divider{height:1px;background:#eef1f7;margin:4px 0}',
    '#mda-nav .nav-admin-dropdown .dd-soon{opacity:.5;cursor:not-allowed}',
    '#mda-nav .dd-soon-badge{background:#eef1f7;color:#888;font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:auto}',
    /* User info */
    '#mda-nav .nav-user{display:flex;align-items:center;gap:7px;margin-left:10px}',
    '#mda-nav .nav-avatar{width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,.4);object-fit:cover}',
    '#mda-nav .nav-avatar-fb{width:28px;height:28px;border-radius:50%;background:#0057a8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}',
    '#mda-nav .nav-username{color:rgba(255,255,255,.9);font-size:12px;font-weight:600;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#mda-nav .nav-logout{background:rgba(255,255,255,.15);color:#fff;border:none;cursor:pointer;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;transition:background .12s;white-space:nowrap}',
    '#mda-nav .nav-logout:hover{background:rgba(255,255,255,.25)}',
    /* Body padding - compensar el nav fijo */
    'body{padding-top:48px !important}',
    /* ── SOP Admin Toolbar ── */
    '#sop-admin-bar{position:sticky;top:48px;z-index:8000;background:#fff;border-bottom:2px solid #ff6b00;padding:0 20px;display:flex;align-items:center;gap:10px;height:44px;box-shadow:0 2px 6px rgba(0,0,0,.08)}',
    '#sop-admin-bar .sab-back{color:#0057a8;text-decoration:none;font-size:12px;font-weight:700;display:flex;align-items:center;gap:4px;white-space:nowrap}',
    '#sop-admin-bar .sab-back:hover{text-decoration:underline}',
    '#sop-admin-bar .sab-sep{width:1px;height:20px;background:#eef1f7}',
    '#sop-admin-bar .sab-id{font-family:monospace;font-size:11px;font-weight:700;color:#0057a8;white-space:nowrap}',
    '#sop-admin-bar .sab-title{font-size:12px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
    '#sop-admin-bar .sab-spacer{flex:1}',
    '#sop-admin-bar .sab-btn{border:none;cursor:pointer;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px;transition:all .12s;white-space:nowrap}',
    '#sop-admin-bar .sab-edit{background:#0057a8;color:#fff}',
    '#sop-admin-bar .sab-edit:hover{background:#003d7a}',
    '#sop-admin-bar .sab-vis-visible{background:#e8f5ee;color:#1a6b3a;border:1.5px solid #a7d7b9}',
    '#sop-admin-bar .sab-vis-visible:hover{background:#d4edda}',
    '#sop-admin-bar .sab-vis-hidden{background:#fff8e1;color:#b45309;border:1.5px solid #fde68a}',
    '#sop-admin-bar .sab-vis-hidden:hover{background:#fef3cd}',
    '#sop-admin-bar .sab-badge{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;background:#e8f5ee;color:#1a6b3a}',
    '#sop-admin-bar .sab-badge.edited{background:#e8f0fb;color:#0057a8}',
    /* ── Admin Panel Modal ── */
    '#admin-overlay{position:fixed;inset:0;background:rgba(10,10,30,.6);z-index:10000;display:none;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;backdrop-filter:blur(4px)}',
    '#admin-overlay.open{display:flex}',
    '#admin-panel{background:#fff;border-radius:16px;width:100%;max-width:860px;margin:auto;box-shadow:0 24px 80px rgba(0,0,0,.35);overflow:hidden}',
    '#admin-panel-hdr{background:linear-gradient(135deg,#1a1a2e,#0057a8);color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center}',
    '#admin-panel-hdr h2{font-size:17px;font-weight:800}',
    '.adm-x{background:none;border:none;color:#fff;font-size:24px;cursor:pointer;opacity:.8;line-height:1}',
    '.adm-x:hover{opacity:1}',
    '.adm-tabs{display:flex;border-bottom:2px solid #f0f3f8;background:#fafbfc}',
    '.adm-tab{padding:12px 20px;cursor:pointer;font-size:13px;font-weight:600;color:#888;border-bottom:2px solid transparent;margin-bottom:-2px;transition:color .12s;user-select:none}',
    '.adm-tab.active{color:#0057a8;border-bottom-color:#0057a8}',
    '.adm-body{display:none;padding:20px}',
    '.adm-body.active{display:block}',
    /* Tabla usuarios */
    '.u-table{width:100%;border-collapse:collapse;font-size:13px}',
    '.u-table th{background:#f7f9fc;color:#555;font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding:9px 12px;text-align:left;border-bottom:1px solid #eef1f7}',
    '.u-table td{padding:10px 12px;border-bottom:1px solid #f5f7fa;vertical-align:middle}',
    '.u-table tr:last-child td{border-bottom:none}',
    '.u-avatar-sm{width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid #eef1f7}',
    '.u-avatar-fb{width:30px;height:30px;border-radius:50%;background:#0057a8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}',
    '.role-sel{border:1.5px solid #d0d8e8;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;outline:none}',
    '.role-sel:focus{border-color:#0057a8}',
    '.btn-del{background:none;border:1px solid #fca5a5;color:#c0392b;cursor:pointer;border-radius:6px;padding:3px 9px;font-size:11px}',
    '.btn-del:hover{background:#fde8e8}',
    '.status-badge{display:inline-block;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700;margin-left:4px}',
    '.status-invited{background:#fff8e1;color:#b45309;border:1px solid #fde68a}',
    '.status-active{background:#e8f5ee;color:#1a6b3a;border:1px solid #a7d7b9}',
    /* Visibilidad */
    '.vis-prog-wrap{background:#f0f3f8;border-radius:20px;height:8px;overflow:hidden;margin:8px 0 4px}',
    '.vis-prog-bar{background:#1a6b3a;height:100%;transition:width .3s;border-radius:20px}',
    '.vis-dom-hdr{display:flex;justify-content:space-between;align-items:center;padding:9px 14px;background:#f7f9fc;border-radius:8px 8px 0 0;border-bottom:1px solid #eef1f7;cursor:pointer;user-select:none}',
    '.vis-dom-hdr:hover{background:#eef1f7}',
    '.vis-item{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #f5f7fa}',
    '.vis-item:last-child{border-bottom:none}',
    '.vis-item.is-hidden{background:#fffbeb}',
    '.vis-toggle{cursor:pointer;background:none;border:none;font-size:18px;padding:2px 6px;border-radius:6px;transition:background .12s}',
    '.vis-toggle:hover{background:#f0f3f8}',
    '.hidden-badge{background:#f59e0b;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:5px;vertical-align:middle}',
    /* Modales */
    '.pc-modal-overlay{position:fixed;inset:0;background:rgba(10,10,30,.55);z-index:11000;display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)}',
    '.pc-modal-overlay.open{display:flex}',
    '.pc-modal{background:#fff;border-radius:14px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden}',
    '.pc-modal.wide{max-width:100%;width:100%;height:95vh;margin:0;border-radius:0}',
    '.pc-modal-hdr{background:linear-gradient(135deg,#0057a8,#003d7a);color:#fff;padding:15px 20px;display:flex;justify-content:space-between;align-items:center}',
    '.pc-modal-hdr strong{font-size:15px}',
    '.pc-modal-x{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;opacity:.8;line-height:1}',
    '.pc-modal-x:hover{opacity:1}',
    '.pc-modal-body{padding:18px 20px;display:flex;flex-direction:column;gap:12px}',
    '.pc-label{font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px}',
    '.pc-input,.pc-select{width:100%;border:1.5px solid #d0d8e8;border-radius:8px;padding:9px 12px;font-size:13px;font-family:inherit;color:#1a1a2e;outline:none;transition:border-color .15s}',
    '.pc-input:focus,.pc-select:focus{border-color:#0057a8}',
    '.pc-modal-ftr{padding:14px 20px;border-top:1px solid #eef1f7;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}',
    '.pc-btn-primary{background:#0057a8;color:#fff;border:none;cursor:pointer;border-radius:8px;padding:9px 22px;font-size:13px;font-weight:700}',
    '.pc-btn-primary:hover{background:#003d7a}',
    '.pc-btn-secondary{background:#f0f3f8;color:#555;border:1.5px solid #d0d8e8;cursor:pointer;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600}',
    '.pc-btn-secondary:hover{background:#e8ecf3}',
    '.pc-btn-danger{background:#c0392b;color:#fff;border:none;cursor:pointer;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:700}',
    '.pc-btn-danger:hover{background:#922b21}',
    '.pc-error{background:#fde8e8;color:#c0392b;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;display:none}',
    '.ap-note{background:#e8f0fb;border-radius:8px;padding:10px 12px;font-size:12px;color:#0057a8;line-height:1.5}',
    '.ap-btn{background:#0057a8;color:#fff;border:none;cursor:pointer;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700}',
    '.ap-btn:hover{background:#003d7a}',
    '.ap-btn.green{background:#1a6b3a}.ap-btn.green:hover{background:#0d3d20}',
    '.ap-btn.red{background:#c0392b}.ap-btn.red:hover{background:#922b21}',
    /* Editor de contenido */
    '.edit-split{display:grid;grid-template-columns:1fr 1fr;gap:12px;height:calc(95vh - 160px)}',
    '.edit-split textarea{width:100%;height:100%;border:1.5px solid #d0d8e8;border-radius:8px;padding:10px;font-family:monospace;font-size:12px;resize:none;outline:none;color:#1a1a2e}',
    '.edit-split textarea:focus{border-color:#0057a8}',
    '.edit-preview-wrap{border:1.5px solid #d0d8e8;border-radius:8px;overflow:auto;height:100%;background:#fff}',
    '.edit-preview-wrap iframe{width:100%;height:100%;border:none}',
    /* Upload zone */
    '.upload-zone{border:2px dashed #d0d8e8;border-radius:12px;padding:30px;text-align:center;cursor:pointer;transition:all .15s}',
    '.upload-zone:hover,.upload-zone.drag-over{border-color:#0057a8;background:#f0f6ff}',
    '.upload-zone .uz-icon{font-size:36px;margin-bottom:10px}',
    '.upload-zone .uz-text{font-size:13px;color:#555}',
    '.upload-zone .uz-sub{font-size:11px;color:#aaa;margin-top:4px}',
    '#upload-file-input{display:none}',
    '.file-preview{background:#f7f9fc;border-radius:8px;padding:12px;font-size:12px;color:#555;display:none}',
    '.file-preview.show{display:block}',
    '.file-preview .fp-name{font-weight:700;color:#0057a8}',
    /* Toast */
    '#ar-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);background:#1a6b3a;color:#fff;padding:9px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:99999;opacity:0;transition:all .3s;pointer-events:none;white-space:nowrap}',
  /* ── Chat IA del catálogo ── */
  '#cat-ai-fab{position:fixed;bottom:24px;right:24px;width:70px;height:70px;background:linear-gradient(135deg,#0057a8,#7b2d8b);border:none;border-radius:50%;cursor:pointer;box-shadow:0 4px 24px rgba(0,87,168,.45);display:flex;align-items:center;justify-content:center;font-size:29px;z-index:2000;transition:transform .15s}',
  '#cat-ai-fab:hover{transform:scale(1.08)}',
  '#cat-ai-panel{position:fixed;bottom:88px;right:24px;width:380px;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);z-index:2000;display:none;flex-direction:column;overflow:hidden;max-height:540px}',
  '#cat-ai-panel.open{display:flex}',
  '.cai-hdr{background:linear-gradient(135deg,#0057a8,#7b2d8b);padding:13px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}',
  '.cai-hdr-l{display:flex;align-items:center;gap:10px}',
  '.cai-avatar{width:32px;height:32px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px}',
  '.cai-name{color:#fff;font-weight:700;font-size:13px}',
  '.cai-sub{color:rgba(255,255,255,.7);font-size:10px;margin-top:1px}',
  '.cai-x{background:none;border:none;color:#fff;cursor:pointer;font-size:18px;opacity:.8}',
  '.cai-x:hover{opacity:1}',
  '.cai-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:9px;background:#f7f9fc}',
  '.cai-msg{max-width:88%}',
  '.cai-msg-bot{align-self:flex-start}',
  '.cai-msg-user{align-self:flex-end}',
  '.cai-bubble{padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.55}',
  '.cai-bubble p{margin:0 0 6px}.cai-bubble p:last-child{margin:0}',
  '.cai-bubble ul,.cai-bubble ol{padding-left:16px;margin:4px 0}',
  '.cai-bubble li{margin-bottom:3px}',
  '.cai-bubble strong{font-weight:700}',
  '.cai-msg-bot .cai-bubble{background:#fff;border-radius:4px 14px 14px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08);color:#1a1a2e}',
  '.cai-msg-user .cai-bubble{background:linear-gradient(135deg,#0057a8,#003d7a);color:#fff;border-radius:14px 14px 4px 14px}',
  '.cai-thinking{font-size:12px;color:#aaa;font-style:italic;padding:6px 12px;background:#fff;border-radius:4px 14px 14px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08);align-self:flex-start;display:none}',
  '.cai-input-row{padding:9px 12px;border-top:1px solid #eef1f7;background:#fff;display:flex;gap:7px;flex-shrink:0}',
  '.cai-input{flex:1;border:1.5px solid #d0d8e8;border-radius:8px;padding:8px 11px;font-size:13px;font-family:inherit;outline:none;color:#1a1a2e}',
  '.cai-input:focus{border-color:#0057a8}',
  '.cai-send{background:#0057a8;color:#fff;border:none;cursor:pointer;border-radius:8px;padding:8px 13px;font-size:13px;font-weight:700}',
  '.cai-send:hover{background:#003d7a}',
  /* Mejoras de formato en SOP bot también */
  '.ai-bubble p{margin:0 0 6px}.ai-bubble p:last-child{margin:0}',
  '.ai-bubble ul,.ai-bubble ol{padding-left:16px;margin:4px 0}',
  '.ai-bubble li{margin-bottom:3px}',
  '.ai-bubble strong{font-weight:700}',
  /* Knowledge base */
  '.kb-entry{background:#f7f9fc;border-radius:10px;padding:14px 16px;margin-bottom:10px;border-left:3px solid #0057a8}',
  '.kb-entry.pending{border-left-color:#f59e0b;background:#fffbeb}',
  '.kb-entry-hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px}',
  '.kb-situation{font-weight:700;font-size:13px;color:#1a1a2e;flex:1}',
  '.kb-cat{font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:#e8f0fb;color:#0057a8;white-space:nowrap}',
  '.kb-responses{list-style:none;margin:6px 0 8px}',
  '.kb-responses li{font-size:12px;color:#444;padding:2px 0 2px 14px;position:relative}',
  '.kb-responses li::before{content:"\u2192";position:absolute;left:0;color:#0057a8}',
  '.kb-meta{font-size:10px;color:#aaa;margin-top:4px}',
  '.kb-actions{display:flex;gap:6px;margin-top:8px}',
  '.kb-btn{border:none;cursor:pointer;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700}',
  '.kb-btn.approve{background:#e8f5ee;color:#1a6b3a}',
  '.kb-btn.edit{background:#e8f0fb;color:#0057a8}',
  '.kb-btn.del{background:#fde8e8;color:#c0392b}',
  '.conv-textarea{width:100%;height:220px;border:1.5px solid #d0d8e8;border-radius:8px;padding:10px;font-family:inherit;font-size:12px;resize:vertical;outline:none;line-height:1.6}',
  '.conv-textarea:focus{border-color:#0057a8}',
  '.extract-result{border:1px solid #d0d8e8;border-radius:8px;overflow:hidden;margin-top:10px}',
  '.extract-item{padding:12px 14px;border-bottom:1px solid #f0f3f8;display:flex;align-items:flex-start;gap:10px}',
  '.extract-item:last-child{border-bottom:none}',
  '.extract-item input[type=checkbox]{margin-top:3px;flex-shrink:0;width:16px;height:16px;cursor:pointer}',
    /* Proc hidden overlay in catalog */
    '.proc-row.is-hidden{opacity:.5;font-style:italic}',
  ].join('');

  var st = document.createElement('style');
  st.id = 'ar-css';
  st.textContent = css;
  document.head.appendChild(st);

  var toastEl = document.createElement('div');
  toastEl.id = 'ar-toast';
  document.body.appendChild(toastEl);
}

// ═══════════════════════════════════════════════════════
// BARRA DE NAVEGACIÓN GLOBAL
// ═══════════════════════════════════════════════════════
function buildNav() {
  var existing = document.getElementById('mda-nav');
  if (existing) existing.remove();

  var isAdmin = A.user && A.user.role === 'admin';

  // Links principales
  var mainLinks = NAV_MAIN
    .filter(function(item) { return item.roles.includes(A.user ? A.user.role : 'agent'); })
    .map(function(item) {
      var href = item.href ? item.href() : '#';
      return '<a class="nav-link" href="' + esc(href) + '">' + item.label + '</a>';
    }).join('');

  // Dropdown admin
  var adminDropdown = '';
  if (isAdmin) {
    var ddItems = NAV_ADMIN.map(function(item) {
      if (item.id === 'divider') return '<div class="dd-divider"></div>';
      if (item.soon) {
        return '<div class="dd-item dd-soon">' + item.label +
          '<span class="dd-soon-badge">Pr\u00f3ximamente</span></div>';
      }
      return '<button class="dd-item" data-action="' + esc(item.action || '') +
        '" data-tab="' + esc(item.tab || '') + '">' + item.label + '</button>';
    }).join('');

    adminDropdown = '<div class="nav-admin-wrap">' +
      '<button class="nav-admin-btn" id="nav-admin-toggle">&#9881;&#65039; Admin &#9660;</button>' +
      '<div class="nav-admin-dropdown">' + ddItems + '</div>' +
      '</div>';
  }

  // Avatar
  var avatar = A.user.picture
    ? '<img class="nav-avatar" src="' + esc(A.user.picture) + '" alt="">'
    : '<div class="nav-avatar-fb">' + (A.user.name || 'U')[0].toUpperCase() + '</div>';

  var nav = document.createElement('div');
  nav.id = 'mda-nav';
  nav.innerHTML =
    '<div class="nav-brand">&#128247; MDA</div>' +
    '<div class="nav-sep"></div>' +
    mainLinks +
    '<div class="nav-spacer"></div>' +
    adminDropdown +
    '<div class="nav-user">' + avatar +
    '<span class="nav-username">' + esc((A.user.name || '').split(' ')[0]) + '</span>' +
    '<button class="nav-logout" id="nav-logout-btn">Salir</button>' +
    '</div>';

  document.body.insertBefore(nav, document.body.firstChild);

  // Events — usar event delegation para el dropdown
  document.getElementById('nav-logout-btn').addEventListener('click', logout);

  nav.querySelectorAll('.dd-item[data-action]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var action = btn.dataset.action;
      var tab    = btn.dataset.tab;
      if (action === 'openTab')         openAdminPanel(tab);
      if (action === 'openUploadModal') openUploadModal();
      if (action === 'goFeedback')      window.location.href = base() + 'feedback.html';
      if (action === 'goShifts')        window.location.href = base() + 'bitacora.html';
    });
  });

  // Cerrar dropdown al hacer clic fuera
  document.addEventListener('click', function(e) {
    var wrap = document.querySelector('.nav-admin-wrap');
    if (wrap && !wrap.contains(e.target)) {
      var dd = wrap.querySelector('.nav-admin-dropdown');
      if (dd) dd.style.display = '';
    }
  });
}

// ═══════════════════════════════════════════════════════
// TOOLBAR ADMIN EN SOP (sticky, debajo del nav)
// ═══════════════════════════════════════════════════════
function buildSOPToolbar() {
  if (!A.isSOP || A.user.role !== 'admin') return;

  var isHidden = A.hiddenProcs.includes(A.sopId);
  var toolbar  = document.createElement('div');
  toolbar.id   = 'sop-admin-bar';

  toolbar.innerHTML = [
    '<a class="sab-back" href="' + esc(base() + 'Catalogo_Servicios_MDA_Capstone.html') + '">&#8592; Cat\u00e1logo</a>',
    '<div class="sab-sep"></div>',
    '<span class="sab-id">' + esc(A.sopId) + '</span>',
    '<div class="sab-sep"></div>',
    '<button class="sab-btn sab-edit" id="sab-edit-btn">&#9998; Editar contenido</button>',
    '<button class="sab-btn ' + (isHidden ? 'sab-vis-hidden' : 'sab-vis-visible') + '" id="sab-vis-btn">' +
      (isHidden ? '&#128584; Oculto &mdash; publicar' : '&#128065; Visible &mdash; ocultar') +
    '</button>',
    '<span class="sab-badge" id="sab-edit-badge" style="display:none">&#9998; Editado</span>',
  ].join('');

  // Insertar después del nav
  var nav = document.getElementById('mda-nav');
  if (nav && nav.nextSibling) {
    document.body.insertBefore(toolbar, nav.nextSibling);
  } else {
    document.body.appendChild(toolbar);
  }

  document.getElementById('sab-edit-btn').addEventListener('click', openContentEditor);
  document.getElementById('sab-vis-btn').addEventListener('click', toggleCurrentSOP);

  // Verificar si este SOP tiene contenido editado
  if (A.workerUrl && A.sopId) {
    authFetch(A.workerUrl + '/content/' + A.sopId)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.hasEdit) {
          var badge = document.getElementById('sab-edit-badge');
          if (badge) badge.style.display = 'inline-block';
        }
      }).catch(function() {});
  }
}

function refreshSOPToolbar() {
  var old = document.getElementById('sop-admin-bar');
  if (old) old.remove();
  buildSOPToolbar();
}

// Toggle visibilidad desde dentro del SOP
function toggleCurrentSOP() {
  if (!A.sopId) return;
  var idx = A.hiddenProcs.indexOf(A.sopId);
  if (idx >= 0) A.hiddenProcs.splice(idx, 1);
  else          A.hiddenProcs.push(A.sopId);
  syncVisibility();
  refreshSOPToolbar();
  showToast(A.hiddenProcs.includes(A.sopId)
    ? '&#128584; SOP oculto para los agentes'
    : '&#128065; SOP publicado para los agentes');
}

// ═══════════════════════════════════════════════════════
// VISIBILIDAD
// ═══════════════════════════════════════════════════════
function loadVisibility() {
  if (!A.workerUrl) return;
  authFetch(A.workerUrl + '/admin/visibility')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      A.hiddenProcs = d.hidden || [];
      applyVisibility();
      if (A.isSOP) refreshSOPToolbar();
      loadProcKeywords();
      // Disparar evento para que el catálogo actualice sus contadores
      window.dispatchEvent(new CustomEvent('mda:visibility-loaded', {detail:{hidden:A.hiddenProcs}}));
    })
    .catch(function() {});
}

function applyVisibility() {
  var isAdmin = A.user && A.user.role === 'admin';

  // Ocultar/mostrar filas individuales
  document.querySelectorAll('.proc-row[data-sop]').forEach(function(row) {
    var hidden = A.hiddenProcs.includes(row.dataset.sop);
    if (hidden && !isAdmin) {
      // Agente: completamente invisible
      row.style.display    = 'none';
      row.style.opacity    = '';
      row.style.pointerEvents = 'none';
      row.classList.remove('is-hidden');
    } else if (hidden && isAdmin) {
      // Admin: visible pero marcado
      row.style.display    = '';
      row.style.opacity    = '0.45';
      row.style.pointerEvents = '';
      row.classList.add('is-hidden');
    } else {
      row.style.display    = '';
      row.style.opacity    = '';
      row.style.pointerEvents = '';
      row.classList.remove('is-hidden');
    }
  });

  // Ocultar secciones de dominio vacías (para agentes)
  if (!isAdmin) {
    document.querySelectorAll('.dom-section').forEach(function(sec) {
      var visible = sec.querySelectorAll('.proc-row[data-sop]');
      var hasVisible = false;
      visible.forEach(function(r) { if (r.style.display !== 'none') hasVisible = true; });
      sec.style.display = hasVisible ? '' : 'none';
    });
  } else {
    document.querySelectorAll('.dom-section').forEach(function(sec) {
      sec.style.display = '';
    });
  }
}

function syncVisibility() {
  if (!A.workerUrl) return;
  authFetch(A.workerUrl + '/admin/visibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden: A.hiddenProcs }),
  }).catch(function() {});
}

// ═══════════════════════════════════════════════════════
// EDITOR DE CONTENIDO DEL SOP
// ═══════════════════════════════════════════════════════
function openContentEditor() {
  var container = document.querySelector('.container');
  if (!container) {
    showToast('No se encontr\u00f3 el contenido editable del SOP', true);
    return;
  }
  var currentHtml = container.innerHTML;

  var ex = document.getElementById('editor-overlay');
  if (ex) ex.remove();

  var ov = document.createElement('div');
  ov.id  = 'editor-overlay';
  ov.className = 'pc-modal-overlay open';
  ov.innerHTML = [
    '<div class="pc-modal wide" style="height:85vh;display:flex;flex-direction:column">',
    '<div class="pc-modal-hdr">',
    '<strong>&#9998; Editar contenido &mdash; ' + esc(A.sopId) + '</strong>',
    '<button class="pc-modal-x" id="ed-x">\u00d7</button>',
    '</div>',
    '<div style="padding:10px 16px;background:#fff8e1;border-bottom:1px solid #fde68a;font-size:12px;color:#7c5c00">',
    '&#9888;&#65039; Edita el HTML del procedimiento. El c\u00f3digo guardado reemplaza el contenido est\u00e1tico. <strong>Vista previa en tiempo real a la derecha.</strong>',
    '</div>',
    '<div class="pc-modal-body" style="flex:1;overflow:hidden;padding:12px 16px">',
    '<div class="edit-split">',
    '<textarea id="ed-html" spellcheck="false" placeholder="HTML del contenido..."></textarea>',
    '<div class="edit-preview-wrap"><iframe id="ed-preview" sandbox="allow-same-origin"></iframe></div>',
    '</div>',
    '</div>',
    '<div class="pc-modal-ftr">',
    '<button class="pc-btn-danger" id="ed-revert">&#8635; Revertir al original</button>',
    '<div style="flex:1"></div>',
    '<button class="pc-btn-secondary" id="ed-cancel">Cancelar</button>',
    '<button class="pc-btn-primary" id="ed-save">&#128190; Guardar cambios</button>',
    '</div>',
    '</div>',
  ].join('');

  document.body.appendChild(ov);

  var textarea = document.getElementById('ed-html');
  var preview  = document.getElementById('ed-preview');
  textarea.value = currentHtml;

  // Live preview - inyectar CSS del SOP en el preview
  function updatePreview() {
    var css = Array.from(document.styleSheets)
      .map(function(s) {
        try { return Array.from(s.cssRules).map(function(r) { return r.cssText; }).join('\n'); }
        catch(e) { return ''; }
      }).join('\n');
    preview.srcdoc = '<!DOCTYPE html><html><head><style>' + css + '</style></head><body>' + textarea.value + '</body></html>';
  }
  updatePreview();
  textarea.addEventListener('input', updatePreview);

  document.getElementById('ed-x').addEventListener('click', function() { ov.remove(); });
  document.getElementById('ed-cancel').addEventListener('click', function() { ov.remove(); });

  document.getElementById('ed-save').addEventListener('click', function() {
    var html = textarea.value.trim();
    if (!html) return;
    if (!A.workerUrl) {
      // Sin Worker: aplicar solo localmente
      container.innerHTML = html;
      ov.remove();
      showToast('&#9989; Contenido actualizado (solo en esta sesi\u00f3n — configura workerUrl para persistir)');
      return;
    }
    authFetch(A.workerUrl + '/content/' + A.sopId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: html }),
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok) {
        container.innerHTML = html;
        ov.remove();
        showToast('&#9989; Contenido guardado en KV. Los cambios son inmediatos.');
        var badge = document.getElementById('sab-edit-badge');
        if (badge) badge.style.display = 'inline-block';
      }
    })
    .catch(function() { showToast('&#10060; Error al guardar', true); });
  });

  document.getElementById('ed-revert').addEventListener('click', function() {
    if (!confirm('&#191;Revertir al contenido original del archivo HTML? Se eliminar\u00e1 la versi\u00f3n editada en KV.')) return;
    if (!A.workerUrl) { showToast('Configura workerUrl para revertir', true); return; }
    authFetch(A.workerUrl + '/content/' + A.sopId, { method: 'DELETE' })
      .then(function() {
        ov.remove();
        showToast('&#8635; Contenido revertido al original. Recarga la p\u00e1gina para verlo.');
        var badge = document.getElementById('sab-edit-badge');
        if (badge) badge.style.display = 'none';
      })
      .catch(function() { showToast('&#10060; Error al revertir', true); });
  });
}

// ═══════════════════════════════════════════════════════
// PANEL DE ADMINISTRACIÓN (modal 2 tabs)
// ═══════════════════════════════════════════════════════
function openAdminPanel(tab) {
  tab = tab || 'users';
  var existing = document.getElementById('admin-overlay');
  if (existing) {
    existing.classList.add('open');
    switchAdminTab(tab);
    if (tab === 'users') loadRoles();
    if (tab === 'vis')   loadVisibilityAdmin();
    return;
  }

  var o = document.createElement('div');
  o.id  = 'admin-overlay';
  o.innerHTML = [
    '<div id="admin-panel">',
    '<div id="admin-panel-hdr">',
    '<div><h2>&#9881;&#65039; Administraci\u00f3n</h2>',
    '<div style="font-size:11px;opacity:.75;margin-top:2px">' + esc(A.user.email) + ' &middot; Admin</div></div>',
    '<button class="adm-x" id="adm-close">&#215;</button>',
    '</div>',
    '<div class="adm-tabs">',
    '<div class="adm-tab" data-tab="users">&#128101; Usuarios y Roles</div>',
    '<div class="adm-tab" data-tab="vis">&#128065; Visibilidad</div>',
    '<div class="adm-tab" data-tab="knowledge">&#128218; Base de Conocimiento</div>',
    '</div>',
    '<div class="adm-body" id="adm-tab-users"><div id="users-container">Cargando...</div></div>',
    '<div class="adm-body" id="adm-tab-vis"><div id="vis-container">Cargando...</div></div>',
    '<div class="adm-body" id="adm-tab-knowledge"><div id="knowledge-container">Cargando...</div></div>',
    '</div>',
  ].join('');

  o.addEventListener('click', function(e) { if (e.target === o) closeAdminPanel(); });
  document.body.appendChild(o);
  o.classList.add('open');

  document.getElementById('adm-close').addEventListener('click', closeAdminPanel);
  o.querySelectorAll('.adm-tab').forEach(function(t) {
    t.addEventListener('click', function() { switchAdminTab(t.dataset.tab); });
  });

  switchAdminTab(tab);
  if (tab === 'users')    loadRoles();
  if (tab === 'vis')      loadVisibilityAdmin();
  if (tab === 'knowledge') loadKnowledge();
}

function switchAdminTab(tab) {
  document.querySelectorAll('.adm-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.adm-body').forEach(function(b) {
    b.classList.toggle('active', b.id === 'adm-tab-' + tab);
  });
  if (tab === 'users')    loadRoles();
  if (tab === 'vis')      loadVisibilityAdmin();
  if (tab === 'knowledge') loadKnowledge();
}

function closeAdminPanel() {
  var o = document.getElementById('admin-overlay');
  if (o) o.classList.remove('open');
}

// ═══════════════════════════════════════════════════════
// TAB USUARIOS
// ═══════════════════════════════════════════════════════
function loadRoles() {
  var c = document.getElementById('users-container');
  if (!c) return;
  if (!A.workerUrl) { c.innerHTML = '<p style="color:#aaa;font-size:13px">Worker no configurado.</p>'; return; }

  authFetch(A.workerUrl + '/admin/users')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var users  = data.users || {};
      var emails = Object.keys(users);

      var html = '<div style="margin-bottom:14px;display:flex;align-items:center;gap:10px">' +
        '<button class="ap-btn" id="btn-invite">+ Agregar usuario</button>' +
        '<span style="font-size:11px;color:#888">Agrega el correo ANTES de que el usuario intente ingresar.</span></div>';

      if (!emails.length) {
        html += '<p style="color:#aaa;font-size:13px">Sin usuarios a\u00fan.</p>';
      } else {
        html += '<table class="u-table"><thead><tr><th></th><th>Usuario</th><th>Rol</th><th>\u00daltimo acceso</th><th></th></tr></thead><tbody>';
        emails.forEach(function(email) {
          var u     = users[email];
          var pend  = u.status === 'invited';
          var av    = u.picture
            ? '<img class="u-avatar-sm" src="' + esc(u.picture) + '" alt="">'
            : '<div class="u-avatar-fb">' + (u.name || email)[0].toUpperCase() + '</div>';
          var badge = pend
            ? '<span class="status-badge status-invited">PENDIENTE</span>'
            : '<span class="status-badge status-active">ACTIVO</span>';
          var last  = u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('es-CL') : (pend ? 'A\u00fan no ha entrado' : '\u2014');
          var del   = email !== A.user.email
            ? '<button class="btn-del" data-email="' + esc(email) + '">\u00d7 Quitar</button>'
            : '<small style="color:#aaa">(t\u00fa)</small>';

          html += '<tr><td>' + av + '</td>' +
            '<td><strong>' + esc(u.name || email) + '</strong>' + badge +
            '<br><span style="font-size:11px;color:#888">' + esc(email) + '</span></td>' +
            '<td><select class="role-sel" data-email="' + esc(email) + '">' +
            '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '<option value="agent"' + (u.role === 'agent' ? ' selected' : '') + '>Agente</option>' +
            '</select></td>' +
            '<td><small style="color:#aaa">' + last + '</small></td>' +
            '<td>' + del + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      c.innerHTML = html;

      document.getElementById('btn-invite').addEventListener('click', openInviteModal);
      c.querySelectorAll('.role-sel').forEach(function(s) {
        s.addEventListener('change', function() { changeRole(s.dataset.email, s.value); });
      });
      c.querySelectorAll('.btn-del').forEach(function(b) {
        b.addEventListener('click', function() { deleteUser(b.dataset.email); });
      });
    })
    .catch(function() { c.innerHTML = '<p style="color:#c0392b">Error al cargar usuarios.</p>'; });
}

function changeRole(email, role) {
  authFetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: role }),
  }).then(function() { showToast('&#9989; Rol actualizado'); })
    .catch(function() { showToast('&#10060; Error', true); });
}

function deleteUser(email) {
  if (!confirm('\u00bfQuitar acceso a ' + email + '?')) return;
  authFetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), { method: 'DELETE' })
    .then(function() { loadRoles(); showToast('&#9989; Acceso eliminado'); })
    .catch(function() { showToast('&#10060; Error', true); });
}

// ═══════════════════════════════════════════════════════
// MODAL INVITAR USUARIO
// ═══════════════════════════════════════════════════════
function openInviteModal() {
  var ex = document.getElementById('inv-overlay');
  if (ex) ex.remove();
  var o = document.createElement('div');
  o.id = 'inv-overlay'; o.className = 'pc-modal-overlay open';
  o.innerHTML = [
    '<div class="pc-modal">',
    '<div class="pc-modal-hdr"><strong>+ Dar acceso a usuario</strong><button class="pc-modal-x" id="inv-x">\u00d7</button></div>',
    '<div class="pc-modal-body">',
    '<div class="ap-note">El usuario se autentica con su propia cuenta Google. T\u00fa nunca ves su contrase\u00f1a.</div>',
    '<div><div class="pc-label">Correo del usuario</div><input class="pc-input" type="email" id="inv-email" placeholder="jorge.palma@tres60.cl"></div>',
    '<div><div class="pc-label">Nombre (opcional)</div><input class="pc-input" type="text" id="inv-name" placeholder="Jorge Palma"></div>',
    '<div><div class="pc-label">Rol</div><select class="pc-select" id="inv-role">',
    '<option value="agent" selected>Agente \u2014 solo lectura del playbook</option>',
    '<option value="admin">Admin \u2014 acceso total y administraci\u00f3n</option>',
    '</select></div>',
    '<div class="pc-error" id="inv-err"></div>',
    '</div>',
    '<div class="pc-modal-ftr"><button class="pc-btn-secondary" id="inv-cancel">Cancelar</button><button class="pc-btn-primary" id="inv-ok">Dar acceso</button></div>',
    '</div>',
  ].join('');
  document.body.appendChild(o);
  o.addEventListener('click', function(e) { if (e.target === o) o.remove(); });
  document.getElementById('inv-x').addEventListener('click', function() { o.remove(); });
  document.getElementById('inv-cancel').addEventListener('click', function() { o.remove(); });
  document.getElementById('inv-ok').addEventListener('click', function() {
    var email = (document.getElementById('inv-email').value || '').trim().toLowerCase();
    var name  = (document.getElementById('inv-name').value  || '').trim();
    var role  =  document.getElementById('inv-role').value;
    var err   =  document.getElementById('inv-err');
    if (!email || !email.includes('@')) { err.textContent='Correo inv\u00e1lido.'; err.style.display='block'; return; }
    authFetch(A.workerUrl + '/admin/users', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email:email, name:name, role:role }),
    }).then(function(r){return r.json();}).then(function(d){
      if(d.error){err.textContent=d.error;err.style.display='block';return;}
      o.remove(); showToast('&#9989; Acceso concedido a ' + email); loadRoles();
    }).catch(function(){err.textContent='Error al guardar.';err.style.display='block';});
  });
  setTimeout(function() { var el = document.getElementById('inv-email'); if(el) el.focus(); }, 80);
}

// ═══════════════════════════════════════════════════════
// TAB VISIBILIDAD
// ═══════════════════════════════════════════════════════
function loadVisibilityAdmin() {
  var c = document.getElementById('vis-container');
  if (!c) return;

  // Buscar PROCS en window o en window._mdaProcs (alias global)
  var rawProcs = window.PROCS || window._mdaProcs || [];
  var procs = rawProcs.map(function(p) {
    return { sop: p.sop || p.cs_id, titulo: p.titulo, dom: p.dom };
  });
  if (!procs.length) {
    c.innerHTML = '<p style="color:#aaa;font-size:13px">Este panel est\u00e1 disponible en el Cat\u00e1logo principal.</p>';
    return;
  }

  var vis   = procs.filter(function(p) { return !A.hiddenProcs.includes(p.sop); }).length;
  var pct   = Math.round(vis / procs.length * 100);

  var domNames = { GIA:'&#128273; Identidad',SAP:'&#9881;&#65039; SAP',APP:'&#128188; Aplicaciones',EQU:'&#128187; Equipos',NET:'&#127760; Red',MIN:'&#127981; Operaciones',VHF:'&#128251; VHF',COL:'&#128172; Colaboraci\u00f3n',CYB:'&#128702; Ciberseguridad',SOT:'&#128295; Soporte',INF:'&#128194; Infraestructura' };
  var dominios = {};
  procs.forEach(function(p) { if(!dominios[p.dom]) dominios[p.dom]=[]; dominios[p.dom].push(p); });

  var html = [
    '<div style="margin-bottom:16px">',
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
    '<strong style="font-size:13px">' + vis + ' de ' + procs.length + ' procedimientos visibles</strong>',
    '<div style="display:flex;gap:8px">',
    '<button class="ap-btn green" id="btn-show-all">&#128065; Mostrar todos</button>',
    '<button class="ap-btn red" id="btn-hide-all">&#128584; Ocultar todos</button>',
    '</div></div>',
    '<div class="vis-prog-wrap"><div class="vis-prog-bar" style="width:' + pct + '%"></div></div>',
    '<div style="font-size:11px;color:#888">' + pct + '% visible para los agentes</div>',
    '</div>',
  ].join('');

  Object.keys(dominios).forEach(function(dom) {
    var dp  = dominios[dom];
    var dv  = dp.filter(function(p){return !A.hiddenProcs.includes(p.sop);}).length;
    var did = 'vd-' + dom;
    html += '<div style="margin-bottom:10px">';
    html += '<div class="vis-dom-hdr" data-target="' + did + '">' +
      '<span style="font-size:13px;font-weight:700">' + (domNames[dom]||dom) + '</span>' +
      '<span style="font-size:11px;color:#888">' + dv + '/' + dp.length + ' visibles &#9660;</span></div>';
    html += '<div id="' + did + '" style="border:1px solid #eef1f7;border-top:none;border-radius:0 0 8px 8px">';
    dp.forEach(function(p) {
      var h = A.hiddenProcs.includes(p.sop);
      html += '<div class="vis-item' + (h?' is-hidden':'') + '">' +
        '<div><div style="font-family:monospace;font-size:11px;font-weight:700;color:#0057a8">' + esc(p.sop) + (h?'<span class="hidden-badge">OCULTO</span>':'') + '</div>' +
        '<div style="font-size:12px;color:#555">' + esc(p.titulo) + '</div></div>' +
        '<button class="vis-toggle" data-sop="' + esc(p.sop) + '">' + (h?'&#128584;':'&#128065;') + '</button></div>';
    });
    html += '</div></div>';
  });

  c.innerHTML = html;
  document.getElementById('btn-show-all').addEventListener('click', function() { setAllVisibility(true); });
  document.getElementById('btn-hide-all').addEventListener('click', function() { setAllVisibility(false); });
  c.querySelectorAll('.vis-dom-hdr').forEach(function(h) {
    h.addEventListener('click', function() {
      var t = document.getElementById(h.dataset.target);
      if(t) t.style.display = t.style.display==='none'?'':'none';
    });
  });
  c.querySelectorAll('.vis-toggle').forEach(function(b) {
    b.addEventListener('click', function() { toggleVisibility(b.dataset.sop); });
  });
}

function toggleVisibility(sopId) {
  var idx = A.hiddenProcs.indexOf(sopId);
  if(idx>=0) A.hiddenProcs.splice(idx,1); else A.hiddenProcs.push(sopId);
  syncVisibility(); loadVisibilityAdmin(); applyVisibility();
  showToast(A.hiddenProcs.includes(sopId)?'&#128584; Oculto':'&#128065; Visible');
}

function setAllVisibility(visible) {
  var procs=(window.PROCS||[]).map(function(p){return p.sop;});
  if(!procs.length){showToast('Abre el Cat\u00e1logo para usar esta funci\u00f3n.',true);return;}
  if(!confirm(visible?'\u00bfHacer VISIBLES todos los procedimientos?':'\u00bfOCULTAR todos los procedimientos?'))return;
  A.hiddenProcs=visible?[]:procs.slice();
  syncVisibility(); loadVisibilityAdmin(); applyVisibility();
  showToast(visible?'&#128065; Todos visibles':'&#128584; Todos ocultos');
}

// ═══════════════════════════════════════════════════════
// MODAL SUBIR NUEVO SOP
// ═══════════════════════════════════════════════════════
function openUploadModal() {
  var ex = document.getElementById('upload-overlay');
  if (ex) ex.remove();

  var o = document.createElement('div');
  o.id  = 'upload-overlay';
  o.className = 'pc-modal-overlay open';
  o.innerHTML = [
    '<div class="pc-modal" style="max-width:560px">',
    '<div class="pc-modal-hdr"><strong>&#11014;&#65039; Subir Nuevo Procedimiento</strong><button class="pc-modal-x" id="upl-x">\u00d7</button></div>',
    '<div class="pc-modal-body">',
    '<div class="ap-note">',
    'El archivo HTML debe tener el mismo formato que los SOPs existentes.<br>',
    'Debe contener un elemento con <code>class="sop-id"</code> que incluya el c\u00f3digo (ej: SOP-GIA-008).',
    '</div>',
    '<div class="upload-zone" id="upl-zone">',
    '<input type="file" id="upload-file-input" accept=".html">',
    '<div class="uz-icon">&#128196;</div>',
    '<div class="uz-text">Arrastra el archivo HTML aqu\u00ed</div>',
    '<div class="uz-sub">o haz clic para seleccionar</div>',
    '</div>',
    '<div class="file-preview" id="upl-preview">',
    '<div class="fp-name" id="upl-fname"></div>',
    '<div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px">',
    '<div><div class="pc-label">SOP ID detectado</div><input class="pc-input" id="upl-sopid" placeholder="SOP-GIA-008" style="font-family:monospace"></div>',
    '<div><div class="pc-label">Dominio</div><select class="pc-select" id="upl-dom">',
    '<option value="GIA">GIA \u2014 Identidad</option>',
    '<option value="SAP">SAP \u2014 ERP</option>',
    '<option value="APP">APP \u2014 Aplicaciones</option>',
    '<option value="EQU">EQU \u2014 Equipos</option>',
    '<option value="NET">NET \u2014 Red</option>',
    '<option value="MIN">MIN \u2014 Mina</option>',
    '<option value="VHF">VHF \u2014 Radio</option>',
    '<option value="COL">COL \u2014 Colaboraci\u00f3n</option>',
    '<option value="CYB">CYB \u2014 Ciberseguridad</option>',
    '<option value="SOT">SOT \u2014 Soporte</option>',
    '<option value="INF">INF \u2014 Infraestructura</option>',
    '</select></div>',
    '</div>',
    '<div><div class="pc-label">T\u00edtulo del procedimiento</div><input class="pc-input" id="upl-titulo" placeholder="Ej: Reseteo de contrase\u00f1a SAP"></div>',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">',
    '<div><div class="pc-label">Nivel de resoluci\u00f3n</div><input class="pc-input" id="upl-nivel" placeholder="N1"></div>',
    '<div><div class="pc-label">Criticidad</div><select class="pc-select" id="upl-crit"><option>MEDIO</option><option>ALTO</option><option>CR\u00cdTICO</option></select></div>',
    '</div>',
    '<div><div class="pc-label">Grupo Responsable</div><input class="pc-input" id="upl-grupo" placeholder="Help_Desk_Support_Chile_Tech"></div>',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">',
    '<div><div class="pc-label">Faenas aplicables</div><input class="pc-input" id="upl-faenas" placeholder="MVE, MBL, STG, VAN"></div>',
    '<div></div>',
    '</div>',
    '</div>',
    '<div class="pc-error" id="upl-err"></div>',
    '</div>',
    '<div class="pc-modal-ftr">',
    '<button class="pc-btn-secondary" id="upl-cancel">Cancelar</button>',
    '<button class="pc-btn-primary" id="upl-save" disabled>&#11014;&#65039; Publicar procedimiento</button>',
    '</div>',
    '</div>',
  ].join('');

  document.body.appendChild(o);
  o.addEventListener('click', function(e) { if(e.target===o) o.remove(); });
  document.getElementById('upl-x').addEventListener('click', function(){o.remove();});
  document.getElementById('upl-cancel').addEventListener('click', function(){o.remove();});

  var fileInput   = document.getElementById('upload-file-input');
  var zone        = document.getElementById('upl-zone');
  var previewDiv  = document.getElementById('upl-preview');
  var saveBtn     = document.getElementById('upl-save');
  var uploadedHtml = '';

  // Click en zona
  zone.addEventListener('click', function(){fileInput.click();});

  // Drag & Drop
  zone.addEventListener('dragover',  function(e){e.preventDefault();zone.classList.add('drag-over');});
  zone.addEventListener('dragleave', function(){zone.classList.remove('drag-over');});
  zone.addEventListener('drop', function(e){e.preventDefault();zone.classList.remove('drag-over');handleFile(e.dataTransfer.files[0]);});
  fileInput.addEventListener('change', function(){if(fileInput.files[0]) handleFile(fileInput.files[0]);});

  function handleFile(file) {
    if (!file || !file.name.endsWith('.html')) {
      document.getElementById('upl-err').textContent='Solo se aceptan archivos .html';
      document.getElementById('upl-err').style.display='block';
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      uploadedHtml = e.target.result;
      document.getElementById('upl-fname').textContent = file.name + ' (' + Math.round(file.size/1024) + ' KB)';

      // Auto-detectar datos del SOP desde el HTML
      var sopMatch    = uploadedHtml.match(/class="sop-id"[^>]*>([^<]+)</);
      var titleMatch  = uploadedHtml.match(/<title>([^<]+)<\/title>/);
      var domMatch    = uploadedHtml.match(/SOP-([A-Z]+)-/);
      var nivelMatch  = uploadedHtml.match(/<strong>Nivel<\/strong>([^<]+)<\/div>/) ||
                        uploadedHtml.match(/info-label[^>]*>Nivel<\/span>[^<]*<span[^>]*>([^<]+)/);
      var grupoMatch  = uploadedHtml.match(/<strong>Grupo<\/strong>([^<]+)<\/div>/) ||
                        uploadedHtml.match(/Grupo Responsable<\/span>[^<]*<span[^>]*>([^<]+)/);
      var faenasMatch = uploadedHtml.match(/class="meta-chip"><strong>Faena<\/strong>([^<]+)<\/div>/);

      if(sopMatch) {
        var detectedId = sopMatch[1].trim().replace(/[^\w-]/g,'');
        document.getElementById('upl-sopid').value = detectedId;
      }
      if(domMatch) {
        var sel = document.getElementById('upl-dom');
        for(var i=0;i<sel.options.length;i++){
          if(sel.options[i].value===domMatch[1]){sel.selectedIndex=i;break;}
        }
      }
      if(titleMatch) {
        var t=titleMatch[1].replace(/SOP-[A-Z]+-\d+\s*[^\w]*/,'').trim();
        document.getElementById('upl-titulo').value=t;
      }
      // Nivel detectado del HTML
      if(nivelMatch) {
        document.getElementById('upl-nivel').value = nivelMatch[1].trim();
      }
      // Grupo responsable detectado del HTML
      if(grupoMatch) {
        document.getElementById('upl-grupo').value = grupoMatch[1].trim();
      }
      // Faenas detectadas
      if(faenasMatch) {
        document.getElementById('upl-faenas').value = faenasMatch[1].trim();
      }

      previewDiv.classList.add('show');
      saveBtn.disabled = false;
    };
    reader.readAsText(file, 'utf-8');
  }

  document.getElementById('upl-save').addEventListener('click', function() {
    var sopId   = document.getElementById('upl-sopid').value.trim();
    var titulo  = document.getElementById('upl-titulo').value.trim();
    var dom     = document.getElementById('upl-dom').value;
    var faenas  = document.getElementById('upl-faenas').value.trim() || 'MVE, MBL, STG, VAN';
    var crit    = document.getElementById('upl-crit').value;
    var errEl   = document.getElementById('upl-err');

    if(!sopId||!titulo||!uploadedHtml){errEl.textContent='Completa todos los campos.';errEl.style.display='block';return;}
    if(!A.workerUrl){errEl.textContent='Worker no configurado.';errEl.style.display='block';return;}

    var nivel  = (document.getElementById('upl-nivel') ? document.getElementById('upl-nivel').value : '').trim() || 'N1';
    var grupo  = (document.getElementById('upl-grupo') ? document.getElementById('upl-grupo').value : '').trim();
    var meta = { sopId: sopId, titulo: titulo, dom: dom, faenas: faenas, criticidad: crit, nivel: nivel, grupo: grupo };

    authFetch(A.workerUrl + '/sop/upload', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ html: uploadedHtml, meta: meta }),
    }).then(function(r){return r.json();})
      .then(function(d){
        if(d.ok){
          o.remove();
          showToast('&#9989; Procedimiento ' + sopId + ' publicado. Aparecer\u00e1 en el cat\u00e1logo.');
          // Recargar cat\u00e1logo si estamos en él
          if(!A.isSOP){
            // Definir/sobreescribir loadCustomSOPs con implementación correcta
            // Esto funciona sin importar qué versión del catálogo esté desplegada
            window.loadCustomSOPs = function(){
              var _A = window.PlaybookAuth;
              if(!_A||!_A.workerUrl) return;
              _A.authFetch(_A.workerUrl+'/sop/list')
                .then(function(r){return r.json();})
                .then(function(data){
                  if(!data.sops||!data.sops.length) return;
                  var _PROCS = window._mdaProcs||[];
                  data.sops.forEach(function(sop){
                    var exists=_PROCS.some(function(p){return p.sop===sop.sopId;});
                    if(!exists){
                      _PROCS.push({
                        sop     : sop.sopId,
                        titulo  : sop.titulo,
                        dom     : sop.dom,
                        ops     : (sop.faenas||'MVE,MBL,STG,VAN').split(',').map(function(f){return f.trim();}),
                        desc    : sop.titulo,
                        nivel   : sop.nivel  || 'N1',
                        grupos  : sop.grupo  || sop.grupos || '',
                        acciones: Array.isArray(sop.acciones)?sop.acciones:[],
                        esc     : sop.esc    || '',
                        crit    : sop.criticidad||'MEDIO',
                        tiempo  : sop.tiempo || '—',
                        href    : 'viewer.html?sop='+encodeURIComponent(sop.sopId),
                        custom  : true
                      });
                    }
                  });
                  if(typeof buildOpsGrid==='function') buildOpsGrid();
                  if(typeof renderIndex==='function'&&typeof currentOp!=='undefined'&&currentOp) renderIndex();
                }).catch(function(){});
            };
            window.loadCustomSOPs();
          }
        } else {
          errEl.textContent=d.error||'Error al publicar.';errEl.style.display='block';
        }
      }).catch(function(){errEl.textContent='Error de red.';errEl.style.display='block';});
  });
}


// ═══════════════════════════════════════════════════════
// KEYWORDS DE BÚSQUEDA POR PROCEDIMIENTO
// ═══════════════════════════════════════════════════════

function loadProcKeywords() {
  if (!A.workerUrl) return;
  authFetch(A.workerUrl + '/proc/keywords')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      window._procKeywords = data.keywords || {};
      // Re-renderizar el índice para mostrar los keywords actualizados
      if (typeof window._renderIndexIfActive === 'function') window._renderIndexIfActive();
      // Si somos admin, agregar botones de edición y parchear renderIndex
      if (A.user && A.user.role === 'admin') {
        document.body.classList.add('admin-mode');
        injectKeywordEditButtons();
        // Parchear renderIndex del catálogo para re-inyectar botones tras cada re-render
        if (typeof renderIndex === 'function' && !renderIndex._patched) {
          var _origRender = renderIndex;
          renderIndex = function() {
            _origRender.apply(this, arguments);
            setTimeout(injectKeywordEditButtons, 50);
          };
          renderIndex._patched = true;
        }
      }
    })
    .catch(function() {});
}

function injectKeywordEditButtons() {
  // Agregar botón editar a cada .proc-keywords visible
  document.querySelectorAll('.proc-keywords[data-sop]').forEach(function(div) {
    if (div.querySelector('.kw-edit-btn')) return; // ya tiene botón
    var btn = document.createElement('button');
    btn.className = 'kw-edit-btn';
    btn.textContent = '✏️ editar';
    btn.dataset.sop = div.dataset.sop;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      openKeywordModal(div.dataset.sop);
    });
    div.appendChild(btn);
  });
}

function openKeywordModal(sopId) {
  // Encontrar el título del SOP para mostrarlo en el modal
  var row  = document.querySelector('.proc-row[data-sop="' + sopId + '"]');
  var title = row ? (row.querySelector('.proc-titulo') || {}).textContent || sopId : sopId;
  var current = (window._procKeywords || {})[sopId] || '';

  var ex = document.getElementById('kw-modal-overlay');
  if (ex) ex.remove();

  var o = document.createElement('div');
  o.id = 'kw-modal-overlay';
  o.className = 'pc-modal-overlay open';
  o.innerHTML = [
    '<div class="pc-modal" style="max-width:560px">',
    '<div class="pc-modal-hdr">',
    '<div>',
    '<strong>🔍 Términos de búsqueda</strong>',
    '<div style="font-size:11px;opacity:.8;margin-top:2px">' + esc(sopId) + ' — ' + esc(title) + '</div>',
    '</div>',
    '<button class="pc-modal-x" id="kw-x">×</button>',
    '</div>',
    '<div class="pc-modal-body">',
    '<div class="ap-note">',
    'Agrega sinónimos, términos alternativos o palabras clave separadas por comas o espacios.<br>',
    'Estos términos <strong>NO reemplazan</strong> el texto original — se suman al buscador.',
    '</div>',
    '<div>',
    '<div class="pc-label">Texto actual bajo el título (no editable)</div>',
    '<div style="background:#f7f9fc;border-radius:8px;padding:9px 12px;font-size:12px;color:#555;font-style:italic">' + esc(row ? (row.querySelector('.proc-desc') || {}).textContent || '' : '') + '</div>',
    '</div>',
    '<div>',
    '<div class="pc-label">Términos adicionales para búsqueda</div>',
    '<textarea class="pc-input" id="kw-input" rows="3" style="resize:vertical" ',
    'placeholder="Ej: alta usuario, onboarding, nuevo ingreso, acceso red corporativa, crear cuenta"></textarea>',
    '</div>',
    '<div style="background:#e8f5ee;border-radius:8px;padding:9px 12px;font-size:11px;color:#1a6b3a">',
    '💡 Ejemplo: para "Creación de Cuenta AD" podrías agregar:<br>',
    '<em>alta usuario, nuevo empleado, onboarding, incorporación, acceso dominio</em>',
    '</div>',
    '<div class="pc-error" id="kw-err"></div>',
    '</div>',
    '<div class="pc-modal-ftr">',
    '<button class="pc-btn-danger" id="kw-clear">🗑 Limpiar términos</button>',
    '<div style="flex:1"></div>',
    '<button class="pc-btn-secondary" id="kw-cancel">Cancelar</button>',
    '<button class="pc-btn-primary" id="kw-save">💾 Guardar</button>',
    '</div>',
    '</div>',
  ].join('');

  document.body.appendChild(o);
  o.addEventListener('click', function(e) { if (e.target === o) o.remove(); });

  var input = document.getElementById('kw-input');
  input.value = current;

  document.getElementById('kw-x').addEventListener('click', function() { o.remove(); });
  document.getElementById('kw-cancel').addEventListener('click', function() { o.remove(); });

  document.getElementById('kw-clear').addEventListener('click', function() {
    if (!confirm('¿Eliminar todos los términos personalizados de este procedimiento?')) return;
    saveKeyword(sopId, '', o);
  });

  document.getElementById('kw-save').addEventListener('click', function() {
    saveKeyword(sopId, input.value.trim(), o);
  });

  setTimeout(function() { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 80);
}

function saveKeyword(sopId, keywords, modal) {
  if (!A.workerUrl) {
    showToast('Worker no configurado.', true);
    return;
  }
  authFetch(A.workerUrl + '/proc/keywords', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sopId: sopId, keywords: keywords }),
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.error) {
      var errEl = document.getElementById('kw-err');
      if (errEl) { errEl.textContent = d.error; errEl.style.display = 'block'; }
      return;
    }
    // Actualizar cache local
    if (!window._procKeywords) window._procKeywords = {};
    window._procKeywords[sopId] = keywords;

    // Cerrar modal
    if (modal) modal.remove();

    // Re-renderizar el índice para reflejar el cambio
    if (typeof window._renderIndexIfActive === 'function') window._renderIndexIfActive();
    setTimeout(injectKeywordEditButtons, 100);

    showToast(keywords
      ? '✅ Términos guardados — el buscador ya los incluye'
      : '✅ Términos eliminados');
  })
  .catch(function() { showToast('❌ Error al guardar.', true); });
}

// ═══════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════
function logout() {
  if(!confirm('\u00bfCerrar sesi\u00f3n?'))return;
  localStorage.removeItem('mda_session');
  if(A.workerUrl){
    authFetch(A.workerUrl+'/auth/logout').finally(function(){window.location.href=base()+'login.html';});
  } else {
    window.location.href=base()+'login.html';
  }
}

// ═══════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════
A.openAdminPanel   = openAdminPanel;
A.closeAdminPanel  = closeAdminPanel;
A.logout           = logout;
A.toggleVisibility = toggleVisibility;
A.setAllVisibility = setAllVisibility;
A.openInviteModal  = openInviteModal;
A.openUploadModal  = openUploadModal;
A.showToast        = showToast;
A.buildSOPToolbar  = buildSOPToolbar;
A.refreshSOPToolbar= refreshSOPToolbar;
A.loadProcKeywords = loadProcKeywords;
A.openKeywordModal = openKeywordModal;
A.applyVisibility  = applyVisibility;
A.authFetch        = authFetch;



// ═══════════════════════════════════════════════════════
// BASE DE CONOCIMIENTO (Tab en panel admin)
// ═══════════════════════════════════════════════════════

function loadKnowledge() {
  var c = document.getElementById('knowledge-container');
  if (!c) return;
  if (!A.workerUrl) { c.innerHTML = '<p style="color:#aaa;font-size:13px">Worker no configurado.</p>'; return; }

  authFetch(A.workerUrl + '/knowledge')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var entries  = data.entries || [];
      var approved = entries.filter(function(e) { return e.approved; });
      var pending  = entries.filter(function(e) { return !e.approved; });

      var cats = ['Conectividad','M365','Hardware','SAP','VHF','Escalamiento','General'];

      var html = [
        '<div style="margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">',
        '<button class="ap-btn" id="btn-add-knowledge">+ Agregar manualmente</button>',
        '<button class="ap-btn" style="background:#7b2d8b" id="btn-extract-conv">&#129302; Extraer de conversaci\u00f3n</button>',
        '<span style="font-size:11px;color:#888;margin-left:4px">' + approved.length + ' aprobadas &nbsp;\u00b7&nbsp; ' + pending.length + ' pendientes de revisi\u00f3n</span>',
        '</div>',
      ].join('');

      if (pending.length > 0) {
        html += '<div style="background:#fff8e1;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#7c5c00">' +
          '&#9888;&#65039; <strong>' + pending.length + ' entrada(s) pendiente(s) de aprobaci\u00f3n</strong> \u2014 revisar abajo' +
          '</div>';
        pending.forEach(function(e) { html += renderKBEntry(e, true); });
        html += '<hr style="margin:16px 0;border:none;border-top:1px solid #eef1f7">';
      }

      if (!approved.length && !pending.length) {
        html += '<div style="text-align:center;padding:40px;color:#aaa">' +
          '<div style="font-size:40px;margin-bottom:10px">&#128218;</div>' +
          '<div style="font-size:14px;font-weight:700">La base de conocimiento est\u00e1 vac\u00eda</div>' +
          '<div style="font-size:12px;margin-top:6px">Agrega entradas manualmente o pega una conversaci\u00f3n de Teams para extraer aprendizajes con IA.</div>' +
          '</div>';
      } else {
        // Agrupar por categoría
        cats.forEach(function(cat) {
          var catEntries = approved.filter(function(e) { return (e.category || 'General') === cat; });
          if (!catEntries.length) return;
          html += '<div style="font-size:11px;font-weight:700;color:#0057a8;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px">' + cat + ' (' + catEntries.length + ')</div>';
          catEntries.forEach(function(e) { html += renderKBEntry(e, false); });
        });
      }

      c.innerHTML = html;

      document.getElementById('btn-add-knowledge').addEventListener('click', openAddKnowledgeModal);
      document.getElementById('btn-extract-conv').addEventListener('click', openExtractModal);

      c.querySelectorAll('[data-kb-approve]').forEach(function(btn) {
        btn.addEventListener('click', function() { approveKBEntry(btn.dataset.kbApprove); });
      });
      c.querySelectorAll('[data-kb-delete]').forEach(function(btn) {
        btn.addEventListener('click', function() { deleteKBEntry(btn.dataset.kbDelete); });
      });
    })
    .catch(function() { c.innerHTML = '<p style="color:#c0392b">Error al cargar la base de conocimiento.</p>'; });
}

function renderKBEntry(e, isPending) {
  var responses = (e.responses || []).map(function(r) { return '<li>' + esc(r) + '</li>'; }).join('');
  return '<div class="kb-entry' + (isPending ? ' pending' : '') + '">' +
    '<div class="kb-entry-hdr">' +
    '<div class="kb-situation">' + (isPending ? '&#8987; ' : '') + esc(e.situation) + '</div>' +
    '<span class="kb-cat">' + esc(e.category || 'General') + '</span>' +
    '</div>' +
    '<ul class="kb-responses">' + responses + '</ul>' +
    '<div class="kb-meta">Fuente: ' + esc(e.source || 'manual') + ' &nbsp;\u00b7&nbsp; ' +
    (e.addedBy ? 'por ' + esc(e.addedBy.split('@')[0]) : '') + ' &nbsp;\u00b7&nbsp; ' +
    (e.addedAt ? new Date(e.addedAt).toLocaleDateString('es-CL') : '') + '</div>' +
    '<div class="kb-actions">' +
    (isPending ? '<button class="kb-btn approve" data-kb-approve="' + esc(e.id) + '">&#10003; Aprobar</button>' : '') +
    '<button class="kb-btn del" data-kb-delete="' + esc(e.id) + '">\u00d7 Eliminar</button>' +
    '</div></div>';
}

function approveKBEntry(id) {
  authFetch(A.workerUrl + '/knowledge/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved: true }),
  }).then(function() { loadKnowledge(); showToast('&#10003; Entrada aprobada y activa para la IA'); })
    .catch(function() { showToast('&#10060; Error', true); });
}

function deleteKBEntry(id) {
  if (!confirm('\u00bfEliminar esta entrada de conocimiento?')) return;
  authFetch(A.workerUrl + '/knowledge/' + id, { method: 'DELETE' })
    .then(function() { loadKnowledge(); showToast('Entrada eliminada'); })
    .catch(function() { showToast('&#10060; Error', true); });
}

// ── Modal: Agregar entrada manualmente ────────────────────────────────────────
function openAddKnowledgeModal() {
  var ex = document.getElementById('kb-add-overlay');
  if (ex) ex.remove();
  var o = document.createElement('div');
  o.id = 'kb-add-overlay'; o.className = 'pc-modal-overlay open';
  o.innerHTML = [
    '<div class="pc-modal" style="max-width:560px">',
    '<div class="pc-modal-hdr"><strong>&#43; Agregar conocimiento</strong><button class="pc-modal-x" id="kba-x">\u00d7</button></div>',
    '<div class="pc-modal-body">',
    '<div><div class="pc-label">Situaci\u00f3n / Problema</div>',
    '<input class="pc-input" id="kba-sit" placeholder="Ej: Usuario reporta conexi\u00f3n a Teams lenta"></div>',
    '<div><div class="pc-label">Categor\u00eda</div>',
    '<select class="pc-select" id="kba-cat">',
    '<option>Conectividad</option><option>M365</option><option>Hardware</option>',
    '<option>SAP</option><option>VHF</option><option>Escalamiento</option><option selected>General</option>',
    '</select></div>',
    '<div><div class="pc-label">Respuestas comprobadas (una por l\u00ednea)</div>',
    '<textarea class="conv-textarea" id="kba-resp" rows="5" placeholder="Llamar al celular para descartar problema de app\nVerificar si otros del mismo switch tienen el problema\nTransferir a Networking si persiste m\u00e1s de 10 min"></textarea></div>',
    '<div class="pc-error" id="kba-err"></div>',
    '</div>',
    '<div class="pc-modal-ftr">',
    '<button class="pc-btn-secondary" id="kba-cancel">Cancelar</button>',
    '<button class="pc-btn-primary" id="kba-save">&#128190; Guardar</button>',
    '</div></div>',
  ].join('');
  document.body.appendChild(o);
  o.addEventListener('click', function(e) { if (e.target === o) o.remove(); });
  document.getElementById('kba-x').addEventListener('click', function() { o.remove(); });
  document.getElementById('kba-cancel').addEventListener('click', function() { o.remove(); });
  document.getElementById('kba-save').addEventListener('click', function() {
    var sit      = (document.getElementById('kba-sit').value  || '').trim();
    var cat      =  document.getElementById('kba-cat').value;
    var respRaw  = (document.getElementById('kba-resp').value || '').trim();
    var responses = respRaw.split('\n').map(function(r) { return r.trim(); }).filter(Boolean);
    var errEl    =  document.getElementById('kba-err');
    if (!sit || !responses.length) { errEl.textContent = 'Completa la situaci\u00f3n y al menos una respuesta.'; errEl.style.display = 'block'; return; }
    authFetch(A.workerUrl + '/knowledge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ situation: sit, responses: responses, category: cat, source: 'manual' }),
    }).then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
        o.remove(); loadKnowledge();
        showToast('&#10003; Conocimiento guardado. El bot ya puede usarlo.');
      }).catch(function() { errEl.textContent = 'Error al guardar.'; errEl.style.display = 'block'; });
  });
  setTimeout(function() { var el = document.getElementById('kba-sit'); if (el) el.focus(); }, 80);
}

// ── Modal: Extraer desde conversación ─────────────────────────────────────────
function openExtractModal() {
  var ex = document.getElementById('kb-ext-overlay');
  if (ex) ex.remove();
  var o = document.createElement('div');
  o.id = 'kb-ext-overlay'; o.className = 'pc-modal-overlay open';
  o.innerHTML = [
    '<div class="pc-modal" style="max-width:680px">',
    '<div class="pc-modal-hdr"><strong>&#129302; Extraer aprendizajes de conversaci\u00f3n</strong><button class="pc-modal-x" id="ext-x">\u00d7</button></div>',
    '<div class="pc-modal-body">',
    '<div class="ap-note">Pega aqu\u00ed una conversaci\u00f3n de Teams, WhatsApp u otro canal. La IA identificar\u00e1 los aprendizajes pr\u00e1cticos del equipo.</div>',
    '<div><div class="pc-label">Conversaci\u00f3n (puedes pegar texto copiado directamente)</div>',
    '<textarea class="conv-textarea" id="ext-conv" placeholder="Ejemplo:\nOscar: Me llega un ticket, el usuario dice que Teams va lento\nJorge: \u00bfest\u00e1 usando la app o el browser?\nOscar: app nativa\nJorge: dile que la cierre completamente y la reabra, generalmente eso resuelve\nOscar: funcionó, gracias!"></textarea></div>',
    '<div id="ext-results" style="display:none">',
    '<div class="pc-label" style="margin-top:4px">Aprendizajes detectados \u2014 selecciona los que quieres guardar:</div>',
    '<div class="extract-result" id="ext-items"></div>',
    '</div>',
    '<div class="pc-error" id="ext-err"></div>',
    '</div>',
    '<div class="pc-modal-ftr">',
    '<button class="pc-btn-secondary" id="ext-cancel">Cancelar</button>',
    '<button class="pc-btn-primary" id="ext-extract">&#129302; Extraer con IA</button>',
    '<button class="pc-btn-primary" id="ext-save" style="display:none;background:#1a6b3a">&#128190; Guardar seleccionados</button>',
    '</div></div>',
  ].join('');
  document.body.appendChild(o);
  o.addEventListener('click', function(e) { if (e.target === o) o.remove(); });
  document.getElementById('ext-x').addEventListener('click', function() { o.remove(); });
  document.getElementById('ext-cancel').addEventListener('click', function() { o.remove(); });

  var extracted = [];

  document.getElementById('ext-extract').addEventListener('click', function() {
    var conv = (document.getElementById('ext-conv').value || '').trim();
    var errEl = document.getElementById('ext-err');
    if (conv.length < 30) { errEl.textContent = 'La conversaci\u00f3n es muy corta. Pega al menos un intercambio.'; errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';

    var btn = document.getElementById('ext-extract');
    btn.textContent = 'Analizando...'; btn.disabled = true;

    authFetch(A.workerUrl + '/knowledge/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation: conv }),
    }).then(function(r) { return r.json(); })
      .then(function(d) {
        btn.textContent = 'Extraer con IA'; btn.disabled = false;
        if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
        extracted = d.extracted || [];
        if (!extracted.length) {
          errEl.textContent = 'La IA no encontr\u00f3 aprendizajes claros en esta conversaci\u00f3n. Intenta con un intercambio m\u00e1s concreto.';
          errEl.style.display = 'block'; return;
        }

        var itemsHtml = extracted.map(function(item, idx) {
          var resps = (item.responses || []).map(function(r) { return '<li>' + esc(r) + '</li>'; }).join('');
          return '<div class="extract-item">' +
            '<input type="checkbox" id="ext-chk-' + idx + '" checked>' +
            '<div style="flex:1">' +
            '<div style="font-weight:700;font-size:13px;color:#1a1a2e;margin-bottom:4px">' + esc(item.situation) + '</div>' +
            '<ul class="kb-responses">' + resps + '</ul>' +
            '<span class="kb-cat">' + esc(item.category || 'General') + '</span>' +
            '</div></div>';
        }).join('');

        document.getElementById('ext-items').innerHTML = itemsHtml;
        document.getElementById('ext-results').style.display = 'block';
        document.getElementById('ext-save').style.display = 'inline-block';
        showToast('&#129302; IA detect\u00f3 ' + extracted.length + ' aprendizaje(s). Revisa y guarda.');
      })
      .catch(function() {
        btn.textContent = 'Extraer con IA'; btn.disabled = false;
        errEl.textContent = 'Error al contactar el Worker.'; errEl.style.display = 'block';
      });
  });

  document.getElementById('ext-save').addEventListener('click', function() {
    var selected = extracted.filter(function(_, idx) {
      var chk = document.getElementById('ext-chk-' + idx);
      return chk && chk.checked;
    });
    if (!selected.length) { showToast('Selecciona al menos un aprendizaje.', true); return; }

    var promises = selected.map(function(item) {
      return authFetch(A.workerUrl + '/knowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          situation: item.situation, responses: item.responses,
          category: item.category || 'General', source: 'extracted',
        }),
      });
    });

    Promise.all(promises).then(function() {
      o.remove(); loadKnowledge();
      showToast('&#10003; ' + selected.length + ' aprendizaje(s) guardados. El bot ya puede usarlos.');
    }).catch(function() { showToast('&#10060; Error al guardar algunos aprendizajes.', true); });
  });

  setTimeout(function() { var el = document.getElementById('ext-conv'); if (el) el.focus(); }, 80);
}

// Exponer en API pública
window.PlaybookAuth.loadKnowledge      = loadKnowledge;
window.PlaybookAuth.openExtractModal   = openExtractModal;
window.PlaybookAuth.openAddKnowledgeModal = openAddKnowledgeModal;

// ═══════════════════════════════════════════════════════
// FORMATEADOR DE RESPUESTAS IA (compartido: catálogo + SOPs)
// ═══════════════════════════════════════════════════════

function formatAIResponse(text) {
  if (!text) return '';
  // 1. Escapar HTML base
  var t = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Negrita **texto** → <strong>
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // 3. Procesar línea a línea
  var lines = t.split('\n');
  var html = '';
  var inUL = false, inOL = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var bullet   = line.match(/^[-•*]\s+(.*)/);
    var numbered = line.match(/^(\d+)\.\s+(.*)/);
    var heading  = line.match(/^#{1,3}\s+(.*)/);

    if (bullet) {
      if (inOL) { html += '</ol>'; inOL = false; }
      if (!inUL) { html += '<ul>'; inUL = true; }
      html += '<li>' + bullet[1] + '</li>';
    } else if (numbered) {
      if (inUL) { html += '</ul>'; inUL = false; }
      if (!inOL) { html += '<ol>'; inOL = true; }
      html += '<li>' + numbered[2] + '</li>';
    } else {
      if (inUL) { html += '</ul>'; inUL = false; }
      if (inOL) { html += '</ol>'; inOL = false; }
      if (heading) {
        html += '<strong>' + heading[1] + '</strong><br>';
      } else if (line.trim() === '') {
        // Línea vacía = separador de párrafo
        if (html && !html.endsWith('<br>') && !html.endsWith('</ul>') && !html.endsWith('</ol>')) {
          html += '<br>';
        }
      } else {
        html += line + '<br>';
      }
    }
  }
  if (inUL) html += '</ul>';
  if (inOL) html += '</ol>';

  // Limpiar trailing <br>
  html = html.replace(/(<br>\s*)+$/, '');
  html = html.replace(/(<br>\s*){3,}/g, '<br><br>');

  return html;
}

window.formatAIResponse = formatAIResponse;

// ═══════════════════════════════════════════════════════
// CHAT IA EN EL CATÁLOGO (asistente MDA general)
// ═══════════════════════════════════════════════════════

var _catAiHistory = [];

function buildCatalogAIChat() {
  // Solo en el catálogo (no SOPs)
  if (A.isSOP) return;
  if (document.getElementById('cat-ai-fab')) return;
  // Verificar que el DOM esté listo
  if (!document.body) { setTimeout(buildCatalogAIChat, 100); return; }

  var fab = document.createElement('button');
  fab.id = 'cat-ai-fab';
  fab.innerHTML = '✨';
  fab.title = 'Asistente MDA — Pregúntame sobre procedimientos';
  fab.addEventListener('click', function() {
    var panel = document.getElementById('cat-ai-panel');
    if (panel) panel.classList.toggle('open');
  });
  document.body.appendChild(fab);

  var panel = document.createElement('div');
  panel.id = 'cat-ai-panel';
  panel.innerHTML = [
    '<div class="cai-hdr">',
    '  <div class="cai-hdr-l">',
    '    <div class="cai-avatar">🤖</div>',
    '    <div><div class="cai-name">Asistente MDA</div>',
    '    <div class="cai-sub">Capstone Copper · Mesa de Ayuda</div></div>',
    '  </div>',
    '  <button class="cai-x" id="cat-ai-close">✕</button>',
    '</div>',
    '<div class="cai-msgs" id="cat-ai-msgs">',
    '  <div class="cai-thinking" id="cat-ai-thinking"></div>',
    '</div>',
    '<div class="cai-input-row">',
    '  <input class="cai-input" id="cat-ai-input" type="text" placeholder="Ej: ¿Qué SOP uso para crear una cuenta AD?">',
    '  <button class="cai-send" id="cat-ai-send">↑</button>',
    '</div>',
  ].join('');
  document.body.appendChild(panel);

  document.getElementById('cat-ai-close').addEventListener('click', function() {
    panel.classList.remove('open');
  });
  document.getElementById('cat-ai-send').addEventListener('click', sendCatalogAI);
  document.getElementById('cat-ai-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendCatalogAI();
  });

  // Mensaje de bienvenida
  addCatalogAIMessage('bot', '¡Hola! Soy el Asistente MDA. Puedo ayudarte a:\n- Encontrar el procedimiento correcto para un incidente\n- Orientarte sobre qué SOP consultar\n- Responder preguntas generales del servicio\n\n¿Qué necesitas?');
}

function sendCatalogAI() {
  var input = document.getElementById('cat-ai-input');
  var msg   = (input.value || '').trim();
  if (!msg) return;
  input.value = '';

  addCatalogAIMessage('user', msg);
  _catAiHistory.push({ role: 'user', content: msg });

  if (!A.workerUrl) {
    addCatalogAIMessage('bot', 'El Worker no está configurado. Configura workerUrl para activar el asistente.');
    return;
  }

  var thinking = document.getElementById('cat-ai-thinking');
  thinking.style.display = 'block';
  thinking.textContent = 'escribiendo...';
  scrollCatalogAI();

  // Construir contexto: lista de procedimientos + base de conocimiento
  var procContext = '';
  if (window._mdaProcs && window._mdaProcs.length) {
    procContext = '\n\nPROCEDIMIENTOS DISPONIBLES EN EL PLAYBOOK (' + window._mdaProcs.length + ' procedimientos):\n';
    var domains = {};
    window._mdaProcs.forEach(function(p) {
      if (!domains[p.dom]) domains[p.dom] = [];
      domains[p.dom].push(p.sop + ' — ' + p.titulo);
    });
    Object.keys(domains).forEach(function(dom) {
      procContext += '\n[' + dom + ']\n' + domains[dom].join('\n');
    });
  }

  var systemPrompt = 'Eres el Asistente MDA de la Mesa de Ayuda de Capstone Copper Chile.\n' +
    'Ayudas a los agentes a:\n' +
    '- Encontrar el procedimiento (SOP) correcto para un incidente o requerimiento\n' +
    '- Orientarlos sobre qué sección del Playbook consultar\n' +
    '- Responder preguntas generales sobre el servicio de soporte\n\n' +
    'Usa formato estructurado en tus respuestas: listas con guiones, negritas para SOPs y conceptos clave.\n' +
    'Cuando cites un SOP, usa el formato exacto: **SOP-GIA-001**.\n' +
    'Respuestas en español, máximo 200 palabras.' +
    procContext;

  authFetch(A.workerUrl + '/chat', {
    method  : 'POST',
    headers : { 'Content-Type': 'application/json' },
    body    : JSON.stringify({
      system  : systemPrompt,
      messages: _catAiHistory,
      sopId   : 'CATALOGO',
    }),
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    thinking.style.display = 'none';
    var reply = data.response || 'Sin respuesta.';
    _catAiHistory.push({ role: 'assistant', content: reply });
    addCatalogAIMessage('bot', reply);
  })
  .catch(function(e) {
    thinking.style.display = 'none';
    addCatalogAIMessage('bot', '❌ Error al contactar el asistente: ' + e.message);
  });
}

function addCatalogAIMessage(who, text) {
  var msgs     = document.getElementById('cat-ai-msgs');
  var thinking = document.getElementById('cat-ai-thinking');
  var div      = document.createElement('div');
  div.className = 'cai-msg cai-msg-' + (who === 'bot' ? 'bot' : 'user');
  div.innerHTML = '<div class="cai-bubble">' +
    (who === 'bot' ? formatAIResponse(text) : text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')) +
    '</div>';
  msgs.insertBefore(div, thinking);
  scrollCatalogAI();
}

function scrollCatalogAI() {
  var msgs = document.getElementById('cat-ai-msgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// Chat IA del catálogo arranca desde finishBoot()


})();
