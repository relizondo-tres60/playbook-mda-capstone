/*!
 * Playbook Core — MDA Capstone Copper  v1.0
 * ──────────────────────────────────────────
 * Incluye: glosario emergente editable · secciones de contexto · asistente IA
 * Requiere: localStorage · Para IA: proxy.py corriendo en localhost:5001
 *
 * Para activar Modo Edición: clic en el botón ⚙ → clave Tres60admin
 */
(function () {
'use strict';

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════
var CFG = {
  adminPwd    : 'Tres60admin',
  glossaryKey : 'mda_glossary',
  ctxPfx      : 'mda_ctx_',
  // ▼ PEGA AQUÍ LA URL DE TU CLOUDFLARE WORKER después del despliegue
  // Ejemplo: 'https://mda-playbook.tuusuario.workers.dev'
  // Déjalo vacío ('') para usar solo localStorage (sin sincronización)
  workerUrl   : localStorage.getItem('mda_worker_url') || '',
  primary     : '#0057a8',
  accent      : '#ff6b00',
  dark        : '#1a1a2e',
};

// ═══════════════════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════════════════
var editMode   = false;
var sopId      = '';
var sopTitle   = '';
var selText    = '';

// ═══════════════════════════════════════════════════════════════════════
// ARRANQUE
// ═══════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {
  sopId    = extractSopId();
  sopTitle = (document.title || '').split('—').slice(1).join('—').trim();

  injectCSS();
  buildGlossaryPanel();
  buildPasswordModal();
  buildTermEditorModal();
  buildAIPanel();
  buildAdminButton();
  buildContextSections();

  applyGlossaryTerms();
  renderContextSections();
  listenTermClicks();
  initFromWorker();   // carga datos desde Cloudflare KV si workerUrl está configurada
});

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────
function extractSopId() {
  var el = document.querySelector('.sop-id');
  if (!el) return 'SOP-DESCONOCIDO';
  var m = el.textContent.match(/SOP-[A-Z]+-\d+/);
  return m ? m[0] : 'SOP-DESCONOCIDO';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) { return null; }
}

function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════════════
// CSS INYECTADO
// ═══════════════════════════════════════════════════════════════════════
function injectCSS() {
  var css = [
    /* ── Término del glosario ── */
    '.gl-term{color:'+CFG.primary+';border-bottom:2px dotted '+CFG.accent+';cursor:pointer;padding:1px 3px;border-radius:3px;font-weight:600;transition:background .12s}',
    '.gl-term:hover{background:#fff0e0;color:'+CFG.accent+'}',

    /* ── Panel glosario ── */
    '#gl-overlay{position:fixed;inset:0;background:rgba(10,10,30,.45);z-index:800;opacity:0;pointer-events:none;transition:opacity .25s;backdrop-filter:blur(2px)}',
    '#gl-overlay.open{opacity:1;pointer-events:all}',
    '#gl-panel{position:fixed;right:-440px;top:0;width:420px;height:100vh;background:#fff;box-shadow:-6px 0 40px rgba(0,0,0,.18);z-index:801;transition:right .28s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow:hidden}',
    '#gl-panel.open{right:0}',
    '#gl-panel-hdr{background:linear-gradient(135deg,'+CFG.primary+',#003d7a);color:#fff;padding:18px 20px;flex-shrink:0;display:flex;justify-content:space-between;align-items:flex-start}',
    '#gl-panel-cat{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;opacity:.75;margin-bottom:4px}',
    '#gl-panel-title{font-size:18px;font-weight:800}',
    '#gl-close-btn{background:rgba(255,255,255,.2);border:none;color:#fff;cursor:pointer;border-radius:8px;padding:6px 10px;font-size:16px;line-height:1;margin-top:2px}',
    '#gl-close-btn:hover{background:rgba(255,255,255,.35)}',
    '#gl-panel-body{padding:20px;overflow-y:auto;flex:1;font-size:13px;color:#444;line-height:1.6}',
    '#gl-panel-body h4{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:'+CFG.primary+';margin:14px 0 6px;padding-bottom:5px;border-bottom:1px solid #eef1f7}',
    '#gl-panel-body h4:first-child{margin-top:0}',
    '#gl-panel-body p{margin-bottom:8px}',
    '#gl-panel-body ul{padding-left:0;list-style:none}',
    '#gl-panel-body li{padding:3px 0 3px 14px;position:relative}',
    '#gl-panel-body li::before{content:"›";position:absolute;left:0;color:'+CFG.primary+';font-weight:700}',
    '#gl-panel-actions{padding:12px 20px;border-top:1px solid #eef1f7;flex-shrink:0;display:flex;gap:8px}',
    '.gl-action-btn{flex:1;border:none;cursor:pointer;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;transition:background .12s}',
    '.gl-edit-btn{background:'+CFG.primary+';color:#fff}',
    '.gl-edit-btn:hover{background:#003d7a}',
    '.gl-del-btn{background:#fde8e8;color:#c0392b}',
    '.gl-del-btn:hover{background:#f5c6c6}',

    /* ── Burbuja selección ── */
    '#gl-sel-bubble{position:fixed;background:'+CFG.accent+';color:#fff;border:none;cursor:pointer;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:700;z-index:900;box-shadow:0 4px 16px rgba(0,0,0,.25);display:none;white-space:nowrap;pointer-events:all}',
    '#gl-sel-bubble:hover{background:#cc5500}',

    /* ── Botón admin (fijo bottom-left) ── */
    '#admin-fab{position:fixed;bottom:28px;left:28px;background:'+CFG.dark+';color:#fff;border:none;cursor:pointer;border-radius:30px;padding:9px 16px;font-size:12px;font-weight:700;letter-spacing:.3px;z-index:700;box-shadow:0 4px 16px rgba(0,0,0,.25);transition:background .15s}',
    '#admin-fab.active{background:'+CFG.accent+'}',
    '#admin-fab:hover{background:'+CFG.primary+'}',

    /* ── Modo edición: ribete naranja ── */
    'body.edit-mode .paso-body p,body.edit-mode .paso-body{cursor:text;border-radius:4px}',
    'body.edit-mode .paso-body p::selection{background:rgba(255,107,0,.25)}',
    '.edit-mode-banner{background:'+CFG.accent+';color:#fff;text-align:center;padding:7px;font-size:12px;font-weight:700;letter-spacing:.3px;display:none;position:sticky;top:40px;z-index:600}',
    'body.edit-mode .edit-mode-banner{display:block}',

    /* ── Modales compartidos ── */
    '.pc-modal-overlay{position:fixed;inset:0;background:rgba(10,10,30,.55);z-index:1000;display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)}',
    '.pc-modal-overlay.open{display:flex}',
    '.pc-modal{background:#fff;border-radius:14px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden}',
    '.pc-modal-hdr{background:linear-gradient(135deg,'+CFG.primary+',#003d7a);color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center}',
    '.pc-modal-hdr strong{font-size:15px}',
    '.pc-modal-x{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;opacity:.8;line-height:1}',
    '.pc-modal-x:hover{opacity:1}',
    '.pc-modal-body{padding:20px;display:flex;flex-direction:column;gap:12px}',
    '.pc-label{font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px}',
    '.pc-input,.pc-select,.pc-textarea{width:100%;border:1.5px solid #d0d8e8;border-radius:8px;padding:9px 12px;font-size:13px;font-family:inherit;color:#1a1a2e;outline:none;transition:border-color .15s}',
    '.pc-input:focus,.pc-select:focus,.pc-textarea:focus{border-color:'+CFG.primary+';box-shadow:0 0 0 3px rgba(0,87,168,.1)}',
    '.pc-textarea{resize:vertical;min-height:80px}',
    '.pc-modal-ftr{padding:14px 20px;border-top:1px solid #eef1f7;display:flex;gap:10px;justify-content:flex-end}',
    '.pc-btn-primary{background:'+CFG.primary+';color:#fff;border:none;cursor:pointer;border-radius:8px;padding:9px 22px;font-size:13px;font-weight:700;transition:background .15s}',
    '.pc-btn-primary:hover{background:#003d7a}',
    '.pc-btn-secondary{background:#f0f3f8;color:#555;border:1.5px solid #d0d8e8;cursor:pointer;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600}',
    '.pc-btn-secondary:hover{background:#e8ecf3}',
    '.pc-error-msg{background:#fde8e8;color:#c0392b;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;display:none}',
    '.pc-ref-label{background:#f7f9fc;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;color:'+CFG.primary+';font-family:monospace}',

    /* ── Secciones de contexto ── */
    '#sop-ctx{max-width:1100px;margin:0 auto 20px;padding:0 20px}',
    '.ctx-block{background:#fff;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.08);overflow:hidden;margin-bottom:8px}',
    '.ctx-trigger{width:100%;background:none;border:none;text-align:left;padding:14px 18px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;transition:background .12s}',
    '.ctx-trigger:hover{background:#f7f9fc}',
    '.ctx-trigger-left{display:flex;align-items:center;gap:10px}',
    '.ctx-ico{font-size:18px;width:26px;text-align:center}',
    '.ctx-lbl{font-size:14px;font-weight:700;color:#1a1a2e}',
    '.ctx-count{background:#eef1f7;color:#555;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px}',
    '.ctx-arrow{color:#aaa;font-size:12px;transition:transform .2s}',
    '.ctx-trigger.open .ctx-arrow{transform:rotate(90deg)}',
    '.ctx-body{display:none;padding:4px 18px 16px}',
    '.ctx-trigger.open + .ctx-body{display:block}',

    /* Contactos */
    '.ctx-contacts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:8px}',
    '.ctx-contact-card{background:#f7f9fc;border-radius:8px;padding:12px 14px;border-left:3px solid '+CFG.primary+'}',
    '.ctx-contact-name{font-weight:700;font-size:13px}',
    '.ctx-contact-role{font-size:11px;color:#888;margin-top:1px}',
    '.ctx-contact-site{font-size:11px;color:'+CFG.primary+';margin-top:4px;font-weight:600}',
    '.ctx-contact-info{font-size:11px;color:#555;margin-top:5px;line-height:1.5}',

    /* Sistemas */
    '.ctx-sys-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}',
    '.ctx-sys-table th{background:'+CFG.primary+';color:#fff;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px}',
    '.ctx-sys-table td{padding:9px 12px;border-bottom:1px solid #f0f3f8;vertical-align:top}',
    '.ctx-sys-table tr:last-child td{border-bottom:none}',
    '.ctx-sys-table tr:hover td{background:#f7f9fc}',
    '.sys-type-it{display:inline-block;background:#e8f0fb;color:'+CFG.primary+';font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px}',
    '.sys-type-ot{display:inline-block;background:#fde8e8;color:#c0392b;font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px}',

    /* Errores */
    '.ctx-error-list{list-style:none;margin-top:8px;display:flex;flex-direction:column;gap:8px}',
    '.ctx-error-item{background:#fdf4f4;border-radius:8px;padding:12px 14px;border-left:3px solid #c0392b}',
    '.ctx-error-title{font-weight:700;color:#c0392b;font-size:13px}',
    '.ctx-error-desc{font-size:12px;color:#555;margin-top:3px}',
    '.ctx-error-fix{font-size:12px;color:#1a6b3a;margin-top:5px;font-weight:600}',

    /* Botón add en modo edición */
    '.ctx-add-btn{background:'+CFG.accent+';color:#fff;border:none;cursor:pointer;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;margin-top:10px;display:none;transition:background .12s}',
    '.ctx-add-btn:hover{background:#cc5500}',
    'body.edit-mode .ctx-add-btn{display:inline-block}',
    '.ctx-del-item{background:none;border:1px solid #ddd;cursor:pointer;border-radius:5px;padding:2px 7px;font-size:10px;color:#c0392b;float:right;margin-left:8px;display:none}',
    'body.edit-mode .ctx-del-item{display:inline-block}',
    '.ctx-empty{font-size:12px;color:#aaa;font-style:italic;padding:8px 0}',

    /* ── AI Chat ── */
    '#ai-fab{position:fixed;bottom:28px;right:28px;width:52px;height:52px;background:linear-gradient(135deg,'+CFG.primary+',#7b2d8b);border:none;border-radius:50%;cursor:pointer;box-shadow:0 4px 20px rgba(0,87,168,.4);display:flex;align-items:center;justify-content:center;font-size:22px;z-index:700;transition:transform .15s}',
    '#ai-fab:hover{transform:scale(1.08)}',
    '#ai-panel{position:fixed;bottom:90px;right:28px;width:360px;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);z-index:700;display:none;flex-direction:column;overflow:hidden;max-height:520px}',
    '#ai-panel.open{display:flex}',
    '#ai-panel-hdr{background:linear-gradient(135deg,'+CFG.primary+',#7b2d8b);padding:13px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}',
    '#ai-panel-hdr-left{display:flex;align-items:center;gap:10px}',
    '.ai-avatar{width:32px;height:32px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px}',
    '.ai-name{color:#fff;font-weight:700;font-size:13px}',
    '.ai-status{color:rgba(255,255,255,.7);font-size:10px;margin-top:1px}',
    '.ai-x{background:none;border:none;color:#fff;cursor:pointer;font-size:18px;opacity:.8}',
    '.ai-x:hover{opacity:1}',
    '#ai-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:9px;background:#f7f9fc}',
    '.ai-msg{max-width:85%;font-size:13px;line-height:1.5}',
    '.ai-msg-bot{align-self:flex-start}',
    '.ai-msg-user{align-self:flex-end}',
    '.ai-bubble{padding:9px 13px;border-radius:14px}',
    '.ai-msg-bot .ai-bubble{background:#fff;border-radius:4px 14px 14px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08);color:#1a1a2e}',
    '.ai-msg-user .ai-bubble{background:linear-gradient(135deg,'+CFG.primary+',#003d7a);color:#fff;border-radius:14px 14px 4px 14px}',
    '.ai-time{font-size:10px;color:#aaa;margin-top:2px;padding:0 3px}',
    '.ai-msg-bot .ai-time{text-align:left}',
    '.ai-msg-user .ai-time{text-align:right}',
    '.ai-cost-bar{background:#e8f0fb;border-top:1px solid #d0ddef;padding:6px 14px;font-size:11px;color:'+CFG.primary+';flex-shrink:0;display:flex;justify-content:space-between}',
    '#ai-input-row{padding:9px 12px;border-top:1px solid #eef1f7;background:#fff;display:flex;gap:7px;flex-shrink:0}',
    '#ai-input{flex:1;border:1.5px solid #d0d8e8;border-radius:8px;padding:8px 11px;font-size:13px;font-family:inherit;outline:none;color:#1a1a2e}',
    '#ai-input:focus{border-color:'+CFG.primary+'}',
    '#ai-send{background:'+CFG.primary+';color:#fff;border:none;cursor:pointer;border-radius:8px;padding:8px 13px;font-size:13px;font-weight:700}',
    '#ai-send:hover{background:#003d7a}',
    '#ai-thinking{display:none;padding:8px 12px;background:#fff;margin:4px;border-radius:14px;font-size:12px;color:#aaa;font-style:italic;border-radius:4px 14px 14px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08);align-self:flex-start;width:fit-content}',
  ].join('\n');

  var st = document.createElement('style');
  st.id = 'playbook-core-css';
  st.textContent = css;
  document.head.appendChild(st);
}

// ═══════════════════════════════════════════════════════════════════════
// PANEL DE GLOSARIO (solo lectura)
// ═══════════════════════════════════════════════════════════════════════
function buildGlossaryPanel() {
  var overlay = el('div', {id:'gl-overlay'});
  overlay.addEventListener('click', closeGlossaryPanel);

  var panel = el('div', {id:'gl-panel'});
  panel.innerHTML = [
    '<div id="gl-panel-hdr">',
    '  <div><div id="gl-panel-cat"></div><div id="gl-panel-title"></div></div>',
    '  <button id="gl-close-btn" onclick="void(0)">✕</button>',
    '</div>',
    '<div id="gl-panel-body"></div>',
    '<div id="gl-panel-actions">',
    '  <button class="gl-action-btn gl-edit-btn" id="gl-edit-btn" style="display:none">✏️ Editar definición</button>',
    '  <button class="gl-action-btn gl-del-btn" id="gl-del-btn" style="display:none">🗑 Eliminar término</button>',
    '</div>',
  ].join('');

  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  document.getElementById('gl-close-btn').addEventListener('click', closeGlossaryPanel);
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeGlossaryPanel(); });
}

function openGlossaryPanel(key) {
  var g = getGlossary();
  var def = g[key];
  if (!def) return;

  document.getElementById('gl-panel-cat').textContent   = def.category || 'Término';
  document.getElementById('gl-panel-title').textContent = def.title || key;
  document.getElementById('gl-panel-body').innerHTML    = def.content || '<p>Sin definición.</p>';

  var editBtn = document.getElementById('gl-edit-btn');
  var delBtn  = document.getElementById('gl-del-btn');
  editBtn.style.display = editMode ? '' : 'none';
  delBtn.style.display  = editMode ? '' : 'none';
  editBtn.onclick = function(){ openTermEditor(key, def); };
  delBtn.onclick  = function(){ deleteTerm(key); };

  document.getElementById('gl-overlay').classList.add('open');
  document.getElementById('gl-panel').classList.add('open');
}

function closeGlossaryPanel() {
  document.getElementById('gl-overlay').classList.remove('open');
  document.getElementById('gl-panel').classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════════
// GLOSARIO — STORAGE (localStorage + Cloudflare KV)
// ═══════════════════════════════════════════════════════════════════════
function getGlossary() {
  return lsGet(CFG.glossaryKey) || {};
}

function saveGlossaryTerm(key, data) {
  // 1. Actualizar cache local inmediatamente (sin esperar red)
  var g = getGlossary();
  g[key] = data;
  lsSet(CFG.glossaryKey, g);
  applyGlossaryTerms();

  // 2. Sincronizar con KV en segundo plano
  if (CFG.workerUrl) {
    fetch(CFG.workerUrl + '/glossary', {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json', 'X-Admin-Key': CFG.adminPwd },
      body    : JSON.stringify({ key: key, data: data }),
    }).catch(function(e) { console.warn('[Playbook] KV sync error:', e.message); });
  }
}

function deleteTerm(key) {
  if (!confirm('¿Eliminar el término "' + key + '"? Se quitará el resaltado de todos los procedimientos.')) return;
  var g = getGlossary();
  delete g[key];
  lsSet(CFG.glossaryKey, g);
  closeGlossaryPanel();
  applyGlossaryTerms();

  if (CFG.workerUrl) {
    fetch(CFG.workerUrl + '/glossary/' + encodeURIComponent(key), {
      method  : 'DELETE',
      headers : { 'X-Admin-Key': CFG.adminPwd },
    }).catch(function(e) { console.warn('[Playbook] KV delete error:', e.message); });
  }
}

// ── Carga inicial desde KV (si workerUrl está configurado) ──────────────────
function initFromWorker() {
  if (!CFG.workerUrl) return;

  // Glosario compartido
  fetch(CFG.workerUrl + '/glossary')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.glossary && Object.keys(d.glossary).length > 0) {
        lsSet(CFG.glossaryKey, d.glossary);  // actualizar cache local
        applyGlossaryTerms();
      }
    })
    .catch(function(e) { console.warn('[Playbook] No se pudo cargar el glosario del Worker:', e.message); });

  // Contexto del SOP actual
  ['contacts','systems','errors'].forEach(function(type) {
    fetch(CFG.workerUrl + '/context/' + sopId + '/' + type)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.data && d.data.length > 0) {
          lsSet(CFG.ctxPfx + sopId + '_' + type, d.data);
          renderContextSections();
        }
      })
      .catch(function() {});  // silencioso: usa localStorage como fallback
  });
}

// ═══════════════════════════════════════════════════════════════════════
// APLICAR TÉRMINOS DEL GLOSARIO AL TEXTO
// ═══════════════════════════════════════════════════════════════════════
function applyGlossaryTerms() {
  var targets = document.querySelectorAll(
    '.paso-body p, .paso-body div, .escalamiento li, .cierre li, .nota, .notas-box, .esc-text, .proc-desc, .proc-titulo'
  );

  targets.forEach(function(el) {
    // Guardar HTML original la primera vez
    if (!el.dataset.origHtml) el.dataset.origHtml = el.innerHTML;
    el.innerHTML = el.dataset.origHtml;
  });

  var g = getGlossary();
  var keys = Object.keys(g);
  if (keys.length === 0) { listenTermClicks(); return; }

  targets.forEach(function(container) {
    keys.forEach(function(key) {
      var def = g[key];
      var display = def.displayText || key;
      try {
        var re = new RegExp('(?<![\\w\\-])' + escapeRe(display) + '(?![\\w\\-])', 'gi');
        container.innerHTML = container.innerHTML.replace(re, function(m) {
          return '<span class="gl-term" data-key="' + key + '">' + m + '</span>';
        });
      } catch(e) {}
    });
  });

  listenTermClicks();
}

function listenTermClicks() {
  document.querySelectorAll('.gl-term').forEach(function(span) {
    span.onclick = function(e) {
      e.stopPropagation();
      openGlossaryPanel(this.dataset.key);
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// BURBUJA DE SELECCIÓN (modo edición)
// ═══════════════════════════════════════════════════════════════════════
function buildSelectionBubble() {
  var bubble = el('button', {id:'gl-sel-bubble'});
  bubble.textContent = '＋ Agregar al glosario';
  bubble.addEventListener('click', function() {
    bubble.style.display = 'none';
    openTermEditor(null, {displayText: selText});
  });
  document.body.appendChild(bubble);
}

function handleSelection() {
  if (!editMode) return;
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed) { hideSelBubble(); return; }
  var txt = sel.toString().trim();
  if (txt.length < 2 || txt.length > 60) { hideSelBubble(); return; }

  // Verificar que la selección está dentro del contenido del paso
  var range = sel.getRangeAt(0);
  var ancestor = range.commonAncestorContainer;
  var inStep = false;
  var node = ancestor.nodeType === 3 ? ancestor.parentNode : ancestor;
  while (node && node !== document.body) {
    if (node.classList && (node.classList.contains('paso-body') || node.classList.contains('card-body') || node.classList.contains('step-body'))) {
      inStep = true; break;
    }
    node = node.parentNode;
  }
  if (!inStep) { hideSelBubble(); return; }

  selText = txt;
  var rect = range.getBoundingClientRect();
  var bubble = document.getElementById('gl-sel-bubble');
  bubble.style.display = 'block';
  bubble.style.top  = (window.scrollY + rect.top - 44) + 'px';
  bubble.style.left = (window.scrollX + rect.left + rect.width/2 - bubble.offsetWidth/2) + 'px';
}

function hideSelBubble() {
  var b = document.getElementById('gl-sel-bubble');
  if (b) b.style.display = 'none';
  selText = '';
}

// ═══════════════════════════════════════════════════════════════════════
// EDITOR DE TÉRMINOS (modal)
// ═══════════════════════════════════════════════════════════════════════
function buildTermEditorModal() {
  var modal = el('div', {id:'term-editor-overlay', className:'pc-modal-overlay'});
  modal.innerHTML = [
    '<div class="pc-modal" style="max-width:560px">',
    '  <div class="pc-modal-hdr">',
    '    <strong id="term-editor-hdr-title">Agregar término al glosario</strong>',
    '    <button class="pc-modal-x" id="term-editor-x">×</button>',
    '  </div>',
    '  <div class="pc-modal-body">',
    '    <div class="pc-ref-label" id="term-editor-sop-ref">'+sopId+'</div>',
    '    <div>',
    '      <div class="pc-label">Texto que aparece en el procedimiento</div>',
    '      <input class="pc-input" id="te-display" placeholder="Ej: supervisor autorizado">',
    '    </div>',
    '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">',
    '      <div>',
    '        <div class="pc-label">Título del panel</div>',
    '        <input class="pc-input" id="te-title" placeholder="Ej: Supervisores Autorizados">',
    '      </div>',
    '      <div>',
    '        <div class="pc-label">Categoría</div>',
    '        <select class="pc-select" id="te-cat">',
    '          <option value="Autorización">Autorización</option>',
    '          <option value="Contacto">Contacto</option>',
    '          <option value="Sistema">Sistema</option>',
    '          <option value="Proceso">Proceso</option>',
    '          <option value="Herramienta">Herramienta</option>',
    '          <option value="Concepto técnico">Concepto técnico</option>',
    '          <option value="Procedimiento relacionado">Procedimiento relacionado</option>',
    '          <option value="Otro">Otro</option>',
    '        </select>',
    '      </div>',
    '    </div>',
    '    <div>',
    '      <div class="pc-label">Definición / Contenido del panel (HTML permitido)</div>',
    '      <textarea class="pc-textarea" id="te-content" rows="6"',
    '        placeholder="Escribe la definición. Puedes usar HTML básico:\n&lt;p&gt;texto&lt;/p&gt;\n&lt;h4&gt;Sección&lt;/h4&gt;\n&lt;ul&gt;&lt;li&gt;item&lt;/li&gt;&lt;/ul&gt;\n\nEjemplo de contacto:\n&lt;h4&gt;Contactos por sitio&lt;/h4&gt;\n&lt;p&gt;&lt;strong&gt;MVE:&lt;/strong&gt; Patricio Chapana · pchapana@capstone.com&lt;/p&gt;">',
    '      </textarea>',
    '    </div>',
    '    <div class="pc-error-msg" id="te-error">Completa el texto y la definición.</div>',
    '    <div style="background:#e8f5ee;border-radius:8px;padding:10px 12px;font-size:11px;color:#1a6b3a">',
    '      💡 Este término quedará resaltado en <strong>todos los SOPs</strong> donde aparezca. Se guarda en el navegador de este equipo.',
    '    </div>',
    '  </div>',
    '  <div class="pc-modal-ftr">',
    '    <button class="pc-btn-secondary" id="te-cancel">Cancelar</button>',
    '    <button class="pc-btn-primary" id="te-save">💾 Guardar en glosario</button>',
    '  </div>',
    '</div>',
  ].join('');

  document.body.appendChild(modal);

  document.getElementById('term-editor-x').addEventListener('click', closeTermEditor);
  document.getElementById('te-cancel').addEventListener('click', closeTermEditor);
  document.getElementById('te-save').addEventListener('click', saveTerm);
}

var _editingKey = null;

function openTermEditor(key, prefill) {
  _editingKey = key;
  prefill = prefill || {};
  document.getElementById('term-editor-hdr-title').textContent = key ? 'Editar término del glosario' : 'Agregar término al glosario';
  document.getElementById('te-display').value = prefill.displayText || prefill.title || '';
  document.getElementById('te-title').value   = prefill.title || '';
  document.getElementById('te-cat').value     = prefill.category || 'Autorización';
  document.getElementById('te-content').value = (prefill.content || '').replace(/<[^>]+>/g, s => s); // keep HTML
  document.getElementById('te-error').style.display = 'none';
  document.getElementById('term-editor-overlay').classList.add('open');
  document.getElementById('te-display').focus();
  closeGlossaryPanel();
}

function closeTermEditor() {
  document.getElementById('term-editor-overlay').classList.remove('open');
  _editingKey = null;
  window.getSelection && window.getSelection().removeAllRanges();
  hideSelBubble();
}

function saveTerm() {
  var display  = document.getElementById('te-display').value.trim();
  var title    = document.getElementById('te-title').value.trim();
  var cat      = document.getElementById('te-cat').value;
  var content  = document.getElementById('te-content').value.trim();

  if (!display || !content) {
    document.getElementById('te-error').style.display = 'block';
    return;
  }

  var key = _editingKey || display.toLowerCase().replace(/[^a-z0-9áéíóúüñ]+/g, '_').replace(/^_|_$/g,'');
  saveGlossaryTerm(key, {
    key        : key,
    displayText: display,
    title      : title || display,
    category   : cat,
    content    : content,
  });

  closeTermEditor();
  showToast('✅ Término "' + display + '" guardado en el glosario.');
}

// ═══════════════════════════════════════════════════════════════════════
// MODAL DE CONTRASEÑA
// ═══════════════════════════════════════════════════════════════════════
function buildPasswordModal() {
  var modal = el('div', {id:'pwd-modal-overlay', className:'pc-modal-overlay'});
  modal.innerHTML = [
    '<div class="pc-modal" style="max-width:380px">',
    '  <div class="pc-modal-hdr">',
    '    <strong>🔐 Modo Edición — Acceso Restringido</strong>',
    '    <button class="pc-modal-x" id="pwd-x">×</button>',
    '  </div>',
    '  <div class="pc-modal-body">',
    '    <p style="font-size:13px;color:#555">Ingresa la clave de administrador Tres60 para activar el modo de edición del glosario y las secciones de contexto.</p>',
    '    <div>',
    '      <div class="pc-label">Clave de acceso</div>',
    '      <input class="pc-input" type="password" id="pwd-input" placeholder="••••••••••">',
    '    </div>',
    '    <div class="pc-error-msg" id="pwd-error">Clave incorrecta.</div>',
    '  </div>',
    '  <div class="pc-modal-ftr">',
    '    <button class="pc-btn-secondary" id="pwd-cancel">Cancelar</button>',
    '    <button class="pc-btn-primary" id="pwd-ok">Acceder</button>',
    '  </div>',
    '</div>',
  ].join('');

  document.body.appendChild(modal);

  document.getElementById('pwd-x').addEventListener('click', closePwdModal);
  document.getElementById('pwd-cancel').addEventListener('click', closePwdModal);
  document.getElementById('pwd-ok').addEventListener('click', checkPwd);
  document.getElementById('pwd-input').addEventListener('keydown', function(e){
    if(e.key==='Enter') checkPwd();
  });
}

function checkPwd() {
  var val = document.getElementById('pwd-input').value;
  if (val === CFG.adminPwd) {
    closePwdModal();
    activateEditMode();
  } else {
    document.getElementById('pwd-error').style.display = 'block';
    document.getElementById('pwd-input').value = '';
    document.getElementById('pwd-input').focus();
  }
}

function closePwdModal() {
  document.getElementById('pwd-modal-overlay').classList.remove('open');
  document.getElementById('pwd-input').value = '';
  document.getElementById('pwd-error').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════
// BOTÓN ADMINISTRADOR
// ═══════════════════════════════════════════════════════════════════════
function buildAdminButton() {
  // El botón de modo edición solo en SOPs individuales
  if (!document.querySelector('.sop-id')) return;
  var btn = el('button', {id:'admin-fab'});
  btn.textContent = '⚙ Modo Edición';
  btn.addEventListener('click', function() {
    if (!editMode) {
      document.getElementById('pwd-modal-overlay').classList.add('open');
      setTimeout(function(){ document.getElementById('pwd-input').focus(); }, 100);
    } else {
      deactivateEditMode();
    }
  });
  document.body.appendChild(btn);

  // Banner de aviso en modo edición
  var banner = el('div', {className:'edit-mode-banner'});
  banner.textContent = '✏️ MODO EDICIÓN ACTIVO — Selecciona cualquier texto para añadirlo al glosario';
  // Insertar después del auth-bar (si existe) para no solapar el header de auth
  var authBar = document.getElementById('auth-bar');
  if (authBar && authBar.nextSibling) {
    document.body.insertBefore(banner, authBar.nextSibling);
  } else {
    document.body.insertBefore(banner, document.body.firstChild);
  }

  // Burbuja de selección
  buildSelectionBubble();
  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('touchend', handleSelection);
}

function activateEditMode() {
  editMode = true;
  document.body.classList.add('edit-mode');
  document.getElementById('admin-fab').textContent = '✔ Salir de Edición';
  document.getElementById('admin-fab').classList.add('active');
  renderContextSections(); // re-render con botones de edición
  // Mensaje mostrado por el banner sticky — toast eliminado para evitar duplicado
}

function deactivateEditMode() {
  editMode = false;
  document.body.classList.remove('edit-mode');
  document.getElementById('admin-fab').textContent = '⚙ Modo Edición';
  document.getElementById('admin-fab').classList.remove('active');
  hideSelBubble();
  renderContextSections();
}

// ═══════════════════════════════════════════════════════════════════════
// SECCIONES DE CONTEXTO
// ═══════════════════════════════════════════════════════════════════════
function buildContextSections() {
  // Solo mostrar en páginas SOP individuales (tienen elemento .sop-id)
  // NO mostrar en el catálogo principal
  if (!document.querySelector('.sop-id')) return;

  var container = document.getElementById('sop-ctx');
  if (!container) {
    container = el('div', {id:'sop-ctx'});
    var fbSection = document.querySelector('.fb-section');
    var footer    = document.querySelector('.footer');
    var ref = fbSection || footer;
    if (ref) ref.parentNode.insertBefore(container, ref);
    else document.body.appendChild(container);
  }
}

function renderContextSections() {
  // Solo en páginas SOP individuales
  if (!document.querySelector('.sop-id')) return;
  var container = document.getElementById('sop-ctx');
  if (!container) return;

  var contacts = lsGet(CFG.ctxPfx + sopId + '_contacts') || [];
  var systems  = lsGet(CFG.ctxPfx + sopId + '_systems')  || [];
  var errors   = lsGet(CFG.ctxPfx + sopId + '_errors')   || [];

  container.innerHTML = [
    '<div style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;padding:0 2px">📚 Contexto Operacional</div>',
    buildContactsSection(contacts),
    buildSystemsSection(systems),
    buildErrorsSection(errors),
  ].join('');

  attachCtxEvents();
}

// ── Contactos ──
function buildContactsSection(contacts) {
  var cards = contacts.length === 0
    ? '<p class="ctx-empty">Sin contactos registrados aún.</p>'
    : contacts.map(function(c) {
        return [
          '<div class="ctx-contact-card">',
          '  <button class="ctx-del-item" data-type="contacts" data-id="'+c.id+'" title="Eliminar">✕</button>',
          '  <div class="ctx-contact-name">'+esc(c.name)+'</div>',
          '  <div class="ctx-contact-role">'+esc(c.role)+'</div>',
          '  <div class="ctx-contact-site">'+esc(c.site)+'</div>',
          '  <div class="ctx-contact-info">'+esc(c.email) + (c.phone ? '<br>'+esc(c.phone) : '')+'</div>',
          '</div>',
        ].join('');
      }).join('');

  return ctxSection('📋', 'Contactos Clave', contacts.length,
    '<div class="ctx-contacts-grid">' + cards + '</div>' +
    '<button class="ctx-add-btn" data-modal="contact-modal">＋ Agregar contacto</button>'
  );
}

// ── Sistemas ──
function buildSystemsSection(systems) {
  var rows = systems.length === 0
    ? '<tr><td colspan="4" class="ctx-empty" style="padding:10px">Sin sistemas registrados.</td></tr>'
    : systems.map(function(s) {
        return '<tr>' +
          '<td><strong>'+esc(s.name)+'</strong></td>' +
          '<td>'+esc(s.desc)+'</td>' +
          '<td><code style="font-size:11px">'+esc(s.access)+'</code></td>' +
          '<td><span class="sys-type-'+(s.type==='OT'?'ot':'it')+'">'+esc(s.type)+'</span></td>' +
          '<td style="width:30px"><button class="ctx-del-item" data-type="systems" data-id="'+s.id+'">✕</button></td>' +
          '</tr>';
      }).join('');

  return ctxSection('💻', 'Sistemas Involucrados', systems.length,
    '<table class="ctx-sys-table">' +
    '<thead><tr><th>Sistema</th><th>Rol en este procedimiento</th><th>Cómo acceder</th><th>Tipo</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<button class="ctx-add-btn" data-modal="system-modal">＋ Agregar sistema</button>'
  );
}

// ── Errores frecuentes ──
function buildErrorsSection(errors) {
  var items = errors.length === 0
    ? '<p class="ctx-empty">Sin errores documentados aún.</p>'
    : errors.map(function(e) {
        return [
          '<li class="ctx-error-item">',
          '  <button class="ctx-del-item" data-type="errors" data-id="'+e.id+'" title="Eliminar">✕</button>',
          '  <div class="ctx-error-title">'+esc(e.title)+'</div>',
          '  <div class="ctx-error-desc">'+esc(e.desc)+'</div>',
          '  <div class="ctx-error-fix">'+esc(e.fix)+'</div>',
          '</li>',
        ].join('');
      }).join('');

  return ctxSection('⚠️', 'Errores Frecuentes', errors.length,
    '<ul class="ctx-error-list">' + items + '</ul>' +
    '<button class="ctx-add-btn" data-modal="error-modal">＋ Documentar error</button>'
  );
}

function ctxSection(icon, label, count, bodyHtml) {
  return [
    '<div class="ctx-block">',
    '  <button class="ctx-trigger" onclick="this.classList.toggle(\'open\')">',
    '    <div class="ctx-trigger-left">',
    '      <span class="ctx-ico">'+icon+'</span>',
    '      <span class="ctx-lbl">'+label+'</span>',
    '      <span class="ctx-count">'+count+'</span>',
    '    </div>',
    '    <span class="ctx-arrow">▶</span>',
    '  </button>',
    '  <div class="ctx-body">'+bodyHtml+'</div>',
    '</div>',
  ].join('');
}

function attachCtxEvents() {
  // Botones eliminar
  document.querySelectorAll('.ctx-del-item').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var type = this.dataset.type;
      var id   = this.dataset.id;
      if (!confirm('¿Eliminar este elemento?')) return;
      var arr = lsGet(CFG.ctxPfx + sopId + '_' + type) || [];
      arr = arr.filter(function(x){ return x.id !== id; });
      lsSet(CFG.ctxPfx + sopId + '_' + type, arr);
      renderContextSections();
    });
  });

  // Botones agregar
  document.querySelectorAll('.ctx-add-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openCtxModal(this.dataset.modal);
    });
  });
}

// ── Modales para agregar items de contexto ──
function openCtxModal(type) {
  var modals = {
    'contact-modal': buildContactModal,
    'system-modal' : buildSystemModal,
    'error-modal'  : buildErrorModal,
  };
  if (modals[type]) modals[type]();
}

function buildContactModal() {
  promptModal('➕ Agregar Contacto Clave', [
    {id:'cm-name',  label:'Nombre',        ph:'Ej: Pablo Piombi'},
    {id:'cm-role',  label:'Cargo / Rol',   ph:'Ej: ADC — Technology Manager'},
    {id:'cm-site',  label:'Faena / Sitio', ph:'Ej: ⛏️ Mantoverde / Mantos Blancos'},
    {id:'cm-email', label:'Correo',        ph:'usuario@capstonecopper.com'},
    {id:'cm-phone', label:'Teléfono (opc)',ph:'+56 9 XXXX XXXX'},
  ], function(vals) {
    if (!vals['cm-name'] || !vals['cm-email']) return 'Nombre y correo son obligatorios.';
    var arr = lsGet(CFG.ctxPfx + sopId + '_contacts') || [];
    arr.push({id:uid(), name:vals['cm-name'], role:vals['cm-role'], site:vals['cm-site'], email:vals['cm-email'], phone:vals['cm-phone']});
    lsSet(CFG.ctxPfx + sopId + '_contacts', arr);
    renderContextSections();
    syncContextToKV('contacts', arr);
  });
}

function buildSystemModal() {
  promptModal('➕ Agregar Sistema Involucrado', [
    {id:'sm-name',   label:'Nombre del sistema', ph:'Ej: Active Directory'},
    {id:'sm-desc',   label:'Rol en este procedimiento', ph:'Ej: Deshabilitar la cuenta del usuario'},
    {id:'sm-access', label:'Cómo acceder', ph:'Ej: dsa.msc o admanager.capstonecopper.com'},
    {id:'sm-type',   label:'Tipo (IT u OT)', ph:'IT', type:'select', options:['IT','OT']},
  ], function(vals) {
    if (!vals['sm-name']) return 'El nombre del sistema es obligatorio.';
    var arr = lsGet(CFG.ctxPfx + sopId + '_systems') || [];
    arr.push({id:uid(), name:vals['sm-name'], desc:vals['sm-desc'], access:vals['sm-access'], type:vals['sm-type']||'IT'});
    lsSet(CFG.ctxPfx + sopId + '_systems', arr);
    renderContextSections();
    syncContextToKV('systems', arr);
  });
}

function buildErrorModal() {
  promptModal('➕ Documentar Error Frecuente', [
    {id:'em-title', label:'Título del error',           ph:'Ej: Las sesiones M365 no se cierran al deshabilitar AD'},
    {id:'em-desc',  label:'Descripción del problema',   ph:'Qué pasa y cuándo ocurre...', type:'textarea'},
    {id:'em-fix',   label:'Solución / Cómo evitarlo',  ph:'Qué debe hacer el agente...', type:'textarea'},
  ], function(vals) {
    if (!vals['em-title'] || !vals['em-fix']) return 'Título y solución son obligatorios.';
    var arr = lsGet(CFG.ctxPfx + sopId + '_errors') || [];
    arr.push({id:uid(), title:vals['em-title'], desc:vals['em-desc'], fix:vals['em-fix']});
    lsSet(CFG.ctxPfx + sopId + '_errors', arr);
    renderContextSections();
    syncContextToKV('errors', arr);
  });
}

// Modal genérico de formulario
function promptModal(title, fields, onSave) {
  var existing = document.getElementById('prompt-modal-overlay');
  if (existing) existing.remove();

  var fieldsHtml = fields.map(function(f) {
    var input = f.type === 'textarea'
      ? '<textarea class="pc-textarea" id="'+f.id+'" placeholder="'+esc(f.ph)+'" rows="3"></textarea>'
      : f.type === 'select'
        ? '<select class="pc-select" id="'+f.id+'">' + (f.options||[]).map(function(o){ return '<option>'+o+'</option>'; }).join('') + '</select>'
        : '<input class="pc-input" type="text" id="'+f.id+'" placeholder="'+esc(f.ph)+'">';
    return '<div><div class="pc-label">'+esc(f.label)+'</div>'+input+'</div>';
  }).join('');

  var overlay = el('div', {id:'prompt-modal-overlay', className:'pc-modal-overlay'});
  overlay.innerHTML = [
    '<div class="pc-modal">',
    '  <div class="pc-modal-hdr"><strong>'+esc(title)+'</strong>',
    '    <button class="pc-modal-x" id="pm-x">×</button>',
    '  </div>',
    '  <div class="pc-modal-body">'+fieldsHtml,
    '    <div class="pc-error-msg" id="pm-error"></div>',
    '  </div>',
    '  <div class="pc-modal-ftr">',
    '    <button class="pc-btn-secondary" id="pm-cancel">Cancelar</button>',
    '    <button class="pc-btn-primary" id="pm-save">💾 Guardar</button>',
    '  </div>',
    '</div>',
  ].join('');

  document.body.appendChild(overlay);
  overlay.classList.add('open');

  var close = function(){ overlay.remove(); };
  document.getElementById('pm-x').addEventListener('click', close);
  document.getElementById('pm-cancel').addEventListener('click', close);
  document.getElementById('pm-save').addEventListener('click', function() {
    var vals = {};
    fields.forEach(function(f){ vals[f.id] = (document.getElementById(f.id)||{}).value || ''; });
    var err = onSave(vals);
    if (err) { document.getElementById('pm-error').textContent = err; document.getElementById('pm-error').style.display='block'; }
    else close();
  });

  // Focus primer campo
  if (fields[0]) {
    var first = document.getElementById(fields[0].id);
    if (first) setTimeout(function(){ first.focus(); }, 100);
  }
}

// ── Sync contexto a KV ─────────────────────────────────────────────────────
function syncContextToKV(type, arr) {
  if (!CFG.workerUrl) return;
  fetch(CFG.workerUrl + '/context/' + sopId + '/' + type, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/json', 'X-Admin-Key': CFG.adminPwd },
    body    : JSON.stringify({ data: arr }),
  }).catch(function(e) { console.warn('[Playbook] KV context sync error:', e.message); });
}

// También sync el delete de items de contexto
var _origAttachCtxEvents = null;  // no-op, el delete ya llama lsSet, solo añadir sync

// ═══════════════════════════════════════════════════════════════════════
// ASISTENTE IA
// ═══════════════════════════════════════════════════════════════════════
var aiCost = 0;
var aiHistory = [];

function buildAIPanel() {
  var fab = el('button', {id:'ai-fab'});
  fab.innerHTML = '✨';
  fab.title = 'Asistente IA — Pregúntame sobre este procedimiento';
  fab.addEventListener('click', function(){ document.getElementById('ai-panel').classList.toggle('open'); });
  document.body.appendChild(fab);

  var panel = el('div', {id:'ai-panel'});
  panel.innerHTML = [
    '<div id="ai-panel-hdr">',
    '  <div id="ai-panel-hdr-left">',
    '    <div class="ai-avatar">🤖</div>',
    '    <div><div class="ai-name">Asistente MDA</div><div class="ai-status" id="ai-status">Conectando...</div></div>',
    '  </div>',
    '  <button class="ai-x" onclick="document.getElementById(\'ai-panel\').classList.remove(\'open\')">✕</button>',
    '</div>',
    '<div id="ai-msgs">',
    '  <div id="ai-thinking" style="display:none">escribiendo...</div>',
    '</div>',
    '<div class="ai-cost-bar">',
    '  <span>💰 Costo sesión: <strong id="ai-cost-label">$0.000</strong> USD</span>',
    '  <span id="ai-config-note" style="color:#c0392b;font-size:10px;display:none">⚠ proxy.py no conectado</span>',
    '</div>',
    '<div id="ai-input-row">',
    '  <input id="ai-input" type="text" placeholder="Pregunta sobre este procedimiento...">',
    '  <button id="ai-send">↑</button>',
    '</div>',
  ].join('');

  document.body.appendChild(panel);

  document.getElementById('ai-input').addEventListener('keydown', function(e){
    if (e.key === 'Enter') sendAIMessage();
  });
  document.getElementById('ai-send').addEventListener('click', sendAIMessage);

  checkProxyStatus();
  addAIMessage('bot', 'Hola 👋 Soy el asistente de <strong>' + sopId + '</strong>. Puedo responder preguntas sobre este procedimiento, ayudarte a interpretar pasos o aclarar términos.');
}

var proxyConnected = false;

function checkProxyStatus() {
  var pingUrl = CFG.workerUrl ? CFG.workerUrl + '/ping' : 'http://localhost:5001/ping';
  fetch(pingUrl, {method:'GET'})
    .then(function(){ proxyConnected = true; setAIStatus('● En línea', '#4ade80'); })
    .catch(function(){ proxyConnected = false; setAIStatus('● Proxy no conectado', '#f87171'); document.getElementById('ai-config-note').style.display=''; });
}

function setAIStatus(text, color) {
  var el = document.getElementById('ai-status');
  if (el){ el.textContent = text; el.style.color = color || 'rgba(255,255,255,.7)'; }
}

function sendAIMessage() {
  var input = document.getElementById('ai-input');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  addAIMessage('user', msg);
  aiHistory.push({role:'user', content:msg});

  if (!proxyConnected) {
    addAIMessage('bot', '⚠️ El proxy de IA no está conectado. Ejecuta <code>python proxy.py</code> en la carpeta del playbook y recarga la página.');
    return;
  }

  // Mostrar "escribiendo..."
  var thinking = document.getElementById('ai-thinking');
  thinking.style.display = 'block';
  scrollAI();

  // Contexto del SOP para el sistema prompt
  var sopContext = document.querySelector('.paso-body, .step-body')
    ? Array.from(document.querySelectorAll('.paso-body, .step-body')).map(function(e){ return e.textContent; }).join('\n')
    : '';

  var systemPrompt = 'Eres el asistente de la Mesa de Ayuda de Capstone Copper Chile. ' +
    'Responde preguntas sobre el procedimiento ' + sopId + ' (' + sopTitle + '). ' +
    'Respuestas concisas, en español, orientadas a acción. Máximo 120 palabras. ' +
    'Contenido del procedimiento:\n\n' + sopContext.slice(0, 3000);

  var aiUrl = CFG.workerUrl ? CFG.workerUrl + '/chat' : 'http://localhost:5001/chat';
  fetch(aiUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      system  : systemPrompt,
      messages: aiHistory,
      sopId   : sopId,
    })
  })
  .then(function(r){ return r.json(); })
  .then(function(data) {
    thinking.style.display = 'none';
    var reply = data.response || 'Sin respuesta del servidor.';
    var cost  = data.cost || 0.013;
    aiCost += cost;
    aiHistory.push({role:'assistant', content:reply});
    addAIMessage('bot', reply, '~$' + cost.toFixed(3));
    document.getElementById('ai-cost-label').textContent = '$' + aiCost.toFixed(3);
  })
  .catch(function(e) {
    thinking.style.display = 'none';
    addAIMessage('bot', '❌ Error al contactar el proxy: ' + e.message);
  });
}

function addAIMessage(who, html, costNote) {
  var msgs = document.getElementById('ai-msgs');
  var thinking = document.getElementById('ai-thinking');
  var div = el('div', {className:'ai-msg ai-msg-' + (who==='bot'?'bot':'user')});
  div.innerHTML = '<div class="ai-bubble">' + (who==='bot' ? html : esc(html)) + '</div>' +
    (costNote ? '<div class="ai-time">' + costNote + '</div>' : '');
  msgs.insertBefore(div, thinking);
  scrollAI();
}

function scrollAI() {
  var msgs = document.getElementById('ai-msgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════════════
function showToast(msg) {
  var t = document.getElementById('pc-toast');
  if (!t) {
    t = el('div', {id:'pc-toast'});
    t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);background:#1a1a2e;color:#fff;padding:10px 22px;border-radius:30px;font-size:13px;font-weight:600;z-index:9999;opacity:0;transition:all .3s;pointer-events:none;white-space:nowrap';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._to);
  t._to = setTimeout(function(){ t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(20px)'; }, 3200);
}

// ═══════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════
function el(tag, attrs) {
  var e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function(k){ e[k] = attrs[k]; });
  return e;
}

function esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

})(); // fin IIFE
