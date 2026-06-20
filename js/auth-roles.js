/*!
 * auth-roles.js — MDA Playbook  v2.0
 * ────────────────────────────────────
 * Maneja: autenticación con Google OAuth · gestión de roles · panel de admin
 *         · visibilidad de procedimientos · logout
 *
 * Requiere: workerUrl configurado en playbook-core.js (o window.WORKER_URL)
 */
(function () {
'use strict';

// ── Estado global ────────────────────────────────────────────────────────────
window.PlaybookAuth = {
  user       : null,    // { email, name, picture, role }
  hiddenProcs: [],      // SOP IDs ocultos para agentes
  workerUrl  : '',
  session    : '',
  ready      : false,
  onReady    : null,    // callback cuando auth está lista
};

var A = window.PlaybookAuth;

// ── CSS ─────────────────────────────────────────────────────────────────────
function injectCSS() {
  var css = [
    /* User bar */
    '#auth-bar{position:fixed;top:0;left:0;right:0;height:40px;background:#1a1a2e;display:flex;align-items:center;padding:0 16px;gap:12px;z-index:999;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
    '#auth-bar .ab-brand{color:rgba(255,255,255,.5);font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}',
    '#auth-bar .ab-spacer{flex:1}',
    '#auth-bar .ab-user{display:flex;align-items:center;gap:8px;color:#fff}',
    '#auth-bar .ab-avatar{width:26px;height:26px;border-radius:50%;border:2px solid rgba(255,255,255,.3);object-fit:cover}',
    '#auth-bar .ab-avatar-fallback{width:26px;height:26px;border-radius:50%;background:#0057a8;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0}',
    '#auth-bar .ab-name{font-size:12px;font-weight:600}',
    '#auth-bar .ab-role{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700}',
    '#auth-bar .role-admin{background:#ff6b00;color:#fff}',
    '#auth-bar .role-agent{background:rgba(255,255,255,.15);color:rgba(255,255,255,.8)}',
    '#auth-bar .ab-btn{background:none;border:1px solid rgba(255,255,255,.25);color:rgba(255,255,255,.8);cursor:pointer;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;transition:all .12s}',
    '#auth-bar .ab-btn:hover{background:rgba(255,255,255,.1);color:#fff}',
    '#auth-bar .ab-btn.admin-btn{background:#ff6b00;border-color:#ff6b00;color:#fff}',
    '#auth-bar .ab-btn.admin-btn:hover{background:#cc5500}',
    'body{padding-top:40px}',  /* espacio para el auth-bar */

    /* Badges de procedimiento oculto */
    '.proc-hidden-badge{display:inline-block;background:#f59e0b;color:#fff;font-size:10px;font-weight:700;padding:1px 8px;border-radius:10px;margin-left:6px;vertical-align:middle}',
    '.btn-toggle-vis{background:none;border:1.5px solid #d0d8e8;cursor:pointer;border-radius:6px;padding:4px 10px;font-size:12px;color:#888;transition:all .12s;white-space:nowrap}',
    '.btn-toggle-vis.is-hidden{background:#fff8e1;border-color:#f59e0b;color:#b45309}',
    '.btn-toggle-vis:hover{border-color:#0057a8;color:#0057a8}',

    /* Modal admin — base */
    '#admin-panel-overlay{position:fixed;inset:0;background:rgba(10,10,30,.6);z-index:1200;display:none;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;backdrop-filter:blur(4px)}',
    '#admin-panel-overlay.open{display:flex}',
    '#admin-panel{background:#fff;border-radius:16px;width:100%;max-width:800px;margin:auto;box-shadow:0 24px 80px rgba(0,0,0,.35);overflow:hidden}',
    '#admin-panel-hdr{background:linear-gradient(135deg,#1a1a2e,#0057a8);color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center}',
    '#admin-panel-hdr h2{font-size:18px;font-weight:800}',
    '#admin-panel-hdr .user-tag{font-size:12px;opacity:.75;margin-top:2px}',
    '.admin-x{background:none;border:none;color:#fff;font-size:24px;cursor:pointer;opacity:.8;line-height:1}',
    '.admin-x:hover{opacity:1}',

    /* Tabs */
    '.admin-tabs{display:flex;border-bottom:2px solid #f0f3f8;background:#fafbfc}',
    '.admin-tab{padding:12px 20px;cursor:pointer;font-size:13px;font-weight:600;color:#888;border-bottom:2px solid transparent;margin-bottom:-2px;transition:color .12s}',
    '.admin-tab.active{color:#0057a8;border-bottom-color:#0057a8}',
    '.admin-tab-body{display:none;padding:20px}',
    '.admin-tab-body.active{display:block}',

    /* Tabla de usuarios */
    '.roles-table{width:100%;border-collapse:collapse;font-size:13px}',
    '.roles-table th{background:#f7f9fc;color:#555;font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding:9px 12px;text-align:left;border-bottom:1px solid #eef1f7}',
    '.roles-table td{padding:10px 12px;border-bottom:1px solid #f5f7fa;vertical-align:middle}',
    '.roles-table tr:last-child td{border-bottom:none}',
    '.user-avatar-sm{width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid #eef1f7}',
    '.role-select{border:1.5px solid #d0d8e8;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;outline:none}',
    '.role-select:focus{border-color:#0057a8}',
    '.btn-del-user{background:none;border:1px solid #fca5a5;color:#c0392b;cursor:pointer;border-radius:6px;padding:3px 9px;font-size:11px}',
    '.btn-del-user:hover{background:#fde8e8}',

    /* Procedimientos visibilidad */
    '.vis-list{display:flex;flex-direction:column;gap:8px}',
    '.vis-item{display:flex;align-items:center;justify-content:space-between;background:#f7f9fc;border-radius:8px;padding:10px 14px}',
    '.vis-item.is-hidden{background:#fff8e1;border:1px solid #fde68a}',
    '.vis-item-id{font-family:monospace;font-size:12px;font-weight:700;color:#0057a8}',
    '.vis-item-title{font-size:12px;color:#555;margin-top:2px}',
    '.vis-toggle{cursor:pointer;background:none;border:none;font-size:18px;transition:transform .15s}',
    '.vis-toggle:hover{transform:scale(1.2)}',

    /* Botones panel */
    '.ap-btn-primary{background:#0057a8;color:#fff;border:none;cursor:pointer;border-radius:8px;padding:9px 20px;font-size:13px;font-weight:700;transition:background .12s}',
    '.ap-btn-primary:hover{background:#003d7a}',
    '.ap-note{background:#e8f0fb;border-radius:8px;padding:10px 12px;font-size:12px;color:#0057a8;margin-bottom:14px}',
  ].join('');

  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
}

// ── Inicialización ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  // Leer workerUrl del playbook-core (si existe) o del localStorage
  A.workerUrl = (window.CFG && CFG.workerUrl) || localStorage.getItem('mda_worker_url') || '';
  A.session   = localStorage.getItem('mda_session') || '';

  // Capturar session de la URL (viene del OAuth callback)
  var urlParams = new URLSearchParams(window.location.search);
  var sessionFromUrl = urlParams.get('session');
  if (sessionFromUrl) {
    A.session = sessionFromUrl;
    localStorage.setItem('mda_session', sessionFromUrl);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  injectCSS();
  buildAuthBar();

  if (!A.session) {
    redirectToLogin(); return;
  }

  verifySession();
});

// ── Verificar sesión ─────────────────────────────────────────────────────────
function verifySession() {
  if (!A.workerUrl) {
    // Sin Worker configurado: modo demo (sin auth real)
    A.user = { email: 'demo@capstonecopper.com', name: 'Demo', role: 'agent' };
    A.ready = true;
    renderAuthBar();
    loadVisibility();
    if (A.onReady) A.onReady(A.user);
    return;
  }

  fetch(A.workerUrl + '/auth/me', authHeaders())
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.authenticated) { redirectToLogin(); return; }
      A.user = { email: data.email, name: data.name, picture: data.picture, role: data.role };
      A.ready = true;
      renderAuthBar();
      loadVisibility();
      if (A.onReady) A.onReady(A.user);
    })
    .catch(function() {
      // Sin conexión al Worker — permitir acceso en modo local
      A.user = { email: 'local', name: 'Sin conexión', role: 'agent' };
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

// ── Cargar visibilidad ───────────────────────────────────────────────────────
function loadVisibility() {
  if (!A.workerUrl) return;
  fetch(A.workerUrl + '/admin/visibility', authHeaders())
    .then(function(r) { return r.json(); })
    .then(function(data) {
      A.hiddenProcs = data.hidden || [];
      applyVisibility();
    })
    .catch(function() {});
}

function applyVisibility() {
  // En el catálogo: ocultar/mostrar filas según rol
  var isAdmin = A.user && A.user.role === 'admin';
  document.querySelectorAll('.proc-row[data-sop]').forEach(function(row) {
    var sop = row.dataset.sop;
    var hidden = A.hiddenProcs.includes(sop);
    if (hidden && !isAdmin) {
      row.style.display = 'none';
    } else if (hidden && isAdmin) {
      row.classList.add('proc-hidden');
      row.style.opacity = '.6';
    }
  });
}

// ── Auth Bar ─────────────────────────────────────────────────────────────────
function buildAuthBar() {
  var bar = document.createElement('div');
  bar.id = 'auth-bar';
  bar.innerHTML = [
    '<span class="ab-brand">Playbook MDA · Capstone</span>',
    '<div class="ab-spacer"></div>',
    '<div id="ab-user-area"></div>',
  ].join('');
  document.body.insertBefore(bar, document.body.firstChild);
}

function renderAuthBar() {
  var area = document.getElementById('ab-user-area');
  if (!area || !A.user) return;

  var isAdmin = A.user.role === 'admin';
  var avatar  = A.user.picture
    ? '<img class="ab-avatar" src="' + A.user.picture + '" alt="">'
    : '<div class="ab-avatar-fallback">' + (A.user.name || 'U')[0].toUpperCase() + '</div>';

  area.innerHTML = [
    isAdmin ? '<button class="ab-btn admin-btn" onclick="window.PlaybookAuth.openAdminPanel()">⚙ Admin</button>' : '',
    '<div class="ab-user">',
    avatar,
    '<span class="ab-name">' + escH(A.user.name || A.user.email) + '</span>',
    '<span class="ab-role ' + (isAdmin ? 'role-admin' : 'role-agent') + '">' + (isAdmin ? 'Admin' : 'Agente') + '</span>',
    '</div>',
    '<button class="ab-btn" onclick="window.PlaybookAuth.logout()">Salir</button>',
  ].join('');
}

// ── Panel de administración ──────────────────────────────────────────────────
function openAdminPanel() {
  var existing = document.getElementById('admin-panel-overlay');
  if (existing) { existing.classList.add('open'); loadAdminData(); return; }

  var overlay = document.createElement('div');
  overlay.id = 'admin-panel-overlay';
  overlay.innerHTML = [
    '<div id="admin-panel">',
    '  <div id="admin-panel-hdr">',
    '    <div>',
    '      <h2>⚙ Panel de Administración</h2>',
    '      <div class="user-tag">' + escH(A.user.email) + ' · rol: admin</div>',
    '    </div>',
    '    <button class="admin-x" onclick="window.PlaybookAuth.closeAdminPanel()">×</button>',
    '  </div>',
    '  <div class="admin-tabs">',
    '    <div class="admin-tab active" data-tab="access" onclick="switchTab(this)">🔑 Gestión de Acceso</div>',
    '    <div class="admin-tab" data-tab="roles" onclick="switchTab(this)">👥 Roles</div>',
    '    <div class="admin-tab" data-tab="visibility" onclick="switchTab(this)">👁 Visibilidad</div>',
    '  </div>',
    '  <div class="admin-tab-body active" id="tab-access">',
    '    <div class="ap-note">Agrega el correo Google de cada persona que debe tener acceso. Pueden usar gmail.com, correos corporativos o cualquier cuenta Google.</div>',
    '    <div id="access-add-row" style="display:flex;gap:8px;margin-bottom:14px">',
    '      <input id="access-new-email" type="email" class="pc-input" placeholder="jorge.palma@tres60.cl" style="flex:1">',
    '      <button onclick="window.PlaybookAuth.addToWhitelist()" class="ap-btn-primary" style="white-space:nowrap">＋ Agregar acceso</button>',
    '    </div>',
    '    <div id="access-container">Cargando lista de acceso...</div>',
    '  </div>',
    '  <div class="admin-tab-body" id="tab-roles">',
    '    <div class="ap-note">Los usuarios aparecen aquí después de su primer login. Puedes cambiar el rol desde el menú desplegable.</div>',
    '    <div id="roles-container">Cargando usuarios...</div>',
    '  </div>',
    '  <div class="admin-tab-body" id="tab-visibility">',
    '    <div class="ap-note">👁 = visible para todos · 🙈 = oculto (solo tú lo ves con marca naranja). Los procedimientos ocultos NO aparecen para los agentes.</div>',
    '    <div id="vis-container">Cargando procedimientos...</div>',
    '  </div>',
    '</div>',
  ].join('');

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeAdminPanel();
  });
  document.body.appendChild(overlay);
  overlay.classList.add('open');
  loadAdminData();
}

function closeAdminPanel() {
  var o = document.getElementById('admin-panel-overlay');
  if (o) o.classList.remove('open');
}

function switchTab(el) {
  document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.admin-tab-body').forEach(function(b) { b.classList.remove('active'); });
  el.classList.add('active');
  var body = document.getElementById('tab-' + el.dataset.tab);
  if (body) body.classList.add('active');
}

window.switchTab = switchTab; // Acceso desde onclick inline

function loadAdminData() {
  loadAccess();
  loadRoles();
  loadVisibilityAdmin();
}

// ── Tab Lista de Acceso ───────────────────────────────────────────────────────
function loadAccess() {
  var container = document.getElementById('access-container');
  if (!container) return;
  if (!A.workerUrl) {
    container.innerHTML = '<p style="color:#aaa;font-size:13px">Configura workerUrl para gestionar el acceso.</p>';
    return;
  }

  fetch(A.workerUrl + '/admin/access', A.authHeaders())
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var list = data.allowed || [];
      var itemsHtml = list.length === 0
        ? '<p class="ctx-empty">No hay emails en la lista aún. Agrega el primero.</p>'
        : list.map(function(email) {
            return '<div class="access-item">' +
              '<span class="access-email">📧 ' + escH(email) + '</span>' +
              (email.toLowerCase() !== A.user.email.toLowerCase()
                ? '<button class="btn-del-access" onclick="removeAccess('' + escH(email) + '')">✕ Quitar</button>'
                : '<span style="font-size:11px;color:#aaa">(tú)</span>') +
              '</div>';
          }).join('');

      container.innerHTML = [
        '<div class="access-list">' + itemsHtml + '</div>',
        '<div class="access-add-row">',
        '  <input type="email" id="new-access-email" class="pc-input" placeholder="email@empresa.com" style="flex:1">',
        '  <button class="ap-btn-primary" onclick="addAccess()" style="white-space:nowrap">＋ Agregar email</button>',
        '</div>',
        '<p style="font-size:11px;color:#888;margin-top:8px">',
        '  El usuario debe entrar a la URL del playbook e iniciar sesión con Google usando este email. ',
        '  No necesitas saber su contraseña.',
        '</p>',
      ].join('');

      // Enter key en el input
      var inp = document.getElementById('new-access-email');
      if (inp) inp.addEventListener('keydown', function(e){ if(e.key==='Enter') addAccess(); });
    })
    .catch(function() { container.innerHTML = '<p style="color:#c0392b">Error al cargar la lista.</p>'; });
}

function addAccess() {
  var inp   = document.getElementById('new-access-email');
  var email = (inp ? inp.value : '').trim();
  if (!email || !email.includes('@')) { A.showToast('❌ Ingresa un email válido', true); return; }
  fetch(A.workerUrl + '/admin/access', {
    method : 'POST',
    headers: Object.assign({'Content-Type':'application/json'}, A.authHeaders().headers),
    body   : JSON.stringify({ email: email }),
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) { loadAccess(); A.showToast('✅ ' + email + ' puede ingresar ahora.'); }
    else A.showToast('❌ ' + (d.error || 'Error'), true);
  })
  .catch(function() { A.showToast('❌ Error de conexión', true); });
}

function removeAccess(email) {
  if (!confirm('¿Quitar el acceso a ' + email + '? No podrá iniciar sesión hasta que lo vuelvas a agregar.')) return;
  fetch(A.workerUrl + '/admin/access/' + encodeURIComponent(email), {
    method : 'DELETE',
    headers: A.authHeaders().headers,
  })
  .then(function() { loadAccess(); A.showToast('✅ Acceso revocado para ' + email); })
  .catch(function() { A.showToast('❌ Error', true); });
}

window.addAccess    = addAccess;
window.removeAccess = removeAccess;

// ── Tab Acceso (Whitelist) ────────────────────────────────────────────────────
function loadWhitelist() {
  var container = document.getElementById('access-container');
  if (!container) return;
  if (!A.workerUrl) {
    container.innerHTML = '<p style="color:#aaa;font-size:13px;padding:8px 0">Configura workerUrl para gestionar el acceso.</p>';
    return;
  }
  fetch(A.workerUrl + '/admin/whitelist', A.authHeaders())
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var list = d.whitelist || [];
      if (list.length === 0) {
        container.innerHTML = '<p class="ctx-empty">La lista de acceso está vacía. Agrega el primer correo arriba.</p>';
        return;
      }
      var html = '<div style="background:#fff;border-radius:8px;border:1px solid #eef1f7;overflow:hidden">';
      html += list.map(function(u) {
        var initials = (u.name || u.email)[0].toUpperCase();
        var avatar = u.picture
          ? '<img class="access-avatar" src="' + escH(u.picture) + '" alt="">'
          : '<div class="access-avatar-ph">' + initials + '</div>';
        var loginInfo = u.hasLoggedIn
          ? '<span class="access-meta">Último acceso: ' + (u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('es-CL') : '—') + ' · Rol: ' + (u.role === 'admin' ? '⚙ Admin' : 'Agente') + '</span>'
          : '<span class="access-never">⏳ Aún no ha iniciado sesión</span>';
        return '<div class="access-item' + (u.hasLoggedIn ? '' : ' not-logged') + '">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            avatar +
            '<div>' +
              '<div class="access-email">' + escH(u.email) + '</div>' +
              loginInfo +
            '</div>' +
          '</div>' +
          (u.email !== A.user.email
            ? '<button class="btn-revoke" onclick="window.PlaybookAuth.revokeAccess('' + escH(u.email) + '')">✕ Revocar</button>'
            : '<span style="font-size:11px;color:#aaa">(tú)</span>') +
        '</div>';
      }).join('');
      html += '</div>';
      html += '<p style="font-size:11px;color:#aaa;margin-top:8px;padding:0 2px">Total: ' + list.length + ' usuarios con acceso autorizado</p>';
      container.innerHTML = html;
    })
    .catch(function() { container.innerHTML = '<p style="color:#c0392b">Error al cargar la lista de acceso.</p>'; });
}

function addToWhitelist() {
  var input = document.getElementById('access-new-email');
  if (!input) return;
  var email = input.value.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    A.showToast('⚠️ Escribe un correo válido', true); return;
  }
  if (!A.workerUrl) { A.showToast('Worker no configurado', true); return; }

  fetch(A.workerUrl + '/admin/whitelist', {
    method : 'POST',
    headers: Object.assign({'Content-Type':'application/json'}, A.authHeaders().headers),
    body   : JSON.stringify({ email: email }),
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      input.value = '';
      loadWhitelist();
      A.showToast('✅ Acceso otorgado a ' + email);
    } else {
      A.showToast('❌ ' + (d.error || 'Error'), true);
    }
  })
  .catch(function() { A.showToast('❌ Error de conexión', true); });
}

function revokeAccess(email) {
  if (!confirm('¿Revocar acceso a ' + email + '? La próxima vez que intente entrar verá "Acceso denegado".')) return;
  fetch(A.workerUrl + '/admin/whitelist/' + encodeURIComponent(email), {
    method : 'DELETE',
    headers: A.authHeaders().headers,
  })
  .then(function() { loadWhitelist(); A.showToast('✅ Acceso revocado para ' + email); })
  .catch(function() { A.showToast('❌ Error', true); });
}

// ── Tab Roles ─────────────────────────────────────────────────────────────────
function loadRoles() {
  var container = document.getElementById('roles-container');
  if (!container) return;
  if (!A.workerUrl) {
    container.innerHTML = '<p style="color:#aaa;font-size:13px">Worker no configurado.</p>';
    return;
  }

  fetch(A.workerUrl + '/admin/users', authHeaders())
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var users = data.users || {};
      var emails = Object.keys(users);

      var addBtn = '<div style="margin-bottom:14px;display:flex;align-items:center;gap:12px">' +
        '<button class="ap-btn-primary" style="font-size:12px;padding:7px 16px" onclick="window.PlaybookAuth.openInviteModal()">+ Agregar usuario</button>' +
        '<span style="font-size:11px;color:#888">Agrega el correo ANTES de que el usuario intente ingresar.</span>' +
        '</div>';

      if (emails.length === 0) {
        container.innerHTML = addBtn + '<p style="color:#aaa;font-size:13px">Sin usuarios aún. Usa el botón para agregar el primero.</p>';
        return;
      }

      var rows = emails.map(function(email) {
        var u = users[email];
        var isPending = u.status === 'invited';
        var avatar = u.picture
          ? '<img class="user-avatar-sm" src="' + escH(u.picture) + '" alt="">'
          : '<div class="ab-avatar-fallback" style="width:30px;height:30px;font-size:12px">' + (u.name||email)[0].toUpperCase() + '</div>';
        var badge = isPending
          ? '<span style="background:#fff8e1;color:#b45309;border:1px solid #fde68a;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700;margin-left:6px">PENDIENTE</span>'
          : '<span style="background:#e8f5ee;color:#1a6b3a;border:1px solid #a7d7b9;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700;margin-left:6px">ACTIVO</span>';

        return '<tr>' +
          '<td>' + avatar + '</td>' +
          '<td><strong>' + escH(u.name||email) + '</strong>' + badge +
            '<br><span style="font-size:11px;color:#888">' + escH(email) + '</span></td>' +
          '<td><select class="role-select" data-email="' + escH(email) + '" onchange="window.PlaybookAuth.changeRole(this)">' +
            '<option value="admin"' + (u.role==='admin'?' selected':'') + '>Admin</option>' +
            '<option value="agent"' + (u.role==='agent'?' selected':'') + '>Agente</option>' +
            '</select></td>' +
          '<td><small style="color:#aaa">' + (u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('es-CL') : (isPending ? 'Aun no ha entrado' : '\u2014')) + '</small></td>' +
          (email !== A.user.email
            ? '<td><button class="btn-del-user" onclick="window.PlaybookAuth.deleteUser(\'' + escH(email) + '\')">\u00d7 Quitar</button></td>'
            : '<td><small style="color:#aaa">(tu)</small></td>') +
          '</tr>';
      }).join('');

      container.innerHTML = addBtn +
        '<table class="roles-table"><thead><tr><th></th><th>Usuario</th><th>Rol</th><th>Ultimo acceso</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
    })
    .catch(function() { container.innerHTML = '<p style="color:#c0392b">Error al cargar usuarios.</p>'; });
}

function changeRole(select) {
  var email = select.dataset.email;
  var role  = select.value;
  fetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), {
    method : 'PATCH',
    headers: Object.assign({'Content-Type':'application/json'}, authHeaders().headers),
    body   : JSON.stringify({ role: role }),
  }).then(function() { showToast('✅ Rol actualizado para ' + email); })
    .catch(function() { showToast('❌ Error al actualizar el rol', true); });
}

function deleteUser(email) {
  if (!confirm('¿Quitar el acceso a ' + email + '? Deberá volver a iniciar sesión para registrarse.')) return;
  fetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), {
    method : 'DELETE',
    headers: authHeaders().headers,
  }).then(function() { loadRoles(); showToast('✅ Usuario eliminado'); })
    .catch(function() { showToast('❌ Error', true); });
}


// ── Modal invitar usuario ─────────────────────────────────────────────────────
function openInviteModal() {
  var existing = document.getElementById('invite-modal-overlay');
  if (existing) { existing.remove(); }

  var overlay = document.createElement('div');
  overlay.id = 'invite-modal-overlay';
  overlay.className = 'pc-modal-overlay open';
  overlay.innerHTML = [
    '<div class="pc-modal" style="max-width:440px">',
    '  <div class="pc-modal-hdr">',
    '    <strong>+ Agregar acceso a usuario</strong>',
    '    <button class="pc-modal-x" onclick="document.getElementById('invite-modal-overlay').remove()">×</button>',
    '  </div>',
    '  <div class="pc-modal-body">',
    '    <div class="ap-note" style="margin:0">',
    '      El usuario debe tener una cuenta Google con este correo. Cuando intente ingresar, ',
    '      se autenticará con su propia cuenta. Tú nunca ves su contraseña.',
    '    </div>',
    '    <div>',
    '      <div class="pc-label">Correo electrónico del usuario</div>',
    '      <input class="pc-input" type="email" id="invite-email" placeholder="jorge.palma@tres60.cl" autofocus>',
    '    </div>',
    '    <div>',
    '      <div class="pc-label">Nombre (opcional)</div>',
    '      <input class="pc-input" type="text" id="invite-name" placeholder="Jorge Palma">',
    '    </div>',
    '    <div>',
    '      <div class="pc-label">Rol</div>',
    '      <select class="pc-select" id="invite-role">',
    '        <option value="agent" selected>Agente — ve los procedimientos</option>',
    '        <option value="admin">Admin — acceso total y panel de administración</option>',
    '      </select>',
    '    </div>',
    '    <div class="pc-error-msg" id="invite-error" style="display:none"></div>',
    '  </div>',
    '  <div class="pc-modal-ftr">',
    '    <button class="pc-btn-secondary" onclick="document.getElementById('invite-modal-overlay').remove()">Cancelar</button>',
    '    <button class="pc-btn-primary" onclick="window.PlaybookAuth.confirmInvite()">✅ Dar acceso</button>',
    '  </div>',
    '</div>',
  ].join('');
  document.body.appendChild(overlay);
  setTimeout(function(){ document.getElementById('invite-email').focus(); }, 100);
}

function confirmInvite() {
  var email = (document.getElementById('invite-email').value || '').trim().toLowerCase();
  var name  = (document.getElementById('invite-name').value  || '').trim();
  var role  =  document.getElementById('invite-role').value;
  var errEl = document.getElementById('invite-error');

  if (!email || !email.includes('@')) {
    errEl.textContent = 'Ingresa un correo válido.';
    errEl.style.display = 'block';
    return;
  }

  if (!A.workerUrl) {
    errEl.textContent = 'Worker no configurado.';
    errEl.style.display = 'block';
    return;
  }

  fetch(A.workerUrl + '/admin/users/' + encodeURIComponent(email), {
    method : 'PATCH',
    headers: Object.assign({'Content-Type':'application/json'}, authHeaders().headers),
    body   : JSON.stringify({ email: email, name: name, role: role }),
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) {
      errEl.textContent = data.error;
      errEl.style.display = 'block';
      return;
    }
    document.getElementById('invite-modal-overlay').remove();
    showToast('✅ Acceso concedido a ' + email + '. El usuario puede ingresar ahora.');
    loadRoles();
  })
  .catch(function() {
    errEl.textContent = 'Error al guardar. Intenta nuevamente.';
    errEl.style.display = 'block';
  });
}


// ── Modal: Invitar usuario ────────────────────────────────────────────────────
function openInviteModal() {
  var ex = document.getElementById('invite-overlay');
  if (ex) ex.remove();
  var ov = document.createElement('div');
  ov.id = 'invite-overlay';
  ov.className = 'pc-modal-overlay open';
  ov.innerHTML = [
    '<div class="pc-modal" style="max-width:440px">',
    '<div class="pc-modal-hdr"><strong>+ Dar acceso a usuario</strong>',
    '<button class="pc-modal-x" onclick="document.getElementById(\'invite-overlay\').remove()">x</button></div>',
    '<div class="pc-modal-body">',
    '<div class="ap-note" style="margin:0 0 4px">El usuario se autentica con su propia cuenta Google. Tu nunca ves su contrasena.</div>',
    '<div><div class="pc-label">Correo del usuario</div>',
    '<input class="pc-input" type="email" id="inv-email" placeholder="jorge.palma@tres60.cl"></div>',
    '<div><div class="pc-label">Nombre (opcional)</div>',
    '<input class="pc-input" type="text" id="inv-name" placeholder="Jorge Palma"></div>',
    '<div><div class="pc-label">Rol</div>',
    '<select class="pc-select" id="inv-role">',
    '<option value="agent" selected>Agente - solo lectura del playbook</option>',
    '<option value="admin">Admin - acceso total y panel de administracion</option>',
    '</select></div>',
    '<div class="pc-error-msg" id="inv-err" style="display:none"></div>',
    '</div>',
    '<div class="pc-modal-ftr">',
    '<button class="pc-btn-secondary" onclick="document.getElementById(\'invite-overlay\').remove()">Cancelar</button>',
    '<button class="pc-btn-primary" onclick="window.PlaybookAuth.confirmInvite()">Dar acceso</button>',
    '</div></div>',
  ].join('');
  document.body.appendChild(ov);
  setTimeout(function(){ var el=document.getElementById('inv-email'); if(el) el.focus(); }, 80);
}

function confirmInvite() {
  var email = (document.getElementById('inv-email').value||'').trim().toLowerCase();
  var name  = (document.getElementById('inv-name').value ||'').trim();
  var role  =  document.getElementById('inv-role').value;
  var err   =  document.getElementById('inv-err');

  if (!email || !email.includes('@')) {
    err.textContent='Ingresa un correo valido.'; err.style.display='block'; return;
  }
  if (!A.workerUrl) {
    err.textContent='Worker no configurado.'; err.style.display='block'; return;
  }

  fetch(A.workerUrl + '/admin/users', {
    method : 'POST',
    headers: Object.assign({'Content-Type':'application/json'}, authHeaders().headers),
    body   : JSON.stringify({ email:email, name:name, role:role }),
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (d.error) { err.textContent=d.error; err.style.display='block'; return; }
    document.getElementById('invite-overlay').remove();
    showToast('Acceso concedido a ' + email + '. Ya puede ingresar.');
    loadRoles();
  })
  .catch(function(){ err.textContent='Error al guardar. Intenta de nuevo.'; err.style.display='block'; });
}

// ── Tab Visibilidad ───────────────────────────────────────────────────────────
var _allProcs = []; // se llena desde el catálogo o los datos del playbook-core

function loadVisibilityAdmin() {
  var container = document.getElementById('vis-container');
  if (!container) return;

  // Obtener lista de procedimientos del DOM o de window.PROCS (catálogo)
  var procs = (window.PROCS || []).map(function(p) { return { sop: p.sop, titulo: p.titulo }; });
  if (procs.length === 0) {
    // Fallback: leer del DOM (en SOPs individuales no hay lista)
    container.innerHTML = '<p style="color:#aaa;font-size:13px">Este panel de visibilidad está disponible en el Catálogo principal.</p>';
    return;
  }

  _allProcs = procs;

  var items = procs.map(function(p) {
    var hidden = A.hiddenProcs.includes(p.sop);
    return '<div class="vis-item' + (hidden ? ' is-hidden' : '') + '" id="vis-' + p.sop + '">' +
      '<div>' +
        '<div class="vis-item-id">' + escH(p.sop) + (hidden ? ' <span class="proc-hidden-badge">OCULTO</span>' : '') + '</div>' +
        '<div class="vis-item-title">' + escH(p.titulo) + '</div>' +
      '</div>' +
      '<button class="vis-toggle" onclick="window.PlaybookAuth.toggleVisibility(\'' + p.sop + '\')" title="' + (hidden ? 'Hacer visible' : 'Ocultar') + '">' +
        (hidden ? '🙈' : '👁') +
      '</button>' +
    '</div>';
  }).join('');

  container.innerHTML = '<div class="vis-list">' + items + '</div>';
}

function toggleVisibility(sopId) {
  var idx = A.hiddenProcs.indexOf(sopId);
  if (idx >= 0) {
    A.hiddenProcs.splice(idx, 1);
  } else {
    A.hiddenProcs.push(sopId);
  }

  // Guardar en Worker
  if (A.workerUrl) {
    fetch(A.workerUrl + '/admin/visibility', {
      method : 'POST',
      headers: Object.assign({'Content-Type':'application/json'}, authHeaders().headers),
      body   : JSON.stringify({ hidden: A.hiddenProcs }),
    }).catch(function() {});
  }

  // Re-renderizar la lista y aplicar en el DOM
  loadVisibilityAdmin();
  applyVisibility();
  showToast(A.hiddenProcs.includes(sopId) ? '🙈 Procedimiento oculto' : '👁 Procedimiento visible');
}

// ── Logout ───────────────────────────────────────────────────────────────────
function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  localStorage.removeItem('mda_session');
  if (A.workerUrl) {
    fetch(A.workerUrl + '/auth/logout', { method: 'GET', headers: authHeaders().headers })
      .finally(function() { window.location.href = 'login.html'; });
  } else {
    window.location.href = 'login.html';
  }
}

// ── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, isError) {
  var t = document.getElementById('ar-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ar-toast';
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);padding:9px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;opacity:0;transition:all .3s;pointer-events:none;white-space:nowrap';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = isError ? '#c0392b' : '#1a1a2e';
  t.style.color = '#fff';
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._to);
  t._to = setTimeout(function() {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
  }, 3000);
}

function escH(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── API pública ───────────────────────────────────────────────────────────────
A.openAdminPanel   = openAdminPanel;
  A.openInviteModal  = openInviteModal;
  A.confirmInvite    = confirmInvite;
A.openInviteModal  = openInviteModal;
A.confirmInvite    = confirmInvite;
A.closeAdminPanel  = closeAdminPanel;
A.logout           = logout;
A.changeRole       = changeRole;
A.deleteUser       = deleteUser;
A.toggleVisibility = toggleVisibility;
A.addToWhitelist   = addToWhitelist;
A.revokeAccess     = revokeAccess;
A.authHeaders      = authHeaders;
A.showToast        = showToast;

})();
