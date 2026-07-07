(function () {
'use strict';

// ═══ CONFIGURACION ════════════════════════════════════════════════════════════
var A = window.PlaybookAuth = {
  ready:        false,
  user:         null,
  workerUrl:    localStorage.getItem('mda_worker_url') || (window.CFG && CFG.workerUrl) || '',
  session:      localStorage.getItem('mda_session')    || '',
  hiddenProcs:  [],
  deletedProcs: [],
  isSOP:        false,
  sopId:        '',
  sopTitle:     '',
  onReady:      null,
};

function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function base(){
  var p = window.location.pathname;
  return p.includes('/procedimientos/') || p.includes('/viewer') ? '../' : '';
}
function authFetch(url, opts){
  opts = opts || {};
  if(!opts.headers) opts.headers = {};
  opts.headers['Authorization'] = 'Bearer ' + A.session;
  return fetch(url, opts);
}
function redirectToLogin(){
  window.location.href = base() + 'login.html';
}

// ═══ NAVEGACION ════════════════════════════════════════════════════════════════
var NAV_MAIN = [
  { label:'&#128196; Cat\u00e1logo', roles:['admin','agent'], href: function(){ return base()+'Catalogo_Servicios_MDA_Capstone.html'; } },
  { label:'&#128211; Bit\u00e1cora', roles:['admin','agent'], href: function(){ return base()+'bitacora.html'; } },
  { label:'&#9989; To Do\'s',        roles:['admin','agent'], href: function(){ return base()+'todos.html'; } },
];

var NAV_ADMIN = [
  { id:'users',     label:'&#128101; Usuarios y Roles',       tab:'users',      action:'openAdmin' },
  { id:'visibility',label:'&#128065; Visibilidad',            tab:'visibility', action:'openAdmin' },
  { id:'upload',    label:'&#11014;&#65039; Subir Procedimiento',               action:'openUpload' },
  { id:'divider' },
  { id:'feedback',  label:'&#128172; Feedback Interno',                         action:'goFeedback' },
  { id:'shifts',    label:'&#128211; Bit\u00e1cora de Turno',                   action:'goShifts' },
  { id:'todos',     label:'&#9989; To Do\'s',                                   action:'goTodos' },
];

function injectCSS(){
  var styles = [
    'body{padding-top:48px}',
    '#mda-nav{position:fixed;top:0;left:0;right:0;height:48px;background:#1a1a2e;display:flex;align-items:center;padding:0 16px;gap:10px;z-index:9000;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
    '#mda-nav .nav-brand{font-family:\'Barlow Condensed\',sans-serif;font-size:18px;font-weight:800;color:#fff;letter-spacing:.3px;white-space:nowrap}',
    '#mda-nav .nav-sep{width:1px;height:24px;background:rgba(255,255,255,.15);flex-shrink:0}',
    '#mda-nav .nav-link{color:rgba(255,255,255,.8);text-decoration:none;font-size:12px;font-weight:600;padding:4px 8px;border-radius:6px;transition:all .15s;white-space:nowrap}',
    '#mda-nav .nav-link:hover{background:rgba(255,255,255,.12);color:#fff}',
    '#mda-nav .nav-spacer{flex:1}',
    /* Admin dropdown */
    '#mda-nav .nav-admin-wrap{position:relative}',
    '#mda-nav .nav-admin-btn{background:#ff6b00;color:#fff;border:none;cursor:pointer;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px}',
    '#mda-nav .nav-admin-btn:hover{background:#cc5500}',
    '#mda-nav .nav-admin-dropdown{position:absolute;top:100%;right:0;background:#fff;border-radius:0 0 10px 10px;box-shadow:0 8px 32px rgba(0,0,0,.2);min-width:220px;overflow:hidden;display:none;z-index:9100;margin-top:2px}',
    /* hover manejado por JS con delay */
    '#mda-nav .dd-item{display:block;width:100%;text-align:left;padding:10px 16px;border:none;background:none;cursor:pointer;font-size:13px;color:#1a1a2e;font-family:\'Barlow\',sans-serif;font-weight:500;transition:background .1s}',
    '#mda-nav .dd-item:hover{background:#f0f3f8}',
    '#mda-nav .dd-divider{height:1px;background:#eef1f7;margin:4px 0}',
    '#mda-nav .dd-soon{color:#aaa;cursor:default}',
    '#mda-nav .dd-soon-badge{background:#e8f0fb;color:#0057a8;font-size:10px;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:700}',
    /* User */
    '#mda-nav .nav-user{display:flex;align-items:center;gap:7px;margin-left:10px}',
    '#mda-nav .nav-avatar{width:28px;height:28px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.3)}',
    '#mda-nav .nav-avatar-fb{width:28px;height:28px;border-radius:50%;background:#0057a8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid rgba(255,255,255,.3)}',
    '#mda-nav .nav-username{color:rgba(255,255,255,.9);font-size:12px;font-weight:600;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#mda-nav .nav-logout{background:rgba(255,255,255,.12);border:none;color:rgba(255,255,255,.7);cursor:pointer;border-radius:6px;padding:4px 8px;font-size:11px;margin-left:4px;transition:background .15s}',
    '#mda-nav .nav-logout:hover{background:rgba(255,255,255,.2);color:#fff}',
    /* SOP admin bar */
    '#sop-admin-bar{position:fixed;top:48px;left:0;right:0;background:#f7f9fc;border-bottom:1px solid #d0d8e8;padding:6px 14px;display:flex;align-items:center;gap:8px;z-index:8000}',
    '.sab-back{color:#0057a8;text-decoration:none;font-size:12px;font-weight:600}',
    '.sab-id{font-family:monospace;font-size:11px;background:#1a1a2e;color:#fff;padding:3px 8px;border-radius:4px}',
    '.sab-btn{border:1.5px solid #d0d8e8;background:#fff;color:#333;cursor:pointer;border-radius:7px;padding:5px 12px;font-size:12px;font-weight:600;transition:all .12s;font-family:\'Barlow\',sans-serif}',
    '.sab-btn:hover{border-color:#0057a8;color:#0057a8}',
    '.sab-badge{background:#ff6b00;color:#fff;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700}',
    '.sab-vis-visible{border-color:#22c55e;color:#15803d}',
    '.sab-vis-hidden{border-color:#94a3b8;color:#64748b}',
    /* Admin modal */
    '.mda-modal-overlay{position:fixed;inset:0;background:rgba(10,10,30,.6);z-index:10000;display:none;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)}',
    '.mda-modal-overlay.open{display:flex}',
    '.mda-modal-box{background:#fff;border-radius:16px;max-width:700px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.3);overflow:hidden}',
    '.mda-modal-hdr{background:linear-gradient(135deg,#0057a8,#1a1a2e);color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}',
    '.mda-modal-hdr strong{font-size:16px}',
    '.mda-modal-close{background:none;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1;opacity:.8}',
    '.mda-modal-close:hover{opacity:1}',
    '.mda-tabs{display:flex;gap:0;background:#f7f9fc;border-bottom:1px solid #eef1f7;flex-shrink:0;overflow-x:auto;scrollbar-width:none}',
    '.mda-tabs::-webkit-scrollbar{display:none}',
    '.mda-tab{padding:10px 20px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:#666;border-bottom:2px solid transparent;font-family:\'Barlow\',sans-serif;transition:all .15s}',
    '.mda-tab.active{color:#0057a8;border-bottom-color:#0057a8;background:#fff}',
    '.mda-modal-body{padding:18px 20px;overflow-y:auto;flex:1}',
    /* Users tab */
    '.user-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f0f3f8}',
    '.user-avatar{width:36px;height:36px;border-radius:50%;object-fit:cover;background:#e8f0fb;flex-shrink:0}',
    '.user-info{flex:1;min-width:0}',
    '.user-email{font-size:12px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.user-name{font-size:13px;font-weight:700;color:#1a1a2e}',
    '.role-badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px}',
    '.role-admin{background:#fff3e0;color:#e65100}.role-agent{background:#e8f0fb;color:#0057a8}',
    '.status-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px}',
    '.status-active{background:#d1fae5;color:#065f46}.status-pending{background:#fef3cd;color:#92400e}',
    '.pc-label{font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}',
    '.pc-input,.pc-select{width:100%;border:1.5px solid #d0d8e8;border-radius:8px;padding:8px 12px;font-size:13px;font-family:\'Barlow\',sans-serif;outline:none}',
    '.pc-input:focus,.pc-select:focus{border-color:#0057a8}',
    '.pc-btn{background:#0057a8;color:#fff;border:none;cursor:pointer;border-radius:8px;padding:9px 20px;font-size:13px;font-weight:700;width:100%}',
    '.pc-btn:hover{background:#003d7a}',
    '.pc-btn-sec{background:#f0f3f8;color:#555;border:1.5px solid #d0d8e8;cursor:pointer;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:600}',
    /* Visibility tab */
    '.vis-item{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:8px;margin-bottom:6px;background:#f7f9fc;gap:8px}',
    '.vis-item.is-hidden{opacity:.6;background:#f0f0f0}',
    '.vis-toggle{background:#0057a8;color:#fff;border:none;cursor:pointer;border-radius:6px;padding:4px 10px;font-size:13px}',
    '.vis-del-btn{background:#fde8e8;color:#c0392b;border:1px solid #fca5a5;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px}',
    '.vis-down-btn{background:#e8f0fb;color:#0057a8;border:1px solid #c7d9f5;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px}',
    '.hidden-badge{background:#fee2e2;color:#c0392b;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;margin-left:4px}',
    '.vis-bar{height:6px;border-radius:3px;background:#e8f0fb;margin:10px 0}',
    '.vis-bar-fill{height:100%;border-radius:3px;background:#0057a8;transition:width .3s}',
    /* Upload SOP */
    '.upl-drop{border:2px dashed #d0d8e8;border-radius:10px;padding:30px;text-align:center;cursor:pointer;transition:border-color .15s}',
    '.upl-drop.drag{border-color:#0057a8;background:#f0f7ff}',
    '.upl-drop p{color:#888;font-size:13px;margin-top:8px}',
    /* Toast */
    '.mda-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#1a1a2e;color:#fff;padding:10px 20px;border-radius:24px;font-size:13px;font-weight:600;z-index:99999;opacity:0;transition:all .3s;pointer-events:none;white-space:nowrap}',
    /* Edit SOP */
    '.sop-editor-overlay{position:fixed;inset:0;background:rgba(10,10,30,.7);z-index:11000;display:none;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)}',
    '.sop-editor-overlay.open{display:flex}',
    '.sop-editor-box{background:#fff;border-radius:14px;width:min(900px,95vw);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.4);overflow:hidden}',
    '.sop-editor-hdr{background:#1a1a2e;color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}',
    '.sop-editor-body{display:grid;grid-template-columns:1fr 1fr;flex:1;overflow:hidden}',
    '.sop-editor-col{display:flex;flex-direction:column;overflow:hidden;border-right:1px solid #eef1f7}',
    '.sop-editor-col:last-child{border-right:none}',
    '.sop-editor-col-hdr{background:#f7f9fc;padding:8px 12px;font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #eef1f7;flex-shrink:0}',
    '.sop-editor-textarea{flex:1;resize:none;border:none;outline:none;padding:12px;font-size:12px;font-family:monospace;line-height:1.5;overflow-y:auto}',
    '.sop-editor-preview{flex:1;overflow-y:auto;padding:12px}',
    '.sop-editor-ftr{padding:12px 18px;border-top:1px solid #eef1f7;display:flex;gap:8px;justify-content:flex-end;flex-shrink:0}',
    /* inline edit button */
    '.edit-btn-inline{background:#e8f0fb;color:#0057a8;border:1px solid #c7d9f5;border-radius:4px;cursor:pointer;padding:2px 8px;font-size:11px;margin-top:4px;font-family:\'Barlow\',sans-serif;font-weight:600}',
    '.edit-btn-inline:hover{background:#d0e4f7}',
  ];
  var style = document.createElement('style');
  style.textContent = styles.join('\n');
  document.head.appendChild(style);
}

// ═══ SESION Y ARRANQUE ════════════════════════════════════════════════════════
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

  // Definir window.loadCustomSOPs ANTES de llamar A.onReady
  // (el catálogo parchea onReady para llamar esta función)
  if (!A.isSOP) {
    window.loadCustomSOPs = function() {
      if (!A.workerUrl) return;
      authFetch(A.workerUrl + '/sop/list')
        .then(function(r){ return r.json(); })
        .then(function(data){
          if (!data.sops || !data.sops.length) return;
          var _PROCS = window.PROCS || window._mdaProcs || [];
          var delSet = new Set(A.deletedProcs || []);
          data.sops.forEach(function(sop){
            if (delSet.has(sop.sopId)) return;
            var exists = _PROCS.some(function(p){ return p.sop === sop.sopId; });
            // Siempre procesar: reemplaza el estático si existe,
            // o agrega si es nuevo
            var sopOps = (sop.faenas||'MVE,MBL,STG,VAN').split(',').map(function(f){return f.trim();}).filter(Boolean);
            var sopNivel = (sop.nivel||'Nivel 1')
              .replace(/^N1$/i,'Nivel 1').replace(/^N2$/i,'Nivel 2').replace(/^N3$/i,'Nivel 3')
              .replace(/^Nivel\s*1$/i,'Nivel 1').replace(/^Nivel\s*2$/i,'Nivel 2').replace(/^Nivel\s*3$/i,'Nivel 3');
            var customEntry = {
              sop     : sop.sopId,
              titulo  : sop.titulo  || sop.sopId,
              dom     : sop.dom     || 'APP',
              ops     : sopOps.length ? sopOps : ['MVE','MBL','STG','VAN'],
              desc    : sop.titulo  || sop.sopId,
              nivel   : sopNivel,
              grupos  : sop.grupo   || sop.grupos || '',
              acciones: Array.isArray(sop.acciones) ? sop.acciones : [],
              esc     : sop.esc     || '',
              crit    : sop.criticidad || 'MEDIO',
              tiempo  : sop.tiempo  || '\u2014',
              href    : 'viewer.html?sop=' + encodeURIComponent(sop.sopId),
              custom  : true
            };
            if (exists) {
              // Reemplazar el estático con la versión custom
              var replIdx = _PROCS.findIndex(function(p){ return p.sop === sop.sopId; });
              if (replIdx >= 0) _PROCS.splice(replIdx, 1, customEntry);
            } else {
              _PROCS.push(customEntry);
            }
          });
          console.log('[MDA] loadCustomSOPs: ' + data.sops.length + ' custom SOPs cargados, PROCS total=' + _PROCS.length);
          if (typeof buildOpsGrid === 'function') buildOpsGrid();
          if (typeof renderIndex === 'function' && window.currentOp) renderIndex();
          // Botones eliminar en filas (solo admin)
          if (A.user && A.user.role === 'admin') {
            data.sops.forEach(function(sop){
              var row = document.querySelector('[data-sop="' + sop.sopId + '"]');
              if (row && !row.querySelector('.del-custom-btn')) {
                var db = document.createElement('button');
                db.className = 'edit-btn-inline del-custom-btn';
                db.innerHTML = '&#128465; eliminar';
                db.style.cssText = 'background:#fde8e8;color:#c0392b;border:1px solid #fca5a5;margin-left:4px;';
                db.onclick = function(e){ e.preventDefault(); e.stopPropagation(); deleteSOP(sop.sopId, sop.titulo); };
                var eb = row.querySelector('.edit-btn-inline');
                if (eb) eb.after(db);
              }
            });
          }
        }).catch(function(){});
    };
    window.loadCustomSOPs();
  }

  if (A.onReady) A.onReady(A.user);
  if (!A.isSOP) setTimeout(buildCatalogAIChat, 100);
}

// ═══ NAVEGACION BAR ════════════════════════════════════════════════════════════
function buildNav() {
  var existing = document.getElementById('mda-nav');
  if (existing) existing.remove();

  var isAdmin = A.user && A.user.role === 'admin';

  var mainLinks = NAV_MAIN
    .filter(function(item) { return item.roles.includes(A.user ? A.user.role : 'agent'); })
    .map(function(item) {
      var href = item.href ? item.href() : '#';
      return '<a class="nav-link" href="' + esc(href) + '">' + item.label + '</a>';
    }).join('');

  var adminDropdown = '';
  if (isAdmin) {
    var ddItems = NAV_ADMIN.map(function(item) {
      if (item.id === 'divider') return '<div class="dd-divider"></div>';
      if (item.soon) return '<div class="dd-item dd-soon">' + item.label + '<span class="dd-soon-badge">Pr\u00f3ximamente</span></div>';
      return '<button class="dd-item" data-action="' + esc(item.action||'') + '" data-tab="' + esc(item.tab||'') + '">' + item.label + '</button>';
    }).join('');
    adminDropdown = '<div class="nav-admin-wrap">' +
      '<button class="nav-admin-btn" id="nav-admin-toggle">&#9881;&#65039; Admin &#9660;</button>' +
      '<div class="nav-admin-dropdown">' + ddItems + '</div>' +
      '</div>';
  }

  var avatar = A.user && A.user.picture
    ? '<img class="nav-avatar" src="' + esc(A.user.picture) + '" alt="">'
    : '<div class="nav-avatar-fb">' + ((A.user && A.user.name) || 'U')[0].toUpperCase() + '</div>';

  var nav = document.createElement('div');
  nav.id = 'mda-nav';
  nav.innerHTML =
    '<div class="nav-brand">&#128247; MDA</div>' +
    '<div class="nav-sep"></div>' +
    mainLinks +
    '<div class="nav-spacer"></div>' +
    adminDropdown +
    '<div class="nav-user">' + avatar +
    '<span class="nav-username">' + esc(((A.user && A.user.name) || '').split(' ')[0]) + '</span>' +
    ((!A.workerUrl || !A.session) ? '<span style="background:#f59e0b;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-right:4px;">SIN SESIÓN</span>' : '') +
    '<button class="nav-logout" id="nav-logout-btn">Salir</button>' +
    '</div>';

  document.body.insertBefore(nav, document.body.firstChild);

  // Dropdown con delay
  (function() {
    var wrap  = document.querySelector('.nav-admin-wrap');
    var drop  = wrap && wrap.querySelector('.nav-admin-dropdown');
    if (!wrap || !drop) return;
    var timer = null;
    function showDrop() { clearTimeout(timer); drop.style.display = 'block'; }
    function hideDrop() { timer = setTimeout(function(){ drop.style.display = 'none'; }, 280); }
    wrap.addEventListener('mouseenter', showDrop);
    wrap.addEventListener('mouseleave', hideDrop);
    drop.addEventListener('mouseenter', function(){ clearTimeout(timer); });
    drop.addEventListener('mouseleave', hideDrop);
  })();

  // Logout
  var logoutBtn = document.getElementById('nav-logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  // Acciones del dropdown
  document.querySelectorAll('.dd-item[data-action]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var action = btn.dataset.action;
      var tab    = btn.dataset.tab;
      if (action === 'openAdmin')  openAdminPanel(tab);
      if (action === 'openUpload') openUploadModal();
      if (action === 'goFeedback') window.location.href = base() + 'feedback.html';
      if (action === 'goShifts')   window.location.href = base() + 'bitacora.html';
      if (action === 'goTodos')    window.location.href = base() + 'todos.html';
      // cerrar dropdown
      var dd = document.querySelector('.nav-admin-dropdown');
      if (dd) dd.style.display = 'none';
    });
  });
}

function logout() {
  if (A.workerUrl && A.session) {
    authFetch(A.workerUrl + '/auth/logout', { method:'POST' }).catch(function(){});
  }
  localStorage.removeItem('mda_session');
  localStorage.removeItem('mda_worker_url');
  window.location.href = base() + 'login.html';
}

function showToast(msg) {
  var t = document.getElementById('mda-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'mda-toast';
    t.className = 'mda-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  setTimeout(function(){
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
  }, 3000);
}

// ═══ VISIBILIDAD ══════════════════════════════════════════════════════════════
function loadVisibility() {
  if (!A.workerUrl) return;
  authFetch(A.workerUrl + '/admin/visibility')
    .then(function(r){ return r.json(); })
    .then(function(d) {
      A.hiddenProcs  = d.hidden  || [];
      A.deletedProcs = d.deleted || [];
      applyVisibility();
      if (A.isSOP) refreshSOPToolbar();
      loadProcKeywords();
      window.dispatchEvent(new CustomEvent('mda:visibility-loaded', {detail:{hidden:A.hiddenProcs,deleted:A.deletedProcs}}));
    }).catch(function(){});
}

function applyVisibility() {
  var hiddenSet  = new Set(A.hiddenProcs);
  var deletedSet = new Set(A.deletedProcs);
  document.querySelectorAll('.proc-row').forEach(function(row) {
    var sop = row.dataset.sop;
    if (deletedSet.has(sop)) { row.style.display = 'none'; return; }
    row.classList.toggle('hidden-row', hiddenSet.has(sop));
  });
  // Mostrar botón editar para admins
  if (A.user && A.user.role === 'admin') {
    document.querySelectorAll('.proc-row').forEach(function(row) {
      var sop = row.dataset.sop;
      if (!sop || row.querySelector('.edit-btn-inline')) return;
      var td = row.querySelector('td:nth-child(2)');
      if (!td) return;
      var btn = document.createElement('button');
      btn.className = 'edit-btn-inline';
      btn.innerHTML = '&#9998; editar';
      btn.onclick = function(e){ e.stopPropagation(); openSOPEditor(sop); };
      td.appendChild(btn);
    });
  }
}

function syncVisibility() {
  if (!A.workerUrl) return;
  authFetch(A.workerUrl + '/admin/visibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden: A.hiddenProcs }),
  }).catch(function(){});
}

function toggleVisibility(sopId) {
  var idx = A.hiddenProcs.indexOf(sopId);
  if (idx >= 0) A.hiddenProcs.splice(idx, 1); else A.hiddenProcs.push(sopId);
  syncVisibility();
  applyVisibility();
  loadVisibilityAdmin();
}

// ═══ ELIMINAR SOP (admin) ═════════════════════════════════════════════════════
function deleteSOP(sopId, titulo) {
  if (!confirm('\u00bfEliminar "' + sopId + '"?\n' + (titulo||'') + '\n\nEsta acci\u00f3n no se puede deshacer.')) return;
  authFetch(A.workerUrl + '/sop/' + encodeURIComponent(sopId), { method:'DELETE' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.error) { showToast('Error: ' + d.error); return; }
      showToast('\u2705 Procedimiento eliminado');
      A.deletedProcs.push(sopId);
      A.hiddenProcs.push(sopId);
      applyVisibility();
      // Si estamos en el viewer, volver al catalogo
      if (window._mdaViewerMode) { window.location.href = base() + 'Catalogo_Servicios_MDA_Capstone.html'; return; }
      if (typeof buildOpsGrid === 'function') buildOpsGrid();
      if (typeof renderIndex === 'function' && window.currentOp) renderIndex();
    }).catch(function(){ showToast('Error de conexi\u00f3n'); });
}

// ═══ SOP TOOLBAR (admin) ══════════════════════════════════════════════════════
function buildSOPToolbar() {
  if (!A.isSOP || !A.user || A.user.role !== 'admin') return;
  var existing = document.getElementById('sop-admin-bar');
  if (existing) existing.remove();

  var sopEl = document.querySelector('.sop-id');
  if (sopEl && !A.sopId) {
    var match = sopEl.textContent.match(/SOP-[A-Z]+-\d+/);
    if (match) { A.sopId = match[0]; A.sopTitle = document.title.split('\u2014')[1]||''; }
  }

  // Determinar visibilidad
  var isHidden = A.hiddenProcs.includes(A.sopId);

  function createBtn(label, cls, fn) {
    var b = document.createElement('button');
    b.className = cls; b.innerHTML = label;
    b.addEventListener('click', fn);
    return b;
  }

  var toolbar = document.createElement('div');
  toolbar.id = 'sop-admin-bar';

  var isViewerPage = !!window._mdaViewerMode;

  toolbar.innerHTML = [
    '<a class="sab-back" href="' + esc(base() + 'Catalogo_Servicios_MDA_Capstone.html') + '">\u2190 Cat\u00e1logo</a>',
    '<div class="nav-sep"></div>',
    '<span class="sab-id">' + esc(A.sopId) + '</span>',
    '<div class="nav-sep"></div>',
    '<button class="sab-btn sab-edit" id="sab-edit-btn">&#9998; Editar contenido</button>',
    '<button class="sab-btn ' + (isHidden ? 'sab-vis-hidden' : 'sab-vis-visible') + '" id="sab-vis-btn">' +
      (isHidden ? '&#128584; Oculto \u2014 publicar' : '&#128065; Visible \u2014 ocultar') +
    '</button>',
    '<span class="sab-badge" id="sab-edit-badge" style="display:none">&#9998; Editado</span>',
    '<button class="sab-btn" id="sab-dl-btn" style="background:#e8f0fb;color:#0057a8;border:1.5px solid #c7d9f5;margin-left:8px;">&#11015;&#65039; Descargar HTML</button>',
    '<button class="sab-btn" id="sab-del-btn" style="background:#fde8e8;color:#c0392b;border:1.5px solid #fca5a5;margin-left:8px;">&#128465; Eliminar</button>',
  ].join('');

  document.body.insertBefore(toolbar, document.body.children[1]);

  document.getElementById('sab-edit-btn').addEventListener('click', openContentEditor);
  document.getElementById('sab-vis-btn').addEventListener('click', toggleCurrentSOP);
  document.getElementById('sab-dl-btn').addEventListener('click',  downloadCurrentSOP);
  document.getElementById('sab-del-btn').addEventListener('click', function() {
    deleteSOP(A.sopId, A.sopTitle || A.sopId);
  });

  // Verificar si hay contenido editado
  if (A.workerUrl && A.sopId) {
    authFetch(A.workerUrl + '/content/' + A.sopId)
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d.hasEdit) {
          var badge = document.getElementById('sab-edit-badge');
          if (badge) badge.style.display = 'inline-block';
        }
      }).catch(function(){});
  }
}

function refreshSOPToolbar() {
  var bar = document.getElementById('sop-admin-bar');
  if (!bar) { buildSOPToolbar(); return; }
  var btn = document.getElementById('sab-vis-btn');
  if (!btn) return;
  var isHidden = A.hiddenProcs.includes(A.sopId);
  btn.className = 'sab-btn ' + (isHidden ? 'sab-vis-hidden' : 'sab-vis-visible');
  btn.innerHTML = isHidden ? '&#128584; Oculto \u2014 publicar' : '&#128065; Visible \u2014 ocultar';
}

function toggleCurrentSOP() {
  toggleVisibility(A.sopId);
  refreshSOPToolbar();
}

// ═══ EDITOR DE CONTENIDO SOP ═════════════════════════════════════════════════
function openContentEditor() {
  var container = document.querySelector('.container');
  if (!container) { showToast('No se encontr\u00f3 el contenido editable del SOP'); return; }
  var currentHtml = container.innerHTML;
  var ov = document.createElement('div');
  ov.className = 'sop-editor-overlay open';
  ov.innerHTML =
    '<div class="sop-editor-box">' +
      '<div class="sop-editor-hdr"><strong>&#9998; Editar Contenido \u2014 ' + esc(A.sopId) + '</strong>' +
        '<button class="mda-modal-close" id="ed-close">&#215;</button></div>' +
      '<div class="sop-editor-body">' +
        '<div class="sop-editor-col"><div class="sop-editor-col-hdr">&#128196; HTML</div>' +
          '<textarea class="sop-editor-textarea" id="ed-ta" spellcheck="false"></textarea></div>' +
        '<div class="sop-editor-col"><div class="sop-editor-col-hdr">&#128065; Vista previa</div>' +
          '<div class="sop-editor-preview" id="ed-preview"></div></div>' +
      '</div>' +
      '<div class="sop-editor-ftr">' +
        '<button class="pc-btn-sec" id="ed-cancel">Cancelar</button>' +
        '<button class="pc-btn" style="width:auto" id="ed-save">&#128190; Guardar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
  var ta = document.getElementById('ed-ta');
  var preview = document.getElementById('ed-preview');
  ta.value = currentHtml;
  preview.innerHTML = currentHtml;
  ta.addEventListener('input', function(){ preview.innerHTML = ta.value; });
  document.getElementById('ed-close').addEventListener('click', function(){ ov.remove(); });
  document.getElementById('ed-cancel').addEventListener('click', function(){ ov.remove(); });
  document.getElementById('ed-save').addEventListener('click', function() {
    var html = ta.value.trim();
    if (!html) return;
    if (!A.workerUrl) { container.innerHTML = html; ov.remove(); showToast('Contenido actualizado'); return; }
    authFetch(A.workerUrl + '/content/' + A.sopId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: html }),
    }).then(function(r){ return r.json(); })
      .then(function(d){
        if (d.ok) {
          container.innerHTML = html;
          var badge = document.getElementById('sab-edit-badge');
          if (badge) badge.style.display = 'inline-block';
          ov.remove();
          showToast('\u2705 Contenido guardado');
        }
      }).catch(function(){ showToast('Error al guardar'); });
  });
  document.addEventListener('keydown', function onEsc(e){ if(e.key==='Escape'){ ov.remove(); document.removeEventListener('keydown', onEsc); } });
}

function openSOPEditor(sopId) {
  window.location.href = 'procedimientos/' + sopId + '.html';
}

// ═══ PANEL ADMIN ══════════════════════════════════════════════════════════════
function openAdminPanel(tab) {
  var ov = document.getElementById('mda-admin-overlay');
  if (ov) { ov.remove(); }
  ov = document.createElement('div');
  ov.id = 'mda-admin-overlay';
  ov.className = 'mda-modal-overlay open';
  ov.innerHTML =
    '<div class="mda-modal-box">' +
      '<div class="mda-modal-hdr"><strong>&#9881;&#65039; Panel de Administraci\u00f3n</strong>' +
        '<button class="mda-modal-close" id="adm-close">&#215;</button></div>' +
      '<div class="mda-tabs">' +
        '<button class="mda-tab" data-tab="users">&#128101; Usuarios</button>' +
        '<button class="mda-tab" data-tab="visibility">&#128065; Visibilidad</button>' +
        '<button class="mda-tab" data-tab="knowledge">&#128218; Conocimiento</button>' +
      '</div>' +
      '<div class="mda-modal-body" id="adm-body"></div>' +
    '</div>';
  document.body.appendChild(ov);
  document.getElementById('adm-close').addEventListener('click', closeAdminPanel);
  ov.addEventListener('click', function(e){ if(e.target===ov) closeAdminPanel(); });
  ov.querySelectorAll('.mda-tab').forEach(function(t){
    t.addEventListener('click', function(){ switchAdminTab(t.dataset.tab); });
  });
  switchAdminTab(tab || 'users');
}

function closeAdminPanel() {
  var ov = document.getElementById('mda-admin-overlay');
  if (ov) ov.remove();
}

function switchAdminTab(tab) {
  document.querySelectorAll('.mda-tab').forEach(function(t){
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  var body = document.getElementById('adm-body');
  if (tab === 'users') loadRoles(body);
  if (tab === 'visibility') loadVisibilityAdmin(body);
  if (tab === 'knowledge') loadKnowledge(body);
}

// ═══ TAB USUARIOS ═════════════════════════════════════════════════════════════
function loadRoles(container) {
  if (!A.workerUrl) { container.innerHTML = '<p>No hay Worker configurado.</p>'; return; }
  container.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Cargando...</p>';
  authFetch(A.workerUrl + '/admin/users')
    .then(function(r){ return r.json(); })
    .then(function(d) { renderRoles(container, d.users || []); })
    .catch(function(){ container.innerHTML = '<p>Error al cargar usuarios.</p>'; });
}

function renderRoles(container, users) {
  var html = '<div style="margin-bottom:16px;padding:14px;background:#f7f9fc;border-radius:10px;border:1px solid #eef1f7">' +
    '<div class="pc-label">Invitar nuevo usuario</div>' +
    '<div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;margin-top:6px">' +
      '<input class="pc-input" id="inv-email" type="email" placeholder="correo@capstonecopper.com">' +
      '<select class="pc-select" id="inv-role" style="width:auto"><option value="agent">Agente</option><option value="admin">Admin</option></select>' +
      '<button class="pc-btn" style="width:auto" id="inv-btn">Invitar</button>' +
    '</div><div id="inv-error" style="color:#c0392b;font-size:12px;margin-top:4px;display:none"></div></div>';
  users.forEach(function(u) {
    var roleCls   = u.role === 'admin' ? 'role-admin' : 'role-agent';
    var statusCls = u.status === 'active' ? 'status-active' : 'status-pending';
    html += '<div class="user-row">' +
      (u.picture ? '<img class="user-avatar" src="' + esc(u.picture) + '" alt="">' : '<div class="user-avatar" style="display:flex;align-items:center;justify-content:center;background:#e8f0fb;font-size:16px;color:#0057a8">' + (u.name||u.email)[0].toUpperCase() + '</div>') +
      '<div class="user-info"><div class="user-name">' + esc(u.name||u.email) + '</div><div class="user-email">' + esc(u.email) + '</div></div>' +
      '<span class="role-badge ' + roleCls + '">' + esc(u.role) + '</span>' +
      '<span class="status-badge ' + statusCls + '">' + esc(u.status||'active') + '</span>' +
      (u.email !== A.user.email ? '<select class="pc-select" style="width:90px" data-user="' + esc(u.email) + '" onchange="window.PlaybookAuth.changeRole(this.value,this.dataset.user)"><option value="agent"' + (u.role==='agent'?' selected':'') + '>Agente</option><option value="admin"' + (u.role==='admin'?' selected':'') + '>Admin</option></select>' +
        '<button class="pc-btn-sec" style="color:#c0392b;border-color:#fca5a5" onclick="window.PlaybookAuth.deleteUser(\'' + esc(u.email) + '\')">&#215;</button>' : '') +
    '</div>';
  });
  container.innerHTML = html;
  var invBtn = document.getElementById('inv-btn');
  if (invBtn) invBtn.addEventListener('click', function(){ openInviteModal(); });
}

function changeRole(role, email) {
  authFetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: role }),
  }).then(function(){ showToast('Rol actualizado'); loadRoles(document.getElementById('adm-body')); })
    .catch(function(){ showToast('Error'); });
}

function deleteUser(email) {
  if (!confirm('Eliminar a ' + email + '?')) return;
  authFetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), { method:'DELETE' })
    .then(function(){ showToast('Usuario eliminado'); loadRoles(document.getElementById('adm-body')); })
    .catch(function(){ showToast('Error'); });
}

function openInviteModal() {
  var email = (document.getElementById('inv-email')||{}).value || '';
  var role  = (document.getElementById('inv-role')||{}).value  || 'agent';
  if (!email) { var err = document.getElementById('inv-error'); if(err){err.textContent='Email requerido';err.style.display='block';} return; }
  authFetch(A.workerUrl + '/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  }).then(function(r){ return r.json(); })
    .then(function(d){
      if (d.error) { var err=document.getElementById('inv-error'); if(err){err.textContent=d.error;err.style.display='block';} return; }
      showToast('Usuario invitado');
      loadRoles(document.getElementById('adm-body'));
    }).catch(function(){ showToast('Error'); });
}

// ═══ TAB VISIBILIDAD ══════════════════════════════════════════════════════════
function loadVisibilityAdmin(container) {
  var c = container || document.getElementById('adm-body');
  if (!c) return;
  c.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Cargando...</p>';

  // Obtener SOPs desde el Worker (custom) + locales (estáticos si estamos en el catálogo)
  var localProcs = (window.PROCS || window._mdaProcs || []).slice();

  var fetchCustom = A.workerUrl
    ? authFetch(A.workerUrl + '/sop/list').then(function(r){ return r.json(); }).catch(function(){ return {sops:[]}; })
    : Promise.resolve({sops:[]});

  fetchCustom.then(function(data){
    var customSops = data.sops || [];
    var deletedSet = new Set(A.deletedProcs || []);

    // Agregar SOPs custom a la lista local si no están ya
    customSops.forEach(function(sop){
      var exists = localProcs.some(function(p){ return (p.sop||p.cs_id) === sop.sopId; });
      if (!exists && !deletedSet.has(sop.sopId)) {
        localProcs.push({
          sop   : sop.sopId,
          titulo: sop.titulo,
          dom   : sop.dom,
          custom: true,
        });
      }
    });

    var procs = localProcs.filter(function(p){
      return !deletedSet.has(p.sop || p.cs_id);
    }).map(function(p){
      return { sop: p.sop || p.cs_id, titulo: p.titulo, dom: p.dom || 'APP', custom: !!p.custom };
    });

    if (!procs.length) {
      c.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Sin procedimientos disponibles.<br><small>Abre el panel desde la página principal del catálogo.</small></p>';
      return;
    }

    var hiddenSet = new Set(A.hiddenProcs);
    var visible   = procs.filter(function(p){ return !hiddenSet.has(p.sop); }).length;
    var total     = procs.length;
    var pct       = total ? Math.round(visible / total * 100) : 0;

    var html = '<div style="margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">' +
        '<span>' + visible + '/' + total + ' visibles</span><span>' + pct + '%</span>' +
      '</div>' +
      '<div class="vis-bar"><div class="vis-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="pc-btn-sec" onclick="window.PlaybookAuth.setAllVisibility(true)">&#128584; Ocultar todos</button>' +
        '<button class="pc-btn-sec" onclick="window.PlaybookAuth.setAllVisibility(false)">&#128065; Mostrar todos</button>' +
      '</div></div>';

    // Agrupar por dominio
    var grouped = {};
    procs.forEach(function(p){ var d = p.dom || '?'; if(!grouped[d]) grouped[d]=[]; grouped[d].push(p); });

    Object.keys(grouped).sort().forEach(function(dom){
      html += '<div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.4px;margin:12px 0 6px">' + esc(dom) + '</div>';
      grouped[dom].forEach(function(p){
        var h = hiddenSet.has(p.sop);
        html += '<div class="vis-item' + (h ? ' is-hidden' : '') + '">' +
          '<div>' +
            '<div style="font-family:monospace;font-size:11px;font-weight:700;color:#0057a8">' + esc(p.sop) +
              (h ? '<span class="hidden-badge">OCULTO</span>' : '') +
              (p.custom ? '<span style="background:#e8f0fb;color:#0057a8;font-size:9px;padding:1px 5px;border-radius:4px;margin-left:4px">CUSTOM</span>' : '') +
            '</div>' +
            '<div style="font-size:12px;color:#555">' + esc(p.titulo || p.sop) + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center">' +
            '<button class="vis-toggle" data-sop="' + esc(p.sop) + '">' + (h ? '&#128584;' : '&#128065;') + '</button>' +
            '<button class="vis-down-btn" data-sop="' + esc(p.sop) + '" data-custom="' + (p.custom ? '1' : '0') + '" title="Descargar HTML">&#11015;&#65039;</button>' +
            '<button class="vis-del-btn" data-sop="' + esc(p.sop) + '" data-titulo="' + esc(p.titulo || p.sop) + '" title="Eliminar">&#128465;</button>' +
          '</div>' +
        '</div>';
      });
    });

    c.innerHTML = html;

    c.querySelectorAll('.vis-toggle').forEach(function(b){
      b.addEventListener('click', function(){ toggleVisibility(b.dataset.sop); });
    });
    c.querySelectorAll('.vis-del-btn').forEach(function(b){
      b.addEventListener('click', function(){ deleteSOP(b.dataset.sop, b.dataset.titulo); });
    });
    c.querySelectorAll('.vis-down-btn').forEach(function(b){
      b.addEventListener('click', function(){ downloadSOP(b.dataset.sop, b.dataset.custom === '1'); });
    });
  });
}

function setAllVisibility(hide) {
  var rawProcs = window.PROCS || window._mdaProcs || [];
  A.hiddenProcs = hide ? rawProcs.map(function(p){ return p.sop||p.cs_id; }) : [];
  syncVisibility();
  applyVisibility();
  loadVisibilityAdmin();
}

// ═══ PROC KEYWORDS ════════════════════════════════════════════════════════════
function loadProcKeywords() {
  if (!A.workerUrl) return;
  authFetch(A.workerUrl + '/proc/keywords')
    .then(function(r){ return r.json(); })
    .then(function(d){
      window._mdaProcKeywords = d.keywords || {};
      window._procKeywords    = d.keywords || {};
      // Reconstruir índice de búsqueda con keywords actualizados
      if (typeof rebuildSearchIndex === 'function') {
        rebuildSearchIndex();
      } else {
        // Fallback: actualizar directamente
        document.querySelectorAll('.proc-row[data-sop]').forEach(function(row) {
          var sop = row.dataset.sop;
          var kw  = (d.keywords || {})[sop] || '';
          if (kw) row.dataset.search = row.dataset.search + ' ' + kw.toLowerCase();
        });
      }
    })
    .catch(function(){});
}

function openKeywordModal(sopId) {
  var kw = (window._mdaProcKeywords && window._mdaProcKeywords[sopId]) || '';
  var newKw = prompt('Keywords para ' + sopId + ' (separadas por coma):', kw);
  if (newKw === null) return;
  authFetch(A.workerUrl + '/proc/keywords', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sopId: sopId, keywords: newKw }),
  }).then(function(){ showToast('Keywords guardadas'); loadProcKeywords(); })
    .catch(function(){ showToast('Error'); });
}

// ═══ BASE DE CONOCIMIENTO ════════════════════════════════════════════════════
function loadKnowledge(container) {
  var c = container || document.getElementById('adm-body');
  if (!c) return;
  c.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Cargando base de conocimiento...</p>';
  if (!A.workerUrl) { c.innerHTML = '<p>No hay Worker configurado.</p>'; return; }
  authFetch(A.workerUrl + '/knowledge')
    .then(function(r){ return r.json(); })
    .then(function(d){ renderKnowledge(c, d.entries || []); })
    .catch(function(){ c.innerHTML = '<p>Error al cargar.</p>'; });
}

function renderKnowledge(c, entries) {
  // Botón de indexación en la parte superior del panel KB
  var idxStatus = '';
  var html =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding:10px 12px;background:#f0f7ff;border-radius:8px;border:1px solid #c7d9f5">' +
      '<div>' +
        '<div style="font-size:12px;font-weight:700;color:#0057a8">&#128269; Indexación de contenido</div>' +
        '<div style="font-size:11px;color:#555;margin-top:2px">Permite buscar texto dentro de los procedimientos publicados</div>' +
      '</div>' +
      '<button id="btn-index-all" class="pc-btn" style="width:auto;font-size:12px;padding:6px 14px">&#9881; Indexar todo</button>' +
    '</div>' +
    '<div style="margin-bottom:16px">' +
      '<div class="pc-label" style="margin-bottom:6px">Nueva entrada</div>' +
      '<textarea class="pc-input" id="kb-text" rows="4" ' +
        'placeholder="Pega texto de Excel, resumen de conversación, procedimiento interno, patrón de incidente..." ' +
        'style="resize:vertical;font-size:13px;margin-bottom:8px"></textarea>' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<span style="font-size:11px;color:#888">El asistente IA usará este conocimiento al responder preguntas.</span>' +
        '<button class="pc-btn" style="width:auto" id="kb-add-btn">+ Agregar</button>' +
      '</div>' +
    '</div>' +
    '<hr style="border:none;border-top:1px solid #eef1f7;margin:0 0 12px">';

  if (!entries.length) {
    html += '<p style="color:#aaa;text-align:center;padding:20px;font-size:13px">Sin entradas. Usa el campo de arriba para agregar conocimiento operacional.</p>';
  } else {
    html += '<div class="pc-label" style="margin-bottom:8px">' + entries.length + ' entrada' + (entries.length!==1?'s':'') + ' en la base de conocimiento</div>';
    entries.forEach(function(e, i) {
      var txt     = e.content || e.situation || '';
      var entryId = 'kb-entry-' + i;
      var isLong  = txt.length > 300;
      html +=
        '<div style="border:1px solid #eef1f7;border-radius:8px;padding:10px 12px;margin-bottom:8px">' +
          '<div id="' + entryId + '-body" style="font-size:13px;color:#1a1a2e;white-space:pre-wrap;line-height:1.5">' +
            esc(isLong ? txt.slice(0, 300) + '…' : txt) +
          '</div>' +
          (isLong ?
            '<button id="' + entryId + '-toggle" data-full="' + esc(txt) + '" data-short="' + esc(txt.slice(0,300)+'…') + '" data-target="' + entryId + '-body"' +
              ' style="background:none;border:none;color:#0057a8;font-size:12px;cursor:pointer;padding:2px 0;margin-top:4px">Ver más ▼</button>'
          : '') +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">' +
            '<span style="font-size:11px;color:#aaa">&#128100; ' + esc(e.addedBy||'admin') + ' &nbsp;&bull;&nbsp; ' + (e.addedAt||'').slice(0,10) + '</span>' +
            '<button class="pc-btn-sec" style="font-size:11px;padding:2px 8px;color:#c0392b;border-color:#fca5a5" data-kb-del="' + esc(e.id||String(i)) + '">&#128465;</button>' +
          '</div>' +
        '</div>';
    });
  }
  c.innerHTML = html;

  var idxBtn = document.getElementById('btn-index-all');
  if (idxBtn) idxBtn.addEventListener('click', function() {
    idxBtn.disabled = true; idxBtn.textContent = '⏳ Indexando...';
    authFetch(A.workerUrl + '/proc/index-all', { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(d){
        idxBtn.textContent = '✅ ' + (d.indexed||0) + ' SOPs indexados';
        setTimeout(function(){ idxBtn.disabled=false; idxBtn.textContent='✅ Indexar todo'; }, 3000);
        showToast('✅ ' + (d.indexed||0) + ' procedimientos indexados para búsqueda');
      }).catch(function(){
        idxBtn.disabled = false; idxBtn.textContent = '❌ Error al indexar';
      });
  });

  var addBtn = document.getElementById('kb-add-btn');
  if (addBtn) addBtn.addEventListener('click', function() {
    var text = ((document.getElementById('kb-text')||{}).value||'').trim();
    if (!text) return;
    addBtn.disabled = true; addBtn.textContent = 'Guardando...';
    authFetch(A.workerUrl + '/knowledge', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ content: text }),
    }).then(function(r){ return r.json(); })
      .then(function(d) {
        if (d.error) throw new Error(d.error);
        showToast('\u2705 Entrada guardada');
        loadKnowledge(c);
      })
      .catch(function(err) {
        showToast('Error: ' + (err.message||'desconocido'));
        addBtn.disabled = false; addBtn.textContent = '+ Agregar';
      });
  });

  // Listeners de expandir/colapsar
  c.querySelectorAll('[data-target]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target  = document.getElementById(btn.dataset.target);
      var expanded = btn.dataset.expanded === '1';
      if (expanded) {
        target.textContent = btn.dataset.short;
        btn.textContent    = 'Ver más ▼';
        btn.dataset.expanded = '0';
      } else {
        target.textContent = btn.dataset.full;
        btn.textContent    = 'Ver menos ▲';
        btn.dataset.expanded = '1';
      }
    });
  });

  c.querySelectorAll('[data-kb-del]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = btn.dataset.kbDel;
      if (!confirm('\u00bfEliminar esta entrada de conocimiento?')) return;
      authFetch(A.workerUrl + '/knowledge/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(function() { showToast('Entrada eliminada'); loadKnowledge(c); })
        .catch(function() { showToast('Error al eliminar'); });
    });
  });
}

// ═══ SUBIR SOP CUSTOM ════════════════════════════════════════════════════════
var uploadedHtml = '';
var uploadedFile = '';

function openUploadModal() {
  var ov = document.createElement('div');
  ov.id = 'upl-overlay';
  ov.className = 'mda-modal-overlay open';
  ov.innerHTML =
    '<div class="mda-modal-box" style="max-width:520px">' +
      '<div class="mda-modal-hdr"><strong>&#11014;&#65039; Subir Procedimiento</strong>' +
        '<button class="mda-modal-close" id="upl-close">&#215;</button></div>' +
      '<div class="mda-modal-body" style="display:flex;flex-direction:column;gap:12px">' +
        '<div class="upl-drop" id="upl-drop"><div style="font-size:32px">&#128196;</div><p>Arrastra un archivo .html aqu\u00ed o haz clic para seleccionar</p><input type="file" id="upl-file" accept=".html" style="display:none"></div>' +
        '<div><div class="pc-label">ID del SOP</div><input class="pc-input" id="upl-sopid" placeholder="SOP-APP-009"></div>' +
        '<div><div class="pc-label">T\u00edtulo del procedimiento</div><input class="pc-input" id="upl-titulo" placeholder="Ej: Reseteo de contrase\u00f1a SAP"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div><div class="pc-label">Nivel de resoluci\u00f3n</div><input class="pc-input" id="upl-nivel" placeholder="Nivel 1"></div>' +
          '<div><div class="pc-label">Criticidad</div><select class="pc-select" id="upl-crit"><option>MEDIO</option><option>ALTO</option><option>CR\u00cdTICO</option></select></div>' +
        '</div>' +
        '<div><div class="pc-label">Grupo Responsable</div><input class="pc-input" id="upl-grupo" placeholder="Help_Desk_Support_Chile_Tech"></div>' +
        '<div><div class="pc-label">Faenas aplicables</div><input class="pc-input" id="upl-faenas" placeholder="MVE, MBL, STG, VAN"></div>' +
        '<div><div class="pc-label">Dom\u00ednio</div><select class="pc-select" id="upl-dom">' +
          (window.DOMS||[{"cod":"GIA"},{"cod":"SAP"},{"cod":"APP"},{"cod":"EQU"},{"cod":"NET"},{"cod":"MIN"},{"cod":"VHF"},{"cod":"COL"},{"cod":"CYB"},{"cod":"SOT"},{"cod":"INF"},{"cod":"INC"}]).map(function(d){return '<option value="'+d.cod+'">'+d.cod+'</option>';}).join('') +
        '</select></div>' +
        '<div id="upl-error" style="color:#c0392b;font-size:12px;display:none"></div>' +
      '</div>' +
      '<div id="upl-progress" style="display:none;padding:8px 20px;font-size:12px;color:#555;border-top:1px solid #eef1f7"></div>' +
      '<div style="padding:14px 20px;border-top:1px solid #eef1f7;display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="pc-btn-sec" id="upl-cancel">Cancelar</button>' +
        '<button class="pc-btn" style="width:auto;min-width:120px" id="upl-submit">&#11014;&#65039; Subir</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
  document.getElementById('upl-close').addEventListener('click',  function(){ ov.remove(); });
  document.getElementById('upl-cancel').addEventListener('click', function(){ ov.remove(); });

  var drop = document.getElementById('upl-drop');
  var fileInput = document.getElementById('upl-file');
  drop.addEventListener('click', function(){ fileInput.click(); });
  drop.addEventListener('dragover', function(e){ e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', function(){ drop.classList.remove('drag'); });
  drop.addEventListener('drop', function(e){
    e.preventDefault(); drop.classList.remove('drag');
    if (e.dataTransfer.files[0]) handleUplFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function(){ if(fileInput.files[0]) handleUplFile(fileInput.files[0]); });

  document.getElementById('upl-submit').addEventListener('click', submitUpload);
}

function handleUplFile(file) {
  uploadedFile = file.name;
  var reader = new FileReader();
  reader.onload = function(e) {
    uploadedHtml = e.target.result;
    // Auto-detectar datos del SOP desde el HTML
    var sopMatch   = uploadedHtml.match(/class="sop-id"[^>]*>([^<]+)</);
    var titleMatch = uploadedHtml.match(/<title>([^<]+)<\/title>/);
    var domMatch   = uploadedHtml.match(/SOP-([A-Z]+)-/);
    var nivelMatch = uploadedHtml.match(/<strong>Nivel<\/strong>([^<]+)<\/div>/) ||
                     uploadedHtml.match(/info-label[^>]*>Nivel<\/span>[^<]*<span[^>]*>([^<]+)/);
    var grupoMatch = uploadedHtml.match(/<strong>Grupo<\/strong>([^<]+)<\/div>/) ||
                     uploadedHtml.match(/Grupo Responsable<\/span>[^<]*<span[^>]*>([^<]+)<\/span>/);
    var faenasMatch= uploadedHtml.match(/class="meta-chip"><strong>Faena<\/strong>([^<]+)<\/div>/);
    if (sopMatch)    { var id = sopMatch[1].trim().replace(/[^\w-]/g,'').replace(/^[^S]*/,''); document.getElementById('upl-sopid').value = id; }
    if (domMatch)    { var sel=document.getElementById('upl-dom'); for(var i=0;i<sel.options.length;i++) if(sel.options[i].value===domMatch[1]){sel.selectedIndex=i;break;} }
    if (titleMatch)  { document.getElementById('upl-titulo').value = titleMatch[1].replace(/SOP-[A-Z]+-\d+\s*[^\w]*/,'').trim(); }
    if (nivelMatch)  document.getElementById('upl-nivel').value  = nivelMatch[1].trim();
    if (grupoMatch)  document.getElementById('upl-grupo').value  = grupoMatch[1].trim().replace(/<[^>]+>/g,'');
    if (faenasMatch) document.getElementById('upl-faenas').value = faenasMatch[1].trim();
    document.getElementById('upl-drop').innerHTML = '<p style="color:#0057a8;font-weight:700">&#9989; ' + esc(file.name) + '</p>';
  };
  reader.readAsText(file);
}

function submitUpload() {
  var errEl  = document.getElementById('upl-error');
  var btnSub = document.getElementById('upl-submit');
  var progEl = document.getElementById('upl-progress');

  var sopId  = (document.getElementById('upl-sopid').value  || '').trim().toUpperCase();
  var titulo = (document.getElementById('upl-titulo').value || '').trim();
  var dom    = document.getElementById('upl-dom').value;
  var faenas = (document.getElementById('upl-faenas').value || '').trim() || 'MVE,MBL,STG,VAN';
  var crit   = document.getElementById('upl-crit').value;
  var nivel  = (document.getElementById('upl-nivel') ? document.getElementById('upl-nivel').value : '').trim() || 'Nivel 1';
  var grupo  = (document.getElementById('upl-grupo') ? document.getElementById('upl-grupo').value : '').trim();

  function showErr(msg) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    if (progEl) progEl.style.display = 'none';
    if (btnSub) { btnSub.disabled = false; btnSub.innerHTML = '&#11014;&#65039; Subir'; }
  }
  function setStep(msg) {
    if (progEl) { progEl.style.display='block'; progEl.innerHTML = '\u23f3 '+msg; }
  }

  // Validaciones
  if (!A.workerUrl || !A.session) { showErr('Sin sesi\u00f3n. Cierra sesi\u00f3n y vuelve a entrar.'); return; }
  if (!uploadedHtml || uploadedHtml.length < 10) { showErr('Selecciona un archivo HTML.'); return; }
  if (!sopId)   { showErr('ID del SOP requerido.'); return; }
  if (!titulo)  { showErr('T\u00edtulo requerido.');  return; }

  if (errEl) errEl.style.display = 'none';
  if (btnSub) { btnSub.disabled = true; btnSub.innerHTML = '\u23f3 Subiendo...'; }
  setStep('Enviando al servidor...');

  authFetch(A.workerUrl + '/sop/upload', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ html: uploadedHtml, meta: { sopId:sopId, titulo:titulo, dom:dom, faenas:faenas, criticidad:crit, nivel:nivel, grupo:grupo } }),
  })
  .then(function(r) { return r.json().then(function(d){ return {status:r.status, ok:r.ok, d:d}; }); })
  .then(function(res) {
    if (!res.ok || res.d.error) { showErr('Error ' + res.status + ': ' + (res.d.error||'Desconocido')); return; }

    // \u00c9xito: limpiar y recargar el cat\u00e1logo
    uploadedHtml = '';
    uploadedFile = '';
    var ov = document.getElementById('upl-overlay');
    if (ov) ov.remove();

    setStep('\u2705 Publicado. Recargando cat\u00e1logo...');
    showToast('\u2705 ' + sopId + ' publicado. Recargando...');

    // Recargar el catálogo para mostrar el SOP recién publicado
    setTimeout(function() {
      var b = typeof base === 'function' ? base() : '';
      var p = window.location.pathname;
      if (p.indexOf('Catalogo') >= 0 || p === '/' || p.endsWith('/')) {
        window.location.reload();
      } else {
        window.location.href = b + 'Catalogo_Servicios_MDA_Capstone.html';
      }
    }, 1200);
  })
  .catch(function(err) {
    showErr('Error de red: ' + (err && err.message ? err.message : 'Sin conexi\u00f3n'));
  });
}


// ═══ CHAT IA CATALOGO ════════════════════════════════════════════════════════
function buildCatalogAIChat() {
  if (A.isSOP) return;
  if (document.getElementById('cat-ai-btn')) return;
  if (!A.workerUrl) return;
  // Bot flotante minimalista
  var btn = document.createElement('button');
  btn.id = 'cat-ai-btn';
  btn.innerHTML = '&#10024;';
  btn.title = 'Asistente IA del Cat\u00e1logo';
  btn.style.cssText = 'position:fixed;bottom:24px;right:24px;width:70px;height:70px;border-radius:50%;background:linear-gradient(135deg,#0057a8,#7b2d8b);color:#fff;border:none;cursor:pointer;font-size:31px;box-shadow:0 4px 20px rgba(0,0,0,.3);z-index:8000;transition:transform .15s;';
  btn.onclick = function(){ openCatalogChat(); };
  document.body.appendChild(btn);
}

function openCatalogChat() {
  if (document.getElementById('cat-ai-panel')) { document.getElementById('cat-ai-panel').remove(); return; }
  var panel = document.createElement('div');
  panel.id = 'cat-ai-panel';
  panel.style.cssText = 'position:fixed;bottom:108px;right:24px;width:340px;max-height:440px;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.2);z-index:8001;display:flex;flex-direction:column;overflow:hidden;font-family:\'Barlow\',sans-serif;';
  panel.innerHTML = '<div style="background:linear-gradient(135deg,#0057a8,#7b2d8b);color:#fff;padding:12px 16px;font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:center">&#10024; Asistente MDA<button onclick="document.getElementById(\'cat-ai-panel\').remove()" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1">&#215;</button></div>' +
    '<div id="cat-ai-msgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px">' +
    '<div style="background:#f0f7ff;border-radius:10px;padding:10px;font-size:13px;color:#1a1a2e">Hola, soy el asistente del cat\u00e1logo MDA. Puedo ayudarte a encontrar procedimientos o responder preguntas operacionales.</div></div>' +
    '<div style="padding:8px 12px;border-top:1px solid #eef1f7;display:flex;gap:8px">' +
    '<input id="cat-ai-input" style="flex:1;border:1.5px solid #d0d8e8;border-radius:8px;padding:8px 10px;font-size:13px;font-family:\'Barlow\',sans-serif;outline:none" placeholder="Escribe tu pregunta...">' +
    '<button id="cat-ai-send" style="background:#0057a8;color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:16px">&#8593;</button></div>';
  document.body.appendChild(panel);
  var input = document.getElementById('cat-ai-input');
  input.focus();

  // Historial de la conversación en formato Anthropic Messages API
  var chatHistory = [];

  var SYSTEM_PROMPT = 'Eres el asistente del Cat\u00e1logo de Procedimientos de la Mesa de Ayuda (MDA) de Capstone Copper Chile. ' +
    'Ayudas a los agentes a encontrar el procedimiento correcto, explicas pasos de SOPs, y respondes preguntas operacionales sobre la mesa de ayuda. ' +
    'S\u00e9 conciso y directo. Si no sabes algo espec\u00edfico del cliente, dilo claramente en vez de inventar.';

  function sendMsg() {
    var q = input.value.trim(); if (!q) return;
    input.value = '';
    var msgs = document.getElementById('cat-ai-msgs');
    msgs.innerHTML += '<div style="background:#0057a8;color:#fff;border-radius:10px;padding:8px 12px;font-size:13px;align-self:flex-end;max-width:80%">' + esc(q) + '</div>';
    msgs.innerHTML += '<div id="cat-ai-thinking" style="background:#f0f7ff;border-radius:10px;padding:8px 12px;font-size:13px;color:#888">\u23f3 Pensando...</div>';
    msgs.scrollTop = msgs.scrollHeight;

    chatHistory.push({ role: 'user', content: q });

    authFetch(A.workerUrl + '/chat', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ system: SYSTEM_PROMPT, messages: chatHistory, sopId: A.sopId || '' }),
    })
    .then(function(r) { return r.json().then(function(d){ return {ok:r.ok, status:r.status, d:d}; }); })
    .then(function(res) {
      var th = document.getElementById('cat-ai-thinking');
      if (th) th.remove();
      if (!res.ok || res.d.error) {
        msgs.innerHTML += '<div style="background:#fde8e8;color:#c0392b;border-radius:10px;padding:8px 12px;font-size:13px;max-width:90%">Error: ' + esc(res.d.error || ('HTTP '+res.status)) + '</div>';
        chatHistory.pop(); // no guardar el turno fallido
        msgs.scrollTop = msgs.scrollHeight;
        return;
      }
      var reply = res.d.response || 'Sin respuesta.';
      chatHistory.push({ role: 'assistant', content: reply });
      msgs.innerHTML += '<div style="background:#f0f7ff;border-radius:10px;padding:8px 12px;font-size:13px;color:#1a1a2e;max-width:90%;white-space:pre-wrap">' + esc(reply) + '</div>';
      msgs.scrollTop = msgs.scrollHeight;
    })
    .catch(function() {
      var th = document.getElementById('cat-ai-thinking');
      if (th) th.textContent = '\u274c Error al conectar.';
      chatHistory.pop();
    });
  }
  document.getElementById('cat-ai-send').addEventListener('click', sendMsg);
  input.addEventListener('keydown', function(e){ if(e.key==='Enter') sendMsg(); });
}

// ═══ DESCARGA DE PROCEDIMIENTOS (admin) ═════════════════════════════════════
function downloadSOP(sopId, isCustom) {
  if (isCustom) {
    // SOPs custom: obtener HTML desde el Worker y disparar descarga
    if (!A.workerUrl) return;
    showToast('\u23f3 Preparando descarga...');
    authFetch(A.workerUrl + '/sop/' + encodeURIComponent(sopId))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (!d.html) { showToast('\u274c No se pudo obtener el HTML'); return; }
        // Aplicar contenido editado si existe
        var html = d.html;
        if (d.editedContent) {
          var parser = new DOMParser();
          var doc    = parser.parseFromString(html, 'text/html');
          var cont   = doc.querySelector('.container');
          if (cont) cont.innerHTML = d.editedContent;
          html = doc.documentElement.outerHTML;
        }
        triggerDownload(sopId + '.html', html);
      }).catch(function(){ showToast('\u274c Error al descargar'); });
  } else {
    // SOPs estáticos: están en /procedimientos/SOP-XXX.html en Pages
    var base2 = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');
    var url    = base2 + 'procedimientos/' + sopId + '.html';
    // Fetch para asegurar que existe y generar descarga
    fetch(url)
      .then(function(r){
        if (!r.ok) throw new Error('No encontrado');
        return r.text();
      })
      .then(function(html){ triggerDownload(sopId + '.html', html); })
      .catch(function(){ showToast('\u274c No se pudo descargar ' + sopId); });
  }
}

function triggerDownload(filename, content) {
  var blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1000);
  showToast('\u2705 Descargando ' + filename);
}

// ═══ DESCARGA DE SOP ACTUAL (admin) ════════════════════════════════════════
function downloadCurrentSOP() {
  var sopId = A.sopId;
  if (!sopId) return;

  showToast('\u23f3 Preparando descarga...');

  function doDownload(html) {
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = sopId + '.html';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast('\u2705 Descargando ' + sopId + '.html');
  }

  // Obtener el HTML actual de la página (incluye ediciones aplicadas)
  var container = document.querySelector('.container');
  if (container) {
    // Reconstruir HTML completo desde el DOM renderizado
    var clone = document.documentElement.cloneNode(true);
    // Quitar la barra admin y scripts de auth para obtener HTML limpio
    var bar   = clone.querySelector('#sop-admin-bar');     if (bar)   bar.remove();
    var nav   = clone.querySelector('#mda-nav');            if (nav)   nav.remove();
    var toast = clone.querySelector('#mda-toast');          if (toast) toast.remove();
    doDownload('<!DOCTYPE html>\n' + clone.outerHTML);
  } else if (A.workerUrl) {
    // Fallback: descargar desde KV del Worker
    authFetch(A.workerUrl + '/sop/' + encodeURIComponent(sopId))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (!d.html) throw new Error('no html');
        var html = d.html;
        // Aplicar edición si existe
        if (d.editedContent) {
          var parser = new DOMParser();
          var doc    = parser.parseFromString(html, 'text/html');
          var c      = doc.querySelector('.container');
          if (c) c.innerHTML = d.editedContent;
          html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
        }
        doDownload(html);
      })
      .catch(function(){
        // Último fallback: descargar el archivo estático
        fetch('procedimientos/' + sopId + '.html')
          .then(function(r){ if(!r.ok) throw new Error(); return r.text(); })
          .then(function(html){ doDownload(html); })
          .catch(function(){ showToast('\u274c No se pudo obtener el archivo'); });
      });
  }
}

// ═══ API PUBLICA ══════════════════════════════════════════════════════════════
A.openAdminPanel   = openAdminPanel;
A.closeAdminPanel  = closeAdminPanel;
A.logout           = logout;
A.toggleVisibility = toggleVisibility;
A.setAllVisibility = setAllVisibility;
A.openInviteModal  = openInviteModal;
A.openUploadModal  = openUploadModal;
A.showToast        = showToast;
A.authFetch        = authFetch;
A.applyVisibility  = applyVisibility;
A.loadKnowledge    = loadKnowledge;
A.loadProcKeywords = loadProcKeywords;
A.openKeywordModal = openKeywordModal;
A.buildSOPToolbar  = buildSOPToolbar;
A.refreshSOPToolbar= refreshSOPToolbar;
A.deleteSOP        = deleteSOP;
A.downloadSOP      = downloadSOP;
A.changeRole       = changeRole;
A.deleteUser       = deleteUser;

// ═══ ARRANQUE ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  A.workerUrl = (window.CFG && CFG.workerUrl) || localStorage.getItem('mda_worker_url') || '';
  A.session   = localStorage.getItem('mda_session') || '';

  // Detectar si es una página SOP
  var sopEl = document.querySelector('.sop-id');
  if (sopEl) {
    var m = sopEl.textContent.match(/SOP-[A-Z]+-\d+/);
    if (m) { A.sopId = m[0]; A.isSOP = true; }
  }

  injectCSS();
  verifySession();
});

})();
