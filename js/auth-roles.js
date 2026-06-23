/*!
 * auth-roles.js — MDA Playbook v2.2
 * Widget flotante (top-right) · No interfiere con el header existente
 */
(function () {
'use strict';

window.PlaybookAuth = {
  user: null, hiddenProcs: [], workerUrl: '', session: '',
  ready: false, onReady: null,
};
var A = window.PlaybookAuth;

/* ── CSS ──────────────────────────────────────────────────────────────────── */
function injectCSS() {
  var css = [
    /* Widget flotante top-right — no afecta al layout */
    '#auth-widget{position:fixed;top:10px;right:16px;z-index:2000;display:flex;align-items:center;gap:7px}',
    '#auth-widget .aw-avatar{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.5);object-fit:cover;cursor:pointer}',
    '#auth-widget .aw-avatar-fb{width:30px;height:30px;border-radius:50%;background:#ff6b00;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;cursor:pointer;border:2px solid rgba(255,255,255,.5)}',
    '#auth-widget .aw-name{font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6);cursor:default;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#auth-widget .aw-admin-btn{background:#ff6b00;color:#fff;border:none;cursor:pointer;border-radius:20px;padding:5px 12px;font-size:11px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.25);transition:background .12s;white-space:nowrap}',
    '#auth-widget .aw-admin-btn:hover{background:#cc5500}',
    '#auth-widget .aw-logout-btn{background:rgba(0,0,0,.35);color:#fff;border:none;cursor:pointer;border-radius:20px;padding:5px 10px;font-size:11px;font-weight:600;transition:background .12s;white-space:nowrap}',
    '#auth-widget .aw-logout-btn:hover{background:rgba(0,0,0,.55)}',
    /* Admin panel modal */
    '#admin-overlay{position:fixed;inset:0;background:rgba(10,10,30,.6);z-index:3000;display:none;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;backdrop-filter:blur(4px)}',
    '#admin-overlay.open{display:flex}',
    '#admin-panel{background:#fff;border-radius:16px;width:100%;max-width:820px;margin:auto;box-shadow:0 24px 80px rgba(0,0,0,.35);overflow:hidden}',
    '#admin-panel-hdr{background:linear-gradient(135deg,#1a1a2e,#0057a8);color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center}',
    '#admin-panel-hdr h2{font-size:17px;font-weight:800}',
    '#admin-panel-hdr .u-tag{font-size:11px;opacity:.75;margin-top:2px}',
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
    '.u-avatar-fb-sm{width:30px;height:30px;border-radius:50%;background:#0057a8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}',
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
    '.pc-modal-overlay{position:fixed;inset:0;background:rgba(10,10,30,.55);z-index:3100;display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)}',
    '.pc-modal-overlay.open{display:flex}',
    '.pc-modal{background:#fff;border-radius:14px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden}',
    '.pc-modal-hdr{background:linear-gradient(135deg,#0057a8,#003d7a);color:#fff;padding:15px 20px;display:flex;justify-content:space-between;align-items:center}',
    '.pc-modal-hdr strong{font-size:15px}',
    '.pc-modal-x{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;opacity:.8;line-height:1}',
    '.pc-modal-x:hover{opacity:1}',
    '.pc-modal-body{padding:18px 20px;display:flex;flex-direction:column;gap:12px}',
    '.pc-label{font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px}',
    '.pc-input,.pc-select{width:100%;border:1.5px solid #d0d8e8;border-radius:8px;padding:9px 12px;font-size:13px;font-family:inherit;color:#1a1a2e;outline:none;transition:border-color .15s}',
    '.pc-input:focus,.pc-select:focus{border-color:#0057a8;box-shadow:0 0 0 3px rgba(0,87,168,.1)}',
    '.pc-modal-ftr{padding:14px 20px;border-top:1px solid #eef1f7;display:flex;gap:10px;justify-content:flex-end}',
    '.pc-btn-primary{background:#0057a8;color:#fff;border:none;cursor:pointer;border-radius:8px;padding:9px 22px;font-size:13px;font-weight:700;transition:background .15s}',
    '.pc-btn-primary:hover{background:#003d7a}',
    '.pc-btn-secondary{background:#f0f3f8;color:#555;border:1.5px solid #d0d8e8;cursor:pointer;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600}',
    '.pc-btn-secondary:hover{background:#e8ecf3}',
    '.pc-error{background:#fde8e8;color:#c0392b;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;display:none}',
    '.ap-note{background:#e8f0fb;border-radius:8px;padding:10px 12px;font-size:12px;color:#0057a8;line-height:1.5}',
    '.ap-btn{background:#0057a8;color:#fff;border:none;cursor:pointer;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;transition:background .15s}',
    '.ap-btn:hover{background:#003d7a}',
    '.ap-btn.green{background:#1a6b3a}.ap-btn.green:hover{background:#0d3d20}',
    '.ap-btn.red{background:#c0392b}.ap-btn.red:hover{background:#922b21}',
    '#ar-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);background:#1a1a2e;color:#fff;padding:9px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;opacity:0;transition:all .3s;pointer-events:none;white-space:nowrap}',
  ].join('');
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
}

/* ── BOOT ─────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  A.workerUrl = (window.CFG && window.CFG.workerUrl) || localStorage.getItem('mda_worker_url') || 'https://playbook-mda-capstone.relizondo-0d3.workers.dev';
  A.session   = localStorage.getItem('mda_session') || '';

  var urlParams = new URLSearchParams(window.location.search);
  var fromUrl   = urlParams.get('session');
  if (fromUrl) {
    A.session = fromUrl;
    localStorage.setItem('mda_session', fromUrl);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  injectCSS();

  if (!A.session) { redirectToLogin(); return; }
  verifySession();
});

/* ── SESSION ──────────────────────────────────────────────────────────────── */
function verifySession() {
  if (!A.workerUrl) {
    A.user = { email: 'demo@capstonecopper.com', name: 'Demo', role: 'admin' };
    finishBoot();
    return;
  }
  fetch(A.workerUrl + '/auth/me', { headers: { 'Authorization': 'Bearer ' + A.session } })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.authenticated) { redirectToLogin(); return; }
      A.user = { email: d.email, name: d.name, picture: d.picture, role: d.role };
      finishBoot();
    })
    .catch(function () {
      A.user = { email: 'local', name: 'Sin conexión', role: 'agent' };
      finishBoot();
    });
}

function finishBoot() {
  A.ready = true;
  buildWidget();
  loadVisibility();
  if (A.onReady) A.onReady(A.user);
}

function redirectToLogin() {
  if (!window.location.pathname.includes('/login'))
    window.location.href = '/login';
}

/* ── WIDGET FLOTANTE ──────────────────────────────────────────────────────── */
function buildWidget() {
  var existing = document.getElementById('auth-widget');
  if (existing) existing.remove();

  var isAdmin = A.user && A.user.role === 'admin';
  var avatar  = A.user.picture
    ? '<img class="aw-avatar" src="' + esc(A.user.picture) + '" alt="' + esc(A.user.name) + '">'
    : '<div class="aw-avatar-fb">' + (A.user.name || 'U')[0].toUpperCase() + '</div>';

  var w = document.createElement('div');
  w.id  = 'auth-widget';
  w.innerHTML =
    (isAdmin ? '<button class="aw-admin-btn" id="aw-admin-btn">\u2699\ufe0f Admin</button>' : '') +
    '<span class="aw-name">' + esc((A.user.name || '').split(' ')[0]) + '</span>' +
    avatar +
    '<button class="aw-logout-btn" id="aw-logout-btn">Salir</button>';

  document.body.appendChild(w);

  document.getElementById('aw-logout-btn').addEventListener('click', logout);
  if (isAdmin) {
    document.getElementById('aw-admin-btn').addEventListener('click', openAdminPanel);
  }
}

/* ── VISIBILIDAD ──────────────────────────────────────────────────────────── */
function loadVisibility() {
  if (!A.workerUrl) return;
  fetch(A.workerUrl + '/admin/visibility', { headers: { 'Authorization': 'Bearer ' + A.session } })
    .then(function (r) { return r.json(); })
    .then(function (d) { A.hiddenProcs = d.hidden || []; applyVisibility(); })
    .catch(function () {});
}

function applyVisibility() {
  var isAdmin = A.user && A.user.role === 'admin';
  document.querySelectorAll('.proc-row[data-sop]').forEach(function (row) {
    var hidden = A.hiddenProcs.includes(row.dataset.sop);
    if      (hidden && !isAdmin) { row.style.display = 'none'; }
    else if (hidden &&  isAdmin) { row.style.opacity = '.5'; row.style.fontStyle = 'italic'; }
    else                         { row.style.display = ''; row.style.opacity = ''; row.style.fontStyle = ''; }
  });
}

/* ── ADMIN PANEL ──────────────────────────────────────────────────────────── */
function openAdminPanel() {
  var existing = document.getElementById('admin-overlay');
  if (existing) { existing.classList.add('open'); loadRoles(); loadVisibilityAdmin(); return; }

  var o = document.createElement('div');
  o.id  = 'admin-overlay';
  o.innerHTML = [
    '<div id="admin-panel">',
    '<div id="admin-panel-hdr">',
    '<div><h2>\u2699\ufe0f Panel de Administraci\u00f3n</h2>',
    '<div class="u-tag">' + esc(A.user.email) + ' &middot; Admin</div></div>',
    '<button class="adm-x" id="adm-close-btn">\u00d7</button>',
    '</div>',
    '<div class="adm-tabs">',
    '<div class="adm-tab active" data-tab="users">\ud83d\udc65 Usuarios y Roles</div>',
    '<div class="adm-tab" data-tab="vis">\ud83d\udc41 Visibilidad de Procedimientos</div>',
    '</div>',
    '<div class="adm-body active" id="adm-tab-users"><div id="users-container">Cargando...</div></div>',
    '<div class="adm-body" id="adm-tab-vis"><div id="vis-container">Cargando...</div></div>',
    '</div>',
  ].join('');

  o.addEventListener('click', function (e) { if (e.target === o) closeAdminPanel(); });
  document.body.appendChild(o);
  o.classList.add('open');

  document.getElementById('adm-close-btn').addEventListener('click', closeAdminPanel);
  document.querySelectorAll('.adm-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.adm-tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.adm-body').forEach(function (b) { b.classList.remove('active'); });
      tab.classList.add('active');
      document.getElementById('adm-tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  loadRoles();
  loadVisibilityAdmin();
}

function closeAdminPanel() {
  var o = document.getElementById('admin-overlay');
  if (o) o.classList.remove('open');
}

/* ── TAB USUARIOS ─────────────────────────────────────────────────────────── */
function loadRoles() {
  var c = document.getElementById('users-container');
  if (!c) return;
  if (!A.workerUrl) { c.innerHTML = '<p style="color:#aaa;font-size:13px">Worker no configurado.</p>'; return; }

  fetch(A.workerUrl + '/admin/users', { headers: { 'Authorization': 'Bearer ' + A.session } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var users  = data.users || {};
      var emails = Object.keys(users);

      var html = '<div style="margin-bottom:14px;display:flex;align-items:center;gap:10px">' +
        '<button class="ap-btn" id="btn-invite">+ Agregar usuario</button>' +
        '<span style="font-size:11px;color:#888">Agrega el correo ANTES de que el usuario intente ingresar.</span>' +
        '</div>';

      if (emails.length === 0) {
        html += '<p style="color:#aaa;font-size:13px">Sin usuarios a\u00fan.</p>';
      } else {
        html += '<table class="u-table"><thead><tr><th></th><th>Usuario</th><th>Rol</th><th>\u00daltimo acceso</th><th></th></tr></thead><tbody>';
        emails.forEach(function (email) {
          var u      = users[email];
          var pend   = u.status === 'invited';
          var avatar = u.picture
            ? '<img class="u-avatar-sm" src="' + esc(u.picture) + '" alt="">'
            : '<div class="u-avatar-fb-sm">' + (u.name || email)[0].toUpperCase() + '</div>';
          var badge  = pend
            ? '<span class="status-badge status-invited">PENDIENTE</span>'
            : '<span class="status-badge status-active">ACTIVO</span>';
          var last   = u.lastLogin
            ? new Date(u.lastLogin).toLocaleDateString('es-CL')
            : (pend ? 'A\u00fan no ha entrado' : '\u2014');
          var delBtn = email !== A.user.email
            ? '<button class="btn-del" data-email="' + esc(email) + '">\u00d7 Quitar</button>'
            : '<small style="color:#aaa">(t\u00fa)</small>';

          html += '<tr><td>' + avatar + '</td>' +
            '<td><strong>' + esc(u.name || email) + '</strong>' + badge +
            '<br><span style="font-size:11px;color:#888">' + esc(email) + '</span></td>' +
            '<td><select class="role-sel" data-email="' + esc(email) + '">' +
            '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '<option value="agent"' + (u.role === 'agent' ? ' selected' : '') + '>Agente</option>' +
            '</select></td>' +
            '<td><small style="color:#aaa">' + last + '</small></td>' +
            '<td>' + delBtn + '</td></tr>';
        });
        html += '</tbody></table>';
      }

      c.innerHTML = html;
      document.getElementById('btn-invite').addEventListener('click', openInviteModal);
      c.querySelectorAll('.role-sel').forEach(function (sel) {
        sel.addEventListener('change', function () { changeRole(sel.dataset.email, sel.value); });
      });
      c.querySelectorAll('.btn-del').forEach(function (btn) {
        btn.addEventListener('click', function () { deleteUser(btn.dataset.email); });
      });
    })
    .catch(function () { c.innerHTML = '<p style="color:#c0392b">Error al cargar usuarios.</p>'; });
}

function changeRole(email, role) {
  fetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + A.session, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: role }),
  }).then(function () { showToast('\u2705 Rol actualizado'); })
    .catch(function () { showToast('\u274c Error', true); });
}

function deleteUser(email) {
  if (!confirm('\u00bfQuitar acceso a ' + email + '?')) return;
  fetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + A.session },
  }).then(function () { loadRoles(); showToast('\u2705 Acceso eliminado'); })
    .catch(function () { showToast('\u274c Error', true); });
}

/* ── MODAL INVITAR ────────────────────────────────────────────────────────── */
function openInviteModal() {
  var ex = document.getElementById('inv-overlay');
  if (ex) ex.remove();

  var o = document.createElement('div');
  o.id  = 'inv-overlay';
  o.className = 'pc-modal-overlay open';
  o.innerHTML = [
    '<div class="pc-modal">',
    '<div class="pc-modal-hdr"><strong>+ Dar acceso a usuario</strong>',
    '<button class="pc-modal-x" id="inv-x">\u00d7</button></div>',
    '<div class="pc-modal-body">',
    '<div class="ap-note">El usuario se autentica con su propia cuenta Google. T\u00fa nunca ves su contrase\u00f1a.</div>',
    '<div><div class="pc-label">Correo del usuario</div>',
    '<input class="pc-input" type="email" id="inv-email" placeholder="jorge.palma@tres60.cl"></div>',
    '<div><div class="pc-label">Nombre (opcional)</div>',
    '<input class="pc-input" type="text" id="inv-name" placeholder="Jorge Palma"></div>',
    '<div><div class="pc-label">Rol</div>',
    '<select class="pc-select" id="inv-role">',
    '<option value="agent" selected>Agente \u2014 solo lectura</option>',
    '<option value="admin">Admin \u2014 acceso total</option>',
    '</select></div>',
    '<div class="pc-error" id="inv-err"></div>',
    '</div>',
    '<div class="pc-modal-ftr">',
    '<button class="pc-btn-secondary" id="inv-cancel">Cancelar</button>',
    '<button class="pc-btn-primary" id="inv-ok">Dar acceso</button>',
    '</div></div>',
  ].join('');

  document.body.appendChild(o);
  o.addEventListener('click', function (e) { if (e.target === o) o.remove(); });
  document.getElementById('inv-x').addEventListener('click', function () { o.remove(); });
  document.getElementById('inv-cancel').addEventListener('click', function () { o.remove(); });
  document.getElementById('inv-ok').addEventListener('click', confirmInvite);
  setTimeout(function () { var el = document.getElementById('inv-email'); if (el) el.focus(); }, 80);
}

function confirmInvite() {
  var email = (document.getElementById('inv-email').value || '').trim().toLowerCase();
  var name  = (document.getElementById('inv-name').value  || '').trim();
  var role  =  document.getElementById('inv-role').value;
  var errEl =  document.getElementById('inv-err');

  if (!email || !email.includes('@')) {
    errEl.textContent = 'Ingresa un correo v\u00e1lido.';
    errEl.style.display = 'block'; return;
  }

  fetch(A.workerUrl + '/admin/users', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + A.session, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, name: name, role: role }),
  })
  .then(function (r) { return r.json(); })
  .then(function (d) {
    if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
    document.getElementById('inv-overlay').remove();
    showToast('\u2705 Acceso concedido a ' + email);
    loadRoles();
  })
  .catch(function () { errEl.textContent = 'Error al guardar.'; errEl.style.display = 'block'; });
}

/* ── TAB VISIBILIDAD ──────────────────────────────────────────────────────── */
function loadVisibilityAdmin() {
  var c = document.getElementById('vis-container');
  if (!c) return;

  var procs = (window.PROCS || []).map(function (p) {
    return { sop: p.sop, titulo: p.titulo, dom: p.dom };
  });

  if (procs.length === 0) {
    c.innerHTML = '<p style="color:#aaa;font-size:13px">Este panel est\u00e1 disponible en el Cat\u00e1logo principal.</p>';
    return;
  }

  var vis   = procs.filter(function (p) { return !A.hiddenProcs.includes(p.sop); }).length;
  var total = procs.length;
  var pct   = Math.round(vis / total * 100);

  var domNames = {
    GIA:'\uD83D\uDD11 Identidad', SAP:'\u2699\uFE0F SAP', APP:'\uD83D\uDCBC Aplicaciones',
    EQU:'\uD83D\uDCBB Equipos', NET:'\uD83C\uDF10 Red', MIN:'\uD83C\uDFED Operaciones',
    VHF:'\uD83D\uDCFB VHF', COL:'\uD83D\uDCAC Colaboraci\u00f3n',
    CYB:'\uD83D\uDEF1 Ciberseguridad', SOT:'\uD83D\uDD27 Soporte'
  };

  var dominios = {};
  procs.forEach(function (p) {
    if (!dominios[p.dom]) dominios[p.dom] = [];
    dominios[p.dom].push(p);
  });

  var html = [
    '<div style="margin-bottom:16px">',
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
    '<strong style="font-size:13px">' + vis + ' de ' + total + ' procedimientos visibles</strong>',
    '<div style="display:flex;gap:8px">',
    '<button class="ap-btn green" id="btn-show-all">\uD83D\uDC41 Mostrar todos</button>',
    '<button class="ap-btn red" id="btn-hide-all">\uD83D\uDE48 Ocultar todos</button>',
    '</div></div>',
    '<div class="vis-prog-wrap"><div class="vis-prog-bar" style="width:' + pct + '%"></div></div>',
    '<div style="font-size:11px;color:#888">' + pct + '% visible para los agentes</div>',
    '</div>',
  ].join('');

  Object.keys(dominios).forEach(function (dom) {
    var dp     = dominios[dom];
    var dv     = dp.filter(function (p) { return !A.hiddenProcs.includes(p.sop); }).length;
    var domId  = 'vd-' + dom;

    html += '<div style="margin-bottom:10px">';
    html += '<div class="vis-dom-hdr" data-target="' + domId + '">';
    html += '<span style="font-size:13px;font-weight:700">' + (domNames[dom] || dom) + '</span>';
    html += '<span style="font-size:11px;color:#888">' + dv + '/' + dp.length + ' visibles \u25bc</span>';
    html += '</div>';
    html += '<div id="' + domId + '" style="border:1px solid #eef1f7;border-top:none;border-radius:0 0 8px 8px">';

    dp.forEach(function (p) {
      var hidden = A.hiddenProcs.includes(p.sop);
      html += '<div class="vis-item' + (hidden ? ' is-hidden' : '') + '">';
      html += '<div>';
      html += '<div style="font-family:monospace;font-size:11px;font-weight:700;color:#0057a8">' +
        esc(p.sop) + (hidden ? '<span class="hidden-badge">OCULTO</span>' : '') + '</div>';
      html += '<div style="font-size:12px;color:#555">' + esc(p.titulo) + '</div>';
      html += '</div>';
      html += '<button class="vis-toggle" data-sop="' + esc(p.sop) + '">' +
        (hidden ? '\uD83D\uDE48' : '\uD83D\uDC41') + '</button>';
      html += '</div>';
    });
    html += '</div></div>';
  });

  c.innerHTML = html;

  document.getElementById('btn-show-all').addEventListener('click', function () { setAllVisibility(true); });
  document.getElementById('btn-hide-all').addEventListener('click', function () { setAllVisibility(false); });
  c.querySelectorAll('.vis-dom-hdr').forEach(function (hdr) {
    hdr.addEventListener('click', function () {
      var t = document.getElementById(hdr.dataset.target);
      if (t) t.style.display = t.style.display === 'none' ? '' : 'none';
    });
  });
  c.querySelectorAll('.vis-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () { toggleVisibility(btn.dataset.sop); });
  });
}

function toggleVisibility(sopId) {
  var idx = A.hiddenProcs.indexOf(sopId);
  if (idx >= 0) A.hiddenProcs.splice(idx, 1);
  else          A.hiddenProcs.push(sopId);
  syncVisibility();
  loadVisibilityAdmin();
  applyVisibility();
  showToast(A.hiddenProcs.includes(sopId) ? '\uD83D\uDE48 Oculto' : '\uD83D\uDC41 Visible');
}

function setAllVisibility(visible) {
  var procs = (window.PROCS || []).map(function (p) { return p.sop; });
  if (procs.length === 0) { showToast('Abre el Cat\u00e1logo para usar esta funci\u00f3n.', true); return; }
  if (!confirm(visible ? '\u00bfHacer VISIBLES todos los procedimientos?' : '\u00bfOCULTAR todos los procedimientos?')) return;
  A.hiddenProcs = visible ? [] : procs.slice();
  syncVisibility();
  loadVisibilityAdmin();
  applyVisibility();
  showToast(visible ? '\uD83D\uDC41 Todos visibles' : '\uD83D\uDE48 Todos ocultos');
}

function syncVisibility() {
  if (!A.workerUrl) return;
  fetch(A.workerUrl + '/admin/visibility', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + A.session, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden: A.hiddenProcs }),
  }).catch(function () {});
}

/* ── LOGOUT ───────────────────────────────────────────────────────────────── */
function logout() {
  if (!confirm('\u00bfCerrar sesi\u00f3n?')) return;
  localStorage.removeItem('mda_session');
  if (A.workerUrl) {
    fetch(A.workerUrl + '/auth/logout', { headers: { 'Authorization': 'Bearer ' + A.session } })
      .finally(function () { window.location.href = '/login'; });
  } else {
    window.location.href = '/login';
  }
}

/* ── TOAST ────────────────────────────────────────────────────────────────── */
function showToast(msg, isError) {
  var t = document.getElementById('ar-toast');
  if (!t) { t = document.createElement('div'); t.id = 'ar-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.background = isError ? '#c0392b' : '#1a1a2e';
  t.style.opacity    = '1';
  t.style.transform  = 'translateX(-50%) translateY(0)';
  clearTimeout(t._to);
  t._to = setTimeout(function () {
    t.style.opacity   = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
  }, 3000);
}

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── API PÚBLICA ──────────────────────────────────────────────────────────── */
A.openAdminPanel   = openAdminPanel;
A.closeAdminPanel  = closeAdminPanel;
A.logout           = logout;
A.toggleVisibility = toggleVisibility;
A.setAllVisibility = setAllVisibility;
A.openInviteModal  = openInviteModal;
A.showToast        = showToast;

})();
