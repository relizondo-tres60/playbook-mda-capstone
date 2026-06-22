/*!
 * auth-roles.js — MDA Playbook v2.1
 * Autenticación · Roles · Panel Admin · Visibilidad de procedimientos
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
    '#auth-bar{position:fixed;top:0;left:0;right:0;height:40px;background:#1a1a2e;display:flex;align-items:center;padding:0 16px;gap:12px;z-index:999;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
    '#auth-bar .ab-brand{color:rgba(255,255,255,.5);font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}',
    '#auth-bar .ab-spacer{flex:1}',
    '#auth-bar .ab-user{display:flex;align-items:center;gap:8px;color:#fff}',
    '#auth-bar .ab-avatar{width:26px;height:26px;border-radius:50%;border:2px solid rgba(255,255,255,.3);object-fit:cover}',
    '#auth-bar .ab-avatar-fb{width:26px;height:26px;border-radius:50%;background:#0057a8;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0}',
    '#auth-bar .ab-name{font-size:12px;font-weight:600}',
    '#auth-bar .ab-role{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700}',
    '#auth-bar .role-admin{background:#ff6b00;color:#fff}',
    '#auth-bar .role-agent{background:rgba(255,255,255,.15);color:rgba(255,255,255,.8)}',
    '#auth-bar .ab-btn{background:none;border:1px solid rgba(255,255,255,.25);color:rgba(255,255,255,.8);cursor:pointer;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;transition:all .12s}',
    '#auth-bar .ab-btn:hover{background:rgba(255,255,255,.1);color:#fff}',
    '#auth-bar .ab-btn.admin-btn{background:#ff6b00;border-color:#ff6b00;color:#fff}',
    '#auth-bar .ab-btn.admin-btn:hover{background:#cc5500}',
    'body{padding-top:40px}',
    /* Admin panel */
    '#admin-overlay{position:fixed;inset:0;background:rgba(10,10,30,.6);z-index:1200;display:none;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;backdrop-filter:blur(4px)}',
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
    '.u-avatar{width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid #eef1f7}',
    '.u-avatar-fb{width:30px;height:30px;border-radius:50%;background:#0057a8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}',
    '.role-sel{border:1.5px solid #d0d8e8;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;outline:none}',
    '.role-sel:focus{border-color:#0057a8}',
    '.btn-del{background:none;border:1px solid #fca5a5;color:#c0392b;cursor:pointer;border-radius:6px;padding:3px 9px;font-size:11px}',
    '.btn-del:hover{background:#fde8e8}',
    '.status-badge{display:inline-block;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700}',
    '.status-invited{background:#fff8e1;color:#b45309;border:1px solid #fde68a}',
    '.status-active{background:#e8f5ee;color:#1a6b3a;border:1px solid #a7d7b9}',
    /* Visibilidad */
    '.vis-prog-wrap{background:#f0f3f8;border-radius:20px;height:8px;overflow:hidden;margin:8px 0}',
    '.vis-prog-bar{background:#1a6b3a;height:100%;transition:width .3s;border-radius:20px}',
    '.vis-dom-hdr{display:flex;justify-content:space-between;align-items:center;padding:9px 14px;background:#f7f9fc;border-radius:8px 8px 0 0;border-bottom:1px solid #eef1f7;cursor:pointer;user-select:none}',
    '.vis-dom-hdr:hover{background:#eef1f7}',
    '.vis-item{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #f5f7fa}',
    '.vis-item:last-child{border-bottom:none}',
    '.vis-item.is-hidden{background:#fffbeb}',
    '.vis-toggle{cursor:pointer;background:none;border:none;font-size:18px;padding:2px 6px;border-radius:6px;transition:background .12s}',
    '.vis-toggle:hover{background:#f0f3f8}',
    '.hidden-badge{display:inline-block;background:#f59e0b;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:5px;vertical-align:middle}',
    /* Modales genéricos */
    '.pc-modal-overlay{position:fixed;inset:0;background:rgba(10,10,30,.55);z-index:1300;display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)}',
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
    /* Toast */
    '#ar-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);background:#1a1a2e;color:#fff;padding:9px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;opacity:0;transition:all .3s;pointer-events:none;white-space:nowrap}',
  ].join('');
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
}

/* ── BOOT ─────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  A.workerUrl = (window.CFG && CFG.workerUrl) || localStorage.getItem('mda_worker_url') || '';
  A.session   = localStorage.getItem('mda_session') || '';

  var urlParams = new URLSearchParams(window.location.search);
  var sessionFromUrl = urlParams.get('session');
  if (sessionFromUrl) {
    A.session = sessionFromUrl;
    localStorage.setItem('mda_session', sessionFromUrl);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  injectCSS();
  buildAuthBar();

  if (!A.session) { redirectToLogin(); return; }
  verifySession();
});

/* ── SESSION ──────────────────────────────────────────────────────────────── */
function verifySession() {
  if (!A.workerUrl) {
    A.user = { email: 'demo@capstonecopper.com', name: 'Demo', role: 'admin' };
    A.ready = true;
    renderAuthBar();
    loadVisibility();
    if (A.onReady) A.onReady(A.user);
    return;
  }
  fetch(A.workerUrl + '/auth/me', authHeaders())
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.authenticated) { redirectToLogin(); return; }
      A.user  = { email: d.email, name: d.name, picture: d.picture, role: d.role };
      A.ready = true;
      renderAuthBar();
      loadVisibility();
      if (A.onReady) A.onReady(A.user);
    })
    .catch(function () {
      A.user  = { email: 'local', name: 'Sin conexión', role: 'agent' };
      A.ready = true;
      renderAuthBar();
      if (A.onReady) A.onReady(A.user);
    });
}

function authHeaders() {
  return { headers: { 'Authorization': 'Bearer ' + A.session, 'Content-Type': 'application/json' } };
}

function redirectToLogin() {
  if (!window.location.pathname.includes('login.html')) {
    window.location.href = 'login.html';
  }
}

/* ── VISIBILITY ───────────────────────────────────────────────────────────── */
function loadVisibility() {
  if (!A.workerUrl) return;
  fetch(A.workerUrl + '/admin/visibility', authHeaders())
    .then(function (r) { return r.json(); })
    .then(function (d) { A.hiddenProcs = d.hidden || []; applyVisibility(); })
    .catch(function () {});
}

function applyVisibility() {
  var isAdmin = A.user && A.user.role === 'admin';
  document.querySelectorAll('.proc-row[data-sop]').forEach(function (row) {
    var sop    = row.dataset.sop;
    var hidden = A.hiddenProcs.includes(sop);
    if (hidden && !isAdmin) {
      row.style.display = 'none';
    } else if (hidden && isAdmin) {
      row.style.opacity = '.55';
      row.style.fontStyle = 'italic';
    } else {
      row.style.display = '';
      row.style.opacity = '';
      row.style.fontStyle = '';
    }
  });
}

/* ── AUTH BAR ─────────────────────────────────────────────────────────────── */
function buildAuthBar() {
  var bar = document.createElement('div');
  bar.id  = 'auth-bar';
  bar.innerHTML = '<span class="ab-brand">Playbook MDA · Capstone</span>' +
    '<div class="ab-spacer"></div>' +
    '<div id="ab-user-area"></div>';
  document.body.insertBefore(bar, document.body.firstChild);
}

function renderAuthBar() {
  var area = document.getElementById('ab-user-area');
  if (!area || !A.user) return;
  var isAdmin = A.user.role === 'admin';
  var avatar  = A.user.picture
    ? '<img class="ab-avatar" src="' + esc(A.user.picture) + '" alt="">'
    : '<div class="ab-avatar-fb">' + (A.user.name || 'U')[0].toUpperCase() + '</div>';
  area.innerHTML =
    (isAdmin ? '<button class="ab-btn admin-btn" id="btn-open-admin">\u2699 Admin</button>' : '') +
    '<div class="ab-user">' + avatar +
    '<span class="ab-name">' + esc(A.user.name || A.user.email) + '</span>' +
    '<span class="ab-role ' + (isAdmin ? 'role-admin' : 'role-agent') + '">' +
    (isAdmin ? 'Admin' : 'Agente') + '</span></div>' +
    '<button class="ab-btn" id="btn-logout">Salir</button>';

  document.getElementById('btn-logout').addEventListener('click', logout);
  if (isAdmin) {
    document.getElementById('btn-open-admin').addEventListener('click', openAdminPanel);
  }
}

/* ── ADMIN PANEL ──────────────────────────────────────────────────────────── */
function openAdminPanel() {
  var existing = document.getElementById('admin-overlay');
  if (existing) { existing.classList.add('open'); loadRoles(); loadVisibilityAdmin(); return; }

  var overlay = document.createElement('div');
  overlay.id  = 'admin-overlay';
  overlay.innerHTML = [
    '<div id="admin-panel">',
    '  <div id="admin-panel-hdr">',
    '    <div><h2>\u2699 Panel de Administraci\u00f3n</h2>',
    '    <div class="u-tag">' + esc(A.user.email) + ' &middot; Admin</div></div>',
    '    <button class="adm-x" id="btn-close-admin">\u00d7</button>',
    '  </div>',
    '  <div class="adm-tabs">',
    '    <div class="adm-tab active" data-tab="users">\ud83d\udc65 Usuarios y Roles</div>',
    '    <div class="adm-tab" data-tab="vis">\ud83d\udc41 Visibilidad de Procedimientos</div>',
    '  </div>',
    '  <div class="adm-body active" id="adm-tab-users"><div id="users-container">Cargando...</div></div>',
    '  <div class="adm-body" id="adm-tab-vis"><div id="vis-container">Cargando...</div></div>',
    '</div>',
  ].join('');

  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeAdminPanel(); });
  document.body.appendChild(overlay);
  overlay.classList.add('open');

  document.getElementById('btn-close-admin').addEventListener('click', closeAdminPanel);
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
  var container = document.getElementById('users-container');
  if (!container) return;
  if (!A.workerUrl) {
    container.innerHTML = '<p style="color:#aaa;font-size:13px">Worker no configurado.</p>';
    return;
  }
  fetch(A.workerUrl + '/admin/users', authHeaders())
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var users  = data.users || {};
      var emails = Object.keys(users);

      var html = '<div style="margin-bottom:14px;display:flex;align-items:center;gap:10px">' +
        '<button class="ap-btn" id="btn-invite">+ Agregar usuario</button>' +
        '<span style="font-size:11px;color:#888">Agrega el correo ANTES de que el usuario intente ingresar.</span>' +
        '</div>';

      if (emails.length === 0) {
        html += '<p style="color:#aaa;font-size:13px">Sin usuarios a\u00fan. Agrega el primero.</p>';
      } else {
        html += '<table class="u-table"><thead><tr><th></th><th>Usuario</th><th>Rol</th><th>\u00daltimo acceso</th><th></th></tr></thead><tbody>';
        emails.forEach(function (email) {
          var u       = users[email];
          var pending = u.status === 'invited';
          var avatar  = u.picture
            ? '<img class="u-avatar" src="' + esc(u.picture) + '" alt="">'
            : '<div class="u-avatar-fb">' + (u.name || email)[0].toUpperCase() + '</div>';
          var badge   = pending
            ? '<span class="status-badge status-invited">PENDIENTE</span>'
            : '<span class="status-badge status-active">ACTIVO</span>';
          var last    = u.lastLogin
            ? new Date(u.lastLogin).toLocaleDateString('es-CL')
            : (pending ? 'A\u00fan no ha entrado' : '\u2014');
          var delBtn  = email !== A.user.email
            ? '<button class="btn-del" data-email="' + esc(email) + '">\u00d7 Quitar</button>'
            : '<small style="color:#aaa">(t\u00fa)</small>';

          html += '<tr>' +
            '<td>' + avatar + '</td>' +
            '<td><strong>' + esc(u.name || email) + '</strong> ' + badge +
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

      container.innerHTML = html;

      document.getElementById('btn-invite').addEventListener('click', openInviteModal);
      container.querySelectorAll('.role-sel').forEach(function (sel) {
        sel.addEventListener('change', function () { changeRole(sel.dataset.email, sel.value); });
      });
      container.querySelectorAll('.btn-del').forEach(function (btn) {
        btn.addEventListener('click', function () { deleteUser(btn.dataset.email); });
      });
    })
    .catch(function () { container.innerHTML = '<p style="color:#c0392b">Error al cargar usuarios.</p>'; });
}

function changeRole(email, role) {
  fetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), {
    method : 'PATCH',
    headers: { 'Authorization': 'Bearer ' + A.session, 'Content-Type': 'application/json' },
    body   : JSON.stringify({ role: role }),
  }).then(function () { showToast('\u2705 Rol actualizado para ' + email); })
    .catch(function () { showToast('\u274c Error al actualizar rol', true); });
}

function deleteUser(email) {
  if (!confirm('\u00bfQuitar acceso a ' + email + '?')) return;
  fetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), {
    method : 'DELETE',
    headers: { 'Authorization': 'Bearer ' + A.session },
  }).then(function () { loadRoles(); showToast('\u2705 Acceso eliminado'); })
    .catch(function () { showToast('\u274c Error', true); });
}

/* ── MODAL INVITAR ────────────────────────────────────────────────────────── */
function openInviteModal() {
  var ex = document.getElementById('invite-overlay');
  if (ex) ex.remove();

  var ov = document.createElement('div');
  ov.id  = 'invite-overlay';
  ov.className = 'pc-modal-overlay open';
  ov.innerHTML = [
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
    '<option value="agent" selected>Agente \u2014 solo lectura del playbook</option>',
    '<option value="admin">Admin \u2014 acceso total y panel de administraci\u00f3n</option>',
    '</select></div>',
    '<div class="pc-error" id="inv-err"></div>',
    '</div>',
    '<div class="pc-modal-ftr">',
    '<button class="pc-btn-secondary" id="inv-cancel">Cancelar</button>',
    '<button class="pc-btn-primary" id="inv-ok">Dar acceso</button>',
    '</div></div>',
  ].join('');

  document.body.appendChild(ov);
  ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
  document.getElementById('inv-x').addEventListener('click', function () { ov.remove(); });
  document.getElementById('inv-cancel').addEventListener('click', function () { ov.remove(); });
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
    errEl.style.display = 'block';
    return;
  }

  fetch(A.workerUrl + '/admin/users', {
    method : 'POST',
    headers: { 'Authorization': 'Bearer ' + A.session, 'Content-Type': 'application/json' },
    body   : JSON.stringify({ email: email, name: name, role: role }),
  })
  .then(function (r) { return r.json(); })
  .then(function (d) {
    if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
    document.getElementById('invite-overlay').remove();
    showToast('\u2705 Acceso concedido a ' + email + '. Ya puede ingresar.');
    loadRoles();
  })
  .catch(function () { errEl.textContent = 'Error al guardar.'; errEl.style.display = 'block'; });
}

/* ── TAB VISIBILIDAD ──────────────────────────────────────────────────────── */
function loadVisibilityAdmin() {
  var container = document.getElementById('vis-container');
  if (!container) return;

  var procs = (window.PROCS || []).map(function (p) {
    return { sop: p.sop, titulo: p.titulo, dom: p.dom };
  });

  if (procs.length === 0) {
    container.innerHTML = '<p style="color:#aaa;font-size:13px">Abre el Cat\u00e1logo principal para gestionar la visibilidad.</p>';
    return;
  }

  var visible = procs.filter(function (p) { return !A.hiddenProcs.includes(p.sop); }).length;
  var total   = procs.length;
  var pct     = Math.round(visible / total * 100);

  var domNames = {
    GIA:'🔑 Gesti\u00f3n de Identidad', SAP:'\u2699\ufe0f SAP', APP:'\ud83d\udcbc Aplicaciones',
    EQU:'\ud83d\udcbb Equipos', NET:'\ud83c\udf10 Red e Infraestructura',
    MIN:'\ud83c\udfed Operaciones Mina', VHF:'\ud83d\udcfb VHF',
    COL:'\ud83d\udcac Colaboraci\u00f3n', CYB:'\ud83d\udef1 Ciberseguridad', SOT:'\ud83d\udd27 Soporte'
  };

  var dominios = {};
  procs.forEach(function (p) {
    if (!dominios[p.dom]) dominios[p.dom] = [];
    dominios[p.dom].push(p);
  });

  var html = [
    '<div style="margin-bottom:16px">',
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
    '<strong style="font-size:13px">' + visible + ' de ' + total + ' procedimientos visibles</strong>',
    '<div style="display:flex;gap:8px">',
    '<button class="ap-btn green" id="btn-show-all">\ud83d\udc41 Mostrar todos</button>',
    '<button class="ap-btn red" id="btn-hide-all">\ud83d\ude48 Ocultar todos</button>',
    '</div></div>',
    '<div class="vis-prog-wrap"><div class="vis-prog-bar" style="width:' + pct + '%"></div></div>',
    '<div style="font-size:11px;color:#888">' + pct + '% visible para los agentes</div>',
    '</div>',
  ].join('');

  Object.keys(dominios).forEach(function (dom) {
    var domProcs  = dominios[dom];
    var domVis    = domProcs.filter(function (p) { return !A.hiddenProcs.includes(p.sop); }).length;
    var domLabel  = domNames[dom] || dom;
    var domId     = 'vis-dom-' + dom;

    html += '<div style="margin-bottom:10px">';
    html += '<div class="vis-dom-hdr" data-target="' + domId + '">';
    html += '<span style="font-size:13px;font-weight:700">' + domLabel + '</span>';
    html += '<span style="font-size:11px;color:#888">' + domVis + '/' + domProcs.length + ' visibles \u25bc</span>';
    html += '</div>';
    html += '<div id="' + domId + '" style="border:1px solid #eef1f7;border-top:none;border-radius:0 0 8px 8px">';

    domProcs.forEach(function (p) {
      var hidden = A.hiddenProcs.includes(p.sop);
      html += '<div class="vis-item' + (hidden ? ' is-hidden' : '') + '">';
      html += '<div>';
      html += '<div style="font-family:monospace;font-size:11px;font-weight:700;color:#0057a8">' +
        esc(p.sop) + (hidden ? '<span class="hidden-badge">OCULTO</span>' : '') + '</div>';
      html += '<div style="font-size:12px;color:#555">' + esc(p.titulo) + '</div>';
      html += '</div>';
      html += '<button class="vis-toggle" data-sop="' + esc(p.sop) + '" title="' +
        (hidden ? 'Hacer visible' : 'Ocultar') + '">' + (hidden ? '\ud83d\ude48' : '\ud83d\udc41') + '</button>';
      html += '</div>';
    });

    html += '</div></div>';
  });

  container.innerHTML = html;

  document.getElementById('btn-show-all').addEventListener('click', function () { setAllVisibility(true); });
  document.getElementById('btn-hide-all').addEventListener('click', function () { setAllVisibility(false); });

  container.querySelectorAll('.vis-dom-hdr').forEach(function (hdr) {
    hdr.addEventListener('click', function () {
      var target = document.getElementById(hdr.dataset.target);
      if (target) target.style.display = target.style.display === 'none' ? '' : 'none';
    });
  });

  container.querySelectorAll('.vis-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () { toggleVisibility(btn.dataset.sop); });
  });
}

function toggleVisibility(sopId) {
  var idx = A.hiddenProcs.indexOf(sopId);
  if (idx >= 0) { A.hiddenProcs.splice(idx, 1); }
  else          { A.hiddenProcs.push(sopId); }
  syncVisibility();
  loadVisibilityAdmin();
  applyVisibility();
  showToast(A.hiddenProcs.includes(sopId) ? '\ud83d\ude48 Procedimiento oculto' : '\ud83d\udc41 Procedimiento visible');
}

function setAllVisibility(visible) {
  var procs = (window.PROCS || []).map(function (p) { return p.sop; });
  if (procs.length === 0) { showToast('Abre el Cat\u00e1logo para usar esta funci\u00f3n.', true); return; }
  var msg = visible ? '\u00bfHacer VISIBLES todos los procedimientos?' : '\u00bfOCULTAR todos los procedimientos?';
  if (!confirm(msg)) return;
  A.hiddenProcs = visible ? [] : procs.slice();
  syncVisibility();
  loadVisibilityAdmin();
  applyVisibility();
  showToast(visible ? '\ud83d\udc41 Todos visibles' : '\ud83d\ude48 Todos ocultos');
}

function syncVisibility() {
  if (!A.workerUrl) return;
  fetch(A.workerUrl + '/admin/visibility', {
    method : 'POST',
    headers: { 'Authorization': 'Bearer ' + A.session, 'Content-Type': 'application/json' },
    body   : JSON.stringify({ hidden: A.hiddenProcs }),
  }).catch(function () {});
}

/* ── LOGOUT ───────────────────────────────────────────────────────────────── */
function logout() {
  if (!confirm('\u00bfCerrar sesi\u00f3n?')) return;
  localStorage.removeItem('mda_session');
  if (A.workerUrl) {
    fetch(A.workerUrl + '/auth/logout', { headers: authHeaders().headers })
      .finally(function () { window.location.href = 'login.html'; });
  } else {
    window.location.href = 'login.html';
  }
}

/* ── TOAST ────────────────────────────────────────────────────────────────── */
function showToast(msg, isError) {
  var t = document.getElementById('ar-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ar-toast';
    document.body.appendChild(t);
  }
  t.textContent  = msg;
  t.style.background = isError ? '#c0392b' : '#1a1a2e';
  t.style.opacity    = '1';
  t.style.transform  = 'translateX(-50%) translateY(0)';
  clearTimeout(t._to);
  t._to = setTimeout(function () {
    t.style.opacity   = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
  }, 3200);
}

/* ── UTILS ────────────────────────────────────────────────────────────────── */
function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── API PÚBLICA ──────────────────────────────────────────────────────────── */
A.openAdminPanel   = openAdminPanel;
A.closeAdminPanel  = closeAdminPanel;
A.logout           = logout;
A.changeRole       = changeRole;
A.deleteUser       = deleteUser;
A.toggleVisibility = toggleVisibility;
A.setAllVisibility = setAllVisibility;
A.openInviteModal  = openInviteModal;
A.confirmInvite    = confirmInvite;
A.showToast        = showToast;
A.authHeaders      = authHeaders;

})();
