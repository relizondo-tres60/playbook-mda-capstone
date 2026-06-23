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
  { id: 'feedback',  label: '&#128172; Feedback',       roles: ['admin'],
    href: function() { return base() + 'feedback.html'; } },
];

var NAV_ADMIN = [
  { id: 'users',      label: '&#128101; Usuarios y Roles',       action: 'openTab', tab: 'users' },
  { id: 'visibility', label: '&#128065; Visibilidad de SOPs',    action: 'openTab', tab: 'vis' },
  { id: 'upload',     label: '&#11014;&#65039; Subir Procedimiento', action: 'openUploadModal' },
  { id: 'divider' },
  { id: 'shifts',     label: '&#128260; Cambio de Turno',        soon: true },
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
  t.textContent = msg;
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
    '.pc-modal.wide{max-width:900px}',
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
    '.edit-split{display:grid;grid-template-columns:1fr 1fr;gap:12px;height:55vh}',
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
    })
    .catch(function() {});
}

function applyVisibility() {
  var isAdmin = A.user && A.user.role === 'admin';
  document.querySelectorAll('.proc-row[data-sop]').forEach(function(row) {
    var hidden = A.hiddenProcs.includes(row.dataset.sop);
    if (hidden && !isAdmin) {
      row.style.display = 'none';
    } else if (hidden && isAdmin) {
      row.classList.add('is-hidden');
      row.style.display = '';
    } else {
      row.classList.remove('is-hidden');
      row.style.display = '';
    }
  });
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
    '<div class="adm-tab" data-tab="vis">&#128065; Visibilidad de Procedimientos</div>',
    '</div>',
    '<div class="adm-body" id="adm-tab-users"><div id="users-container">Cargando...</div></div>',
    '<div class="adm-body" id="adm-tab-vis"><div id="vis-container">Cargando...</div></div>',
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
  if (tab === 'users') loadRoles();
  if (tab === 'vis')   loadVisibilityAdmin();
}

function switchAdminTab(tab) {
  document.querySelectorAll('.adm-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.adm-body').forEach(function(b) {
    b.classList.toggle('active', b.id === 'adm-tab-' + tab);
  });
  if (tab === 'users') loadRoles();
  if (tab === 'vis')   loadVisibilityAdmin();
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

  var procs = (window.PROCS || []).map(function(p) { return { sop:p.sop, titulo:p.titulo, dom:p.dom }; });
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
    '<div><div class="pc-label">Faenas aplicables</div><input class="pc-input" id="upl-faenas" placeholder="MVE, MBL, STG, VAN"></div>',
    '<div><div class="pc-label">Criticidad</div><select class="pc-select" id="upl-crit"><option>MEDIO</option><option>ALTO</option><option>CR\u00cdTICO</option></select></div>',
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

      // Auto-detectar datos del SOP
      var sopMatch   = uploadedHtml.match(/class="sop-id"[^>]*>([^<]+)</);
      var titleMatch = uploadedHtml.match(/<title>([^<]+)<\/title>/);
      var domMatch   = uploadedHtml.match(/SOP-([A-Z]+)-/);

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

    var meta = { sopId:sopId, titulo:titulo, dom:dom, faenas:faenas, criticidad:crit };

    authFetch(A.workerUrl + '/sop/upload', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ html: uploadedHtml, meta: meta }),
    }).then(function(r){return r.json();})
      .then(function(d){
        if(d.ok){
          o.remove();
          showToast('&#9989; Procedimiento ' + sopId + ' publicado. Aparecer\u00e1 en el cat\u00e1logo.');
          // Recargar cat\u00e1logo si estamos en él
          if(!A.isSOP && typeof loadCustomSOPs === 'function') loadCustomSOPs();
        } else {
          errEl.textContent=d.error||'Error al publicar.';errEl.style.display='block';
        }
      }).catch(function(){errEl.textContent='Error de red.';errEl.style.display='block';});
  });
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
A.authFetch        = authFetch;

})();
