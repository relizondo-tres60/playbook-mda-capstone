/**
 * Panel interno de seguimiento y auditoria.
 *
 * Una sola pagina con pestanas. Sin framework: cada vista se re-renderiza
 * completa a partir del estado del servidor, lo que mantiene el codigo
 * predecible y evita estados intermedios inconsistentes.
 */
import {
  get, post, patch, del, upload, download,
  esc, fmtDate, fmtDateTime, daysUntil, toast, tag, MESES, LABELS, ApiError,
} from './api.js';

const app = {
  /** @type {any} */ user: null,
  /** @type {any[]} */ campaigns: [],
  /** @type {string|null} */ campaignId: null,
  /** @type {any} */ dashboard: null,
  /** @type {any[]} */ companies: [],
  /** @type {any[]} */ administrators: [],
  view: 'resumen',
  filters: {},
};

const $ = (sel) => document.querySelector(sel);
const viewEl = (name) => document.getElementById(`view-${name}`);

init();

async function init() {
  try {
    const me = await get('/api/auth/me');
    app.user = me.user;
  } catch {
    location.href = '/';
    return;
  }
  $('#user-info').textContent = `${app.user.name} (${app.user.role})`;
  $('#logout').addEventListener('click', async () => {
    await post('/api/auth/logout').catch(() => {});
    location.href = '/';
  });

  document.querySelectorAll('.tabs button').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });
  $('#campaign-select').addEventListener('change', (e) => {
    app.campaignId = e.target.value || null;
    localStorage.setItem('ext_audit_campaign', app.campaignId || '');
    refreshView();
  });

  await loadCampaigns();
  switchView(location.hash.replace('#', '') || 'resumen');
}

function switchView(name) {
  if (!viewEl(name)) name = 'resumen';
  app.view = name;
  location.hash = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  viewEl(name).classList.add('active');
  refreshView();
}

function refreshView() {
  const render = {
    resumen: renderResumen,
    importar: renderImportar,
    cuentas: renderCuentas,
    envios: renderEnvios,
    empresas: renderEmpresas,
    administradores: renderAdministradores,
    auditoria: renderAuditoria,
    config: renderConfig,
  }[app.view];
  if (render) render().catch(showError);
}

function showError(err) {
  const msg = err instanceof ApiError ? err.message : String(err && err.message ? err.message : err);
  toast(msg, 'error');
  console.error(err);
}

async function loadCampaigns() {
  const { campaigns } = await get('/api/campaigns');
  app.campaigns = campaigns;
  const stored = localStorage.getItem('ext_audit_campaign');
  if (!app.campaignId) {
    app.campaignId = campaigns.find((c) => c.id === stored)?.id || (campaigns[0] ? campaigns[0].id : null);
  }
  $('#campaign-select').innerHTML = campaigns.length
    ? campaigns.map((c) => `<option value="${esc(c.id)}" ${c.id === app.campaignId ? 'selected' : ''}>${esc(c.code)} - ${esc(LABELS.campaignStatus[c.status] || c.status)}</option>`).join('')
    : '<option value="">Sin campanas</option>';
}

function requireCampaign(container) {
  if (app.campaignId) return true;
  container.innerHTML = `<div class="card">
      <div class="alert info">No hay ninguna campana seleccionada. Cree la campana del mes en la pestana
      <strong>Resumen</strong> para comenzar.</div></div>`;
  return false;
}

const canOperate = () => app.user && (app.user.role === 'admin' || app.user.role === 'operator');
const canAdmin = () => app.user && app.user.role === 'admin';

// ===========================================================================
// Resumen
// ===========================================================================
async function renderResumen() {
  const el = viewEl('resumen');

  if (!app.campaignId) {
    el.innerHTML = newCampaignCard();
    bindNewCampaign();
    return;
  }

  el.innerHTML = '<div class="loading">Cargando resumen...</div>';
  const d = await get(`/api/campaigns/${app.campaignId}/dashboard`);
  app.dashboard = d;

  const c = d.campaign;
  const acc = d.accounts;
  const req = d.requests;
  const left = c.due_at ? daysUntil(c.due_at) : null;

  el.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center;">
        <div style="flex:1;">
          <h2>${esc(c.code)} &middot; ${esc(c.name)}</h2>
          <p class="hint" style="margin:4px 0 0 0;">
            Estado: ${tag('campaignStatus', c.status)}
            ${c.sent_at ? ` &middot; enviada el ${esc(fmtDateTime(c.sent_at))}` : ''}
            ${c.due_at ? ` &middot; vence el <strong>${esc(fmtDate(c.due_at))}</strong>${left !== null ? ` (${left >= 0 ? `quedan ${left} dias` : `vencida hace ${-left} dias`})` : ''}` : ''}
            &middot; plazo configurado: ${Number(c.response_days)} dias
          </p>
        </div>
      </div>

      <div class="grid cols-4" style="margin-top:16px;">
        <div class="kpi brand"><div class="value">${num(acc.total)}</div><div class="label">cuentas EXT detectadas</div></div>
        <div class="kpi ok"><div class="value">${num(acc.auto_assigned)}</div><div class="label">asignadas automaticamente</div></div>
        <div class="kpi warn"><div class="value">${num(acc.manual_review)}</div><div class="label">en revision manual</div></div>
        <div class="kpi danger"><div class="value">${num(acc.unassigned)}</div><div class="label">sin administrador</div></div>
      </div>

      <div class="grid cols-4" style="margin-top:12px;">
        <div class="kpi"><div class="value">${num(req.total)}</div><div class="label">solicitudes generadas</div></div>
        <div class="kpi ok"><div class="value">${num(req.responded)}</div><div class="label">respondidas (${d.responseRate}%)</div></div>
        <div class="kpi warn"><div class="value">${num(req.sent) + num(req.opened)}</div><div class="label">pendientes de respuesta</div></div>
        <div class="kpi danger"><div class="value">${num(req.expired)}</div><div class="label">vencidas</div></div>
      </div>

      <div class="grid cols-4" style="margin-top:12px;">
        <div class="kpi ok"><div class="value">${num(acc.keep_count)}</div><div class="label">cuentas a mantener</div></div>
        <div class="kpi danger"><div class="value">${num(acc.disable_count)}</div><div class="label">cuentas a dar de baja</div></div>
        <div class="kpi"><div class="value">${num(acc.excluded)}</div><div class="label">excluidas (ya inactivas en AD)</div></div>
        <div class="kpi warn"><div class="value">${num(acc.undecided)}</div><div class="label">sin decision</div></div>
      </div>

      ${num(req.failed) > 0 || num(d.emails.failed) > 0
        ? `<div class="alert danger" style="margin-top:16px;">Hay ${num(d.emails.failed)} envio(s) de correo con error. Revise la pestana <strong>Envios y seguimiento</strong>.</div>`
        : ''}
      ${num(acc.unassigned) > 0
        ? `<div class="alert warn" style="margin-top:16px;">${num(acc.unassigned)} cuenta(s) EXT no tienen administrador de contrato identificado.
           Estas cuentas <strong>no se dan de baja automaticamente</strong>: quedan en cola de revision manual.</div>`
        : ''}

      ${canOperate() ? `<div class="actions">
        <button id="btn-rebuild" class="secondary">Recalcular cruce empresa/administrador</button>
        <button id="btn-generate" class="secondary">Generar solicitudes de validacion</button>
        <button id="btn-send">Enviar correos a administradores</button>
        <button id="btn-close" class="danger secondary">Cerrar campana</button>
      </div>` : ''}
      <div class="actions">
        <button class="secondary small" data-export="bajas">Exportar cola de bajas (CSV)</button>
        <button class="secondary small" data-export="bajas.ps1">Script PowerShell de bajas</button>
        <button class="secondary small" data-export="completo">Export completo (CSV)</button>
        <button class="secondary small" data-export="sin-administrador">Cuentas sin administrador</button>
        <button class="secondary small" data-export="auditoria">Bitacora de auditoria</button>
      </div>
    </div>

    <div class="card">
      <h2>Distribucion por empresa</h2>
      <p class="hint">Una misma empresa puede tener varios administradores segun faena o contrato.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Empresa</th><th class="num">Cuentas</th><th class="num">Mantener</th><th class="num">Dar de baja</th><th class="num">Sin administrador</th></tr></thead>
        <tbody>${d.byCompany.map((r) => `<tr>
          <td>${esc(r.company_name || '(sin empresa normalizada)')}</td>
          <td class="num">${num(r.accounts)}</td>
          <td class="num">${num(r.keep_count)}</td>
          <td class="num">${num(r.disable_count)}</td>
          <td class="num">${num(r.without_admin) ? `<span class="tag danger">${num(r.without_admin)}</span>` : '0'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">Sin datos importados</td></tr>'}</tbody>
      </table></div>
    </div>

    ${newCampaignCard()}`;

  bindNewCampaign();
  el.querySelectorAll('[data-export]').forEach((b) => {
    b.addEventListener('click', () => {
      const kind = b.dataset.export;
      const ext = kind === 'bajas.ps1' ? 'ps1' : 'csv';
      download(`/api/campaigns/${app.campaignId}/export/${kind}`, `${kind.replace('.ps1', '')}_${c.code}.${ext}`).catch(showError);
    });
  });

  if (canOperate()) {
    $('#btn-rebuild').addEventListener('click', () => runAction('Recalculando cruce...', async () => {
      const r = await post(`/api/campaigns/${app.campaignId}/rebuild-assignments`, { force: false });
      toast(`Cruce recalculado: ${r.assignments.autoAssigned} automaticas, ${r.assignments.manualReview} en revision, ${r.assignments.unassigned} sin administrador`, 'ok');
    }));
    $('#btn-generate').addEventListener('click', () => runAction('Generando solicitudes...', async () => {
      const r = await post(`/api/campaigns/${app.campaignId}/generate-requests`, {});
      let msg = `${r.created} solicitud(es) creadas, ${r.updated} actualizadas. Vencen el ${fmtDate(r.dueAt)}.`;
      if (r.accountsWithoutAdministrator) msg += ` ${r.accountsWithoutAdministrator} cuenta(s) quedaron sin administrador.`;
      toast(msg, 'ok');
    }));
    $('#btn-send').addEventListener('click', () => confirmSend(d));
    $('#btn-close').addEventListener('click', () => {
      if (!confirm('Cerrar la campana congela todas las decisiones. Las cuentas sin respuesta quedaran marcadas para baja. Continuar?')) return;
      runAction('Cerrando campana...', async () => {
        await post(`/api/campaigns/${app.campaignId}/close`, {});
        await loadCampaigns();
        toast('Campana cerrada', 'ok');
      });
    });
  }
}

function confirmSend(d) {
  const pendientes = d.requestList.filter((r) => ['pending', 'failed'].includes(r.status));
  if (pendientes.length === 0) {
    if (!confirm('No hay solicitudes pendientes de envio. Desea reenviar a quienes aun no responden? Esto rota sus enlaces anteriores.')) return;
    runAction('Reenviando...', async () => {
      const r = await post(`/api/campaigns/${app.campaignId}/send`, { resend: true });
      toast(`Enviados: ${r.sent}. Errores: ${r.failed}. Omitidos: ${r.skipped}.`, r.failed ? 'error' : 'ok');
    });
    return;
  }
  if (!confirm(`Se enviaran ${pendientes.length} correo(s) a administradores de contrato. Continuar?`)) return;
  runAction('Enviando correos...', async () => {
    const r = await post(`/api/campaigns/${app.campaignId}/send`, {});
    toast(`Enviados: ${r.sent}. Errores: ${r.failed}. Omitidos: ${r.skipped}.`, r.failed ? 'error' : 'ok');
  });
}

function newCampaignCard() {
  if (!canOperate()) return '';
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `<div class="card">
      <h2>Nueva campana mensual</h2>
      <p class="hint">Se crea una campana por periodo (ano/mes). El plazo de respuesta por defecto es de 14 dias.</p>
      <div class="row">
        <div class="field"><label for="nc-year">Ano</label><input type="number" id="nc-year" value="${y}" min="2020" max="2100"></div>
        <div class="field"><label for="nc-month">Mes</label>
          <select id="nc-month">${MESES.map((name, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${name}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="nc-days">Dias de plazo</label><input type="number" id="nc-days" value="14" min="1" max="90"></div>
        <div class="field" style="flex:2 1 260px;"><label for="nc-notes">Notas (opcional)</label><input type="text" id="nc-notes" maxlength="200"></div>
        <button id="nc-create">Crear campana</button>
      </div>
    </div>`;
}

function bindNewCampaign() {
  const btn = $('#nc-create');
  if (!btn) return;
  btn.addEventListener('click', () => runAction('Creando campana...', async () => {
    const r = await post('/api/campaigns', {
      year: Number($('#nc-year').value),
      month: Number($('#nc-month').value),
      responseDays: Number($('#nc-days').value),
      notes: $('#nc-notes').value.trim() || undefined,
    });
    app.campaignId = r.campaign.id;
    localStorage.setItem('ext_audit_campaign', app.campaignId);
    await loadCampaigns();
    toast(`Campana ${r.campaign.code} creada`, 'ok');
  }));
}

// ===========================================================================
// Importar
// ===========================================================================
async function renderImportar() {
  const el = viewEl('importar');
  if (!requireCampaign(el)) return;
  const campaign = app.campaigns.find((c) => c.id === app.campaignId);

  el.innerHTML = `
    <div class="card">
      <h2>Importar planilla de AD Manager</h2>
      <p class="hint">Formatos aceptados: <strong>.csv</strong>, <strong>.tsv</strong> y <strong>.xlsx</strong> (maximo 15 MB).
        El sistema detecta las columnas automaticamente, filtra las cuentas <strong>EXT</strong> y guarda el archivo
        original como evidencia. Puede previsualizar antes de importar.</p>

      <div class="row">
        <div class="field" style="flex:2 1 320px;">
          <label for="file">Archivo exportado desde AD Manager</label>
          <input type="file" id="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm">
        </div>
        <button class="secondary" id="btn-preview">Previsualizar</button>
        <button id="btn-import" ${canOperate() ? '' : 'disabled'}>Importar a ${esc(campaign ? campaign.code : '')}</button>
      </div>
      <div id="preview"></div>
    </div>

    <div class="card">
      <h2>Importaciones de esta campana</h2>
      <div id="imports-list"><div class="loading">Cargando...</div></div>
    </div>`;

  $('#btn-preview').addEventListener('click', doPreview);
  $('#btn-import').addEventListener('click', doImport);

  const d = app.dashboard && app.dashboard.campaign.id === app.campaignId
    ? app.dashboard
    : await get(`/api/campaigns/${app.campaignId}/dashboard`);
  app.dashboard = d;
  $('#imports-list').innerHTML = d.imports.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Archivo</th><th class="num">Filas</th><th class="num">Cuentas EXT</th><th class="num">Duplicadas</th><th>Estado</th><th>SHA-256</th><th>Fecha</th></tr></thead>
        <tbody>${d.imports.map((i) => `<tr>
          <td>${esc(i.filename)}</td><td class="num">${num(i.row_count)}</td>
          <td class="num"><strong>${num(i.ext_count)}</strong></td><td class="num">${num(i.skipped_count)}</td>
          <td>${i.status === 'processed' ? '<span class="tag ok">Procesada</span>' : `<span class="tag danger">${esc(i.status)}</span>`}</td>
          <td class="mono" title="${esc(i.checksum || '')}">${esc(String(i.checksum || '').slice(0, 12))}...</td>
          <td>${esc(fmtDateTime(i.created_at))}</td>
        </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Aun no se ha importado ninguna planilla en esta campana.</div>';
}

function selectedFile() {
  const f = $('#file').files[0];
  if (!f) { toast('Seleccione un archivo', 'error'); return null; }
  return f;
}

async function doPreview() {
  const file = selectedFile();
  if (!file) return;
  const box = $('#preview');
  box.innerHTML = '<div class="loading">Analizando archivo...</div>';
  try {
    const p = await upload('/api/imports/preview', file);
    box.innerHTML = `
      <div class="alert info" style="margin-top:16px;">
        <strong>${num(p.extCount)} cuenta(s) EXT</strong> detectadas de ${num(p.rowCount)} filas.
        ${p.withoutCompany ? ` ${num(p.withoutCompany)} sin empresa.` : ''}
        ${p.withoutManager ? ` ${num(p.withoutManager)} sin administrador en origen.` : ''}
      </div>
      <div class="grid cols-2">
        <div>
          <h3>Columnas reconocidas</h3>
          <div class="table-wrap"><table><thead><tr><th>Cabecera origen</th><th>Campo canonico</th></tr></thead>
            <tbody>${Object.entries(p.columnMap).map(([h, f]) => `<tr><td>${esc(h)}</td><td class="mono">${esc(f)}</td></tr>`).join('')}</tbody>
          </table></div>
          ${p.unmappedHeaders.length ? `<p class="hint" style="margin-top:8px;">Columnas ignoradas: ${p.unmappedHeaders.map(esc).join(', ')}</p>` : ''}
        </div>
        <div>
          <h3>Empresas detectadas (top 10)</h3>
          <div class="table-wrap"><table><thead><tr><th>Empresa en origen</th><th class="num">Cuentas</th></tr></thead>
            <tbody>${p.companies.slice(0, 10).map((c) => `<tr><td>${esc(c.value)}</td><td class="num">${num(c.count)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
      <h3>Muestra de cuentas EXT</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Cuenta</th><th>Nombre</th><th>Empresa</th><th>Administrador origen</th><th>Faena</th><th>Estado AD</th><th>Regla EXT</th></tr></thead>
        <tbody>${p.sample.map((r) => `<tr>
          <td class="mono">${esc(r.samAccountName)}</td><td>${esc(r.displayName || '')}</td>
          <td>${esc(r.company || '')}</td><td>${esc(r.manager || '')}${r.managerEmail ? `<div style="color:#63788a;font-size:12px;">${esc(r.managerEmail)}</div>` : ''}</td>
          <td>${esc(r.site || '')}</td><td>${tag('sourceState', r.sourceState)}</td><td class="mono">${esc(r.extReason || '')}</td>
        </tr>`).join('')}</tbody></table></div>`;
  } catch (err) {
    box.innerHTML = `<div class="alert danger" style="margin-top:16px;">${esc(err.message)}</div>`;
  }
}

async function doImport() {
  const file = selectedFile();
  if (!file) return;
  if (!confirm(`Importar "${file.name}" a la campana seleccionada?`)) return;
  await runAction('Importando y cruzando datos...', async () => {
    const r = await upload(`/api/campaigns/${app.campaignId}/import`, file);
    const a = r.assignments;
    toast(`Importadas ${r.import.extCount} cuentas EXT. Cruce: ${a.autoAssigned} automaticas, ${a.manualReview} en revision, ${a.unassigned} sin administrador.`, 'ok');
  });
}

// ===========================================================================
// Cuentas
// ===========================================================================
async function renderCuentas() {
  const el = viewEl('cuentas');
  if (!requireCampaign(el)) return;

  if (!app.companies.length) app.companies = (await get('/api/companies', { limit: 500 })).companies;
  if (!app.administrators.length) app.administrators = (await get('/api/administrators', { limit: 500 })).administrators;

  el.innerHTML = `
    <div class="card">
      <h2>Cuentas EXT de la campana</h2>
      <p class="hint">Corrija aqui las asignaciones que el cruce automatico no resolvio o resolvio mal.</p>
      <div class="row">
        <div class="field"><label>Buscar</label><input type="text" id="f-search" placeholder="cuenta, nombre, empresa..."></div>
        <div class="field"><label>Empresa</label><select id="f-company"><option value="">Todas</option>${app.companies.map((c) => `<option value="${esc(c.id)}">${esc(c.canonical_name)}</option>`).join('')}</select></div>
        <div class="field"><label>Estado de revision</label><select id="f-review"><option value="">Todos</option>${Object.entries(LABELS.reviewStatus).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label>Decision</label><select id="f-decision"><option value="">Todas</option><option value="keep">Mantener activa</option><option value="disable">Dar de baja</option></select></div>
        <div class="field"><label>Estado solicitud</label><select id="f-request"><option value="">Todos</option>${Object.entries(LABELS.requestStatus).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label>&nbsp;</label><label style="font-weight:400;font-size:13px;color:#1c2733;"><input type="checkbox" id="f-overdue" style="width:auto;margin-right:6px;">Solo vencidas</label></div>
        <button class="secondary" id="f-apply">Filtrar</button>
      </div>
      <div id="accounts-table"><div class="loading">Cargando cuentas...</div></div>
    </div>`;

  const apply = () => loadAccounts();
  $('#f-apply').addEventListener('click', apply);
  $('#f-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  ['f-company', 'f-review', 'f-decision', 'f-request', 'f-overdue'].forEach((id) => $(`#${id}`).addEventListener('change', apply));
  await loadAccounts();
}

async function loadAccounts() {
  const box = $('#accounts-table');
  if (!box) return;
  box.innerHTML = '<div class="loading">Cargando cuentas...</div>';

  const query = {
    search: $('#f-search').value.trim(),
    companyId: $('#f-company').value,
    reviewStatus: $('#f-review').value,
    decision: $('#f-decision').value,
    requestStatus: $('#f-request').value,
    overdue: $('#f-overdue').checked ? 'true' : '',
    limit: 300,
  };
  const r = await get(`/api/campaigns/${app.campaignId}/accounts`, query);

  box.innerHTML = `
    <p class="hint">Mostrando ${r.rows.length} de ${num(r.total)} cuenta(s).</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Cuenta</th><th>Nombre</th><th>Empresa (origen / normalizada)</th><th>Administrador</th>
        <th>Contrato</th><th>Estado AD</th><th>Revision</th><th>Solicitud</th><th>Decision</th><th>Regla</th><th></th>
      </tr></thead>
      <tbody>${r.rows.map(accountRow).join('') || '<tr><td colspan="11" class="empty">Sin resultados con los filtros aplicados</td></tr>'}</tbody>
    </table></div>`;

  box.querySelectorAll('[data-reassign]').forEach((b) => {
    b.addEventListener('click', () => openReassignModal(b.dataset.reassign));
  });
}

function accountRow(r) {
  return `<tr>
    <td class="mono">${esc(r.sam_account_name)}</td>
    <td>${esc(r.display_name || '')}<div style="color:#63788a;font-size:12px;">${esc(r.upn || r.email || '')}</div></td>
    <td>${esc(r.company_raw || '')}<div style="color:#63788a;font-size:12px;">${esc(r.company_name || 'sin normalizar')}</div></td>
    <td>${r.administrator_name ? `${esc(r.administrator_name)}<div style="color:#63788a;font-size:12px;">${esc(r.administrator_email || '')}${r.administrator_site ? ' &middot; ' + esc(r.administrator_site) : ''}</div>` : '<span class="tag danger">Sin administrador</span>'}</td>
    <td>${esc(r.contract_number || '')}</td>
    <td>${tag('sourceState', r.source_state)}</td>
    <td>${tag('reviewStatus', r.review_status)}</td>
    <td>${tag('requestStatus', r.request_status)}${r.request_due_at ? `<div style="color:#63788a;font-size:12px;">vence ${esc(fmtDate(r.request_due_at))}</div>` : ''}</td>
    <td>${tag('decision', r.final_decision)}${r.decision_source ? `<div style="color:#63788a;font-size:12px;">${esc(LABELS.decisionSource[r.decision_source] || '')}</div>` : ''}</td>
    <td style="max-width:220px;"><span class="mono" style="font-size:11.5px;color:#63788a;">${esc(String(r.match_rule || '').slice(0, 70))}</span></td>
    <td>${canOperate() ? `<button class="secondary small" data-reassign="${esc(r.assignment_id)}">Editar</button>` : ''}</td>
  </tr>`;
}

function openReassignModal(assignmentId) {
  const companies = app.companies;
  openModal(`
    <h3>Reasignar cuenta</h3>
    <div class="field"><label for="m-company">Empresa</label>
      <select id="m-company"><option value="">(sin empresa)</option>${companies.map((c) => `<option value="${esc(c.id)}">${esc(c.canonical_name)}</option>`).join('')}</select></div>
    <div class="field"><label for="m-admin">Administrador de contrato</label>
      <select id="m-admin"><option value="">(sin administrador - queda en revision manual)</option></select></div>
    <div class="row">
      <div class="field"><label for="m-contract">N de contrato</label><input type="text" id="m-contract" maxlength="80"></div>
      <div class="field"><label for="m-site">Faena / sede</label><input type="text" id="m-site" maxlength="120"></div>
    </div>
    <div class="actions">
      <button id="m-save">Guardar</button>
      <button class="secondary" id="m-cancel">Cancelar</button>
    </div>`, () => {
    const companySel = $('#m-company');
    const adminSel = $('#m-admin');

    const fillAdmins = () => {
      const list = app.administrators.filter((a) => !companySel.value || a.company_id === companySel.value);
      adminSel.innerHTML = '<option value="">(sin administrador - queda en revision manual)</option>' +
        list.map((a) => `<option value="${esc(a.id)}">${esc(a.full_name)}${a.site ? ' - ' + esc(a.site) : ''} (${esc(a.email)})</option>`).join('');
    };
    companySel.addEventListener('change', fillAdmins);
    fillAdmins();

    $('#m-cancel').addEventListener('click', closeModal);
    $('#m-save').addEventListener('click', () => runAction('Guardando...', async () => {
      await patch(`/api/assignments/${assignmentId}`, {
        companyId: companySel.value || null,
        administratorId: adminSel.value || null,
        contractNumber: $('#m-contract').value.trim() || null,
        site: $('#m-site').value.trim() || null,
        reviewStatus: adminSel.value ? 'confirmed' : 'unassigned',
      });
      closeModal();
      toast('Asignacion actualizada', 'ok');
      await loadAccounts();
    }, false));
  });
}

// ===========================================================================
// Envios y seguimiento
// ===========================================================================
async function renderEnvios() {
  const el = viewEl('envios');
  if (!requireCampaign(el)) return;
  el.innerHTML = '<div class="loading">Cargando seguimiento...</div>';

  const d = await get(`/api/campaigns/${app.campaignId}/dashboard`);
  app.dashboard = d;
  const { emails } = await get('/api/emails', { campaignId: app.campaignId, limit: 200 });

  el.innerHTML = `
    <div class="card">
      <h2>Solicitudes por administrador de contrato</h2>
      <p class="hint">Un correo por administrador. Reenviar rota el enlace: el anterior deja de funcionar.</p>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Administrador</th><th>Empresa / faena</th><th class="num">Cuentas</th><th>Estado</th>
          <th>Enviado</th><th>Vence</th><th>Aperturas</th><th>Respondido</th><th>Recordatorios</th><th></th>
        </tr></thead>
        <tbody>${d.requestList.map(requestRow).join('') || '<tr><td colspan="10" class="empty">Aun no se han generado solicitudes</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>Registro de correos</h2>
      <p class="hint">Cada envio deja estado, fecha, destinatario, copia a mesa de ayuda e identificador del proveedor.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Destinatario</th><th>Copia</th><th>Asunto</th><th>Proveedor</th><th>Estado</th><th>Detalle</th></tr></thead>
        <tbody>${emails.map((e) => `<tr>
          <td style="white-space:nowrap;">${esc(fmtDateTime(e.created_at))}</td>
          <td>${esc({ invitation: 'Invitacion', reminder: 'Recordatorio', expiry_notice: 'Aviso de vencimiento', confirmation: 'Confirmacion', internal_summary: 'Resumen interno' }[e.kind] || e.kind)}</td>
          <td>${esc(e.to_email)}</td><td>${esc(e.cc_email || '')}</td>
          <td style="max-width:280px;">${esc(e.subject)}</td>
          <td class="mono" style="font-size:12px;">${esc(e.provider)}</td>
          <td>${e.status === 'sent' ? '<span class="tag ok">Enviado</span>' : e.status === 'failed' ? '<span class="tag danger">Error</span>' : '<span class="tag muted">En cola</span>'}</td>
          <td style="max-width:260px;color:#b03a2e;font-size:12px;">${esc(e.error || '')}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty">Sin correos registrados</td></tr>'}</tbody>
      </table></div>
    </div>`;

  el.querySelectorAll('[data-resend]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!confirm('Reenviar el enlace a este administrador? El enlace anterior dejara de funcionar.')) return;
      runAction('Reenviando...', async () => {
        const r = await post(`/api/requests/${b.dataset.resend}/resend`, {});
        toast(r.sent ? 'Correo reenviado' : `No se pudo reenviar: ${r.results?.[0]?.error || 'error desconocido'}`, r.sent ? 'ok' : 'error');
      });
    });
  });
}

function requestRow(r) {
  const left = r.due_at ? daysUntil(r.due_at) : null;
  const overdue = left !== null && left < 0 && r.status !== 'responded';
  return `<tr>
    <td>${esc(r.administrator_name)}<div style="color:#63788a;font-size:12px;">${esc(r.administrator_email)}</div></td>
    <td>${esc(r.company_name)}${r.site ? `<div style="color:#63788a;font-size:12px;">${esc(r.site)}</div>` : ''}</td>
    <td class="num">${num(r.accounts_count)}</td>
    <td>${tag('requestStatus', r.status)}${num(r.failed_emails) ? ` <span class="tag danger">${num(r.failed_emails)} error(es)</span>` : ''}</td>
    <td style="white-space:nowrap;">${esc(fmtDateTime(r.sent_at))}</td>
    <td style="white-space:nowrap;">${esc(fmtDate(r.due_at))}${overdue ? `<div class="tag danger">vencida hace ${-left} d</div>` : left !== null && r.status !== 'responded' ? `<div style="color:#63788a;font-size:12px;">quedan ${left} d</div>` : ''}</td>
    <td class="num">${num(r.open_count)}</td>
    <td style="white-space:nowrap;">${esc(fmtDateTime(r.responded_at))}</td>
    <td class="num">${num(r.reminder_count)}</td>
    <td>${canOperate() && r.status !== 'responded' ? `<button class="secondary small" data-resend="${esc(r.id)}">Reenviar</button>` : ''}</td>
  </tr>`;
}

// ===========================================================================
// Empresas
// ===========================================================================
async function renderEmpresas() {
  const el = viewEl('empresas');
  el.innerHTML = '<div class="loading">Cargando empresas...</div>';
  const [{ companies }, { duplicates }] = await Promise.all([
    get('/api/companies', { limit: 500 }),
    get('/api/companies/duplicates'),
  ]);
  app.companies = companies;

  el.innerHTML = `
    ${duplicates.length ? `<div class="card">
      <h2>Posibles duplicados detectados</h2>
      <p class="hint">Nombres muy similares que probablemente corresponden a la misma empresa. Fusionar conserva
        el nombre origen como alias, de modo que futuras importaciones se resuelvan solas.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Empresa A</th><th class="num">Cuentas</th><th>Empresa B</th><th class="num">Cuentas</th><th class="num">Similitud</th><th></th></tr></thead>
        <tbody>${duplicates.map((p) => `<tr>
          <td>${esc(p.a.canonical_name)}</td><td class="num">${num(p.a.accounts_count)}</td>
          <td>${esc(p.b.canonical_name)}</td><td class="num">${num(p.b.accounts_count)}</td>
          <td class="num">${Math.round(p.score * 100)}%</td>
          <td>${canOperate() ? `<button class="secondary small" data-merge-from="${esc(p.b.id)}" data-merge-to="${esc(p.a.id)}" data-from-name="${esc(p.b.canonical_name)}" data-to-name="${esc(p.a.canonical_name)}">Fusionar B en A</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}

    <div class="card">
      <h2>Empresas (${companies.length})</h2>
      ${canOperate() ? `<div class="row" style="margin-bottom:14px;">
        <div class="field" style="flex:2 1 260px;"><label for="co-name">Nueva empresa</label><input type="text" id="co-name" maxlength="200" placeholder="Razon social"></div>
        <div class="field"><label for="co-rut">RUT (opcional)</label><input type="text" id="co-rut" maxlength="20"></div>
        <button id="co-create">Agregar</button>
      </div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Empresa</th><th>Clave normalizada</th><th class="num">Administradores</th><th class="num">Alias</th><th class="num">Cuentas</th><th></th></tr></thead>
        <tbody>${companies.map((c) => `<tr>
          <td>${esc(c.canonical_name)}${c.tax_id ? `<div style="color:#63788a;font-size:12px;">${esc(c.tax_id)}</div>` : ''}</td>
          <td class="mono" style="font-size:12px;color:#63788a;">${esc(c.normalized_key)}</td>
          <td class="num">${num(c.admins_count) || '<span class="tag danger">0</span>'}</td>
          <td class="num">${num(c.aliases_count)}</td>
          <td class="num">${num(c.accounts_count)}</td>
          <td>${canOperate() ? `<button class="secondary small" data-alias="${esc(c.id)}" data-name="${esc(c.canonical_name)}">Agregar alias</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">Aun no hay empresas. Se crean solas al importar la primera planilla.</td></tr>'}</tbody>
      </table></div>
    </div>`;

  if (canOperate()) {
    const createBtn = $('#co-create');
    if (createBtn) createBtn.addEventListener('click', () => runAction('Creando...', async () => {
      await post('/api/companies', { name: $('#co-name').value.trim(), taxId: $('#co-rut').value.trim() || undefined });
      app.companies = [];
      toast('Empresa creada', 'ok');
    }));

    el.querySelectorAll('[data-merge-from]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm(`Fusionar "${b.dataset.fromName}" dentro de "${b.dataset.toName}"?\n\nSe reasignaran sus administradores, alias y cuentas. La operacion queda en la bitacora.`)) return;
      runAction('Fusionando...', async () => {
        await post(`/api/companies/${b.dataset.mergeFrom}/merge`, { targetId: b.dataset.mergeTo });
        app.companies = [];
        toast('Empresas fusionadas', 'ok');
      });
    }));

    el.querySelectorAll('[data-alias]').forEach((b) => b.addEventListener('click', () => {
      const alias = prompt(`Nuevo alias para "${b.dataset.name}":\n\nEjemplo: como aparece escrito en la planilla de AD Manager.`);
      if (!alias || !alias.trim()) return;
      runAction('Guardando alias...', async () => {
        await post(`/api/companies/${b.dataset.alias}/aliases`, { alias: alias.trim() });
        toast('Alias agregado', 'ok');
      });
    }));
  }
}

// ===========================================================================
// Administradores de contrato
// ===========================================================================
async function renderAdministradores() {
  const el = viewEl('administradores');
  el.innerHTML = '<div class="loading">Cargando administradores...</div>';
  const [{ administrators }, { companies }] = await Promise.all([
    get('/api/administrators', { limit: 500 }),
    get('/api/companies', { limit: 500 }),
  ]);
  app.administrators = administrators;
  app.companies = companies;

  el.innerHTML = `
    ${canOperate() ? `<div class="card">
      <h2>Nuevo administrador de contrato</h2>
      <p class="hint">Una empresa puede tener varios administradores segun faena o contrato
        (por ejemplo Mantos Blancos, Mantoverde o Santiago). El administrador <em>por defecto</em>
        se usa cuando el cruce no logra desambiguar.</p>
      <div class="row">
        <div class="field" style="flex:2 1 220px;"><label for="ad-company">Empresa</label>
          <select id="ad-company">${companies.map((c) => `<option value="${esc(c.id)}">${esc(c.canonical_name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ad-name">Nombre completo</label><input type="text" id="ad-name" maxlength="150"></div>
        <div class="field"><label for="ad-email">Correo</label><input type="email" id="ad-email" maxlength="254"></div>
        <div class="field"><label for="ad-site">Faena / sede</label><input type="text" id="ad-site" maxlength="120" placeholder="Mantos Blancos"></div>
        <div class="field"><label for="ad-contract">N contrato</label><input type="text" id="ad-contract" maxlength="80"></div>
        <div class="field"><label for="ad-to">Vigencia hasta</label><input type="date" id="ad-to"></div>
        <div class="field"><label>&nbsp;</label><label style="font-weight:400;font-size:13px;color:#1c2733;"><input type="checkbox" id="ad-default" style="width:auto;margin-right:6px;">Por defecto</label></div>
        <button id="ad-create">Agregar</button>
      </div>
    </div>` : ''}

    <div class="card">
      <h2>Administradores de contrato (${administrators.length})</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Empresa</th><th>Nombre</th><th>Correo</th><th>Faena</th><th>Contrato</th><th>Vigencia</th><th>Por defecto</th><th></th></tr></thead>
        <tbody>${administrators.map((a) => `<tr>
          <td>${esc(a.company_name)}</td><td>${esc(a.full_name)}</td><td>${esc(a.email)}</td>
          <td>${esc(a.site || '')}</td><td>${esc(a.contract_number || '')}</td>
          <td>${esc(fmtDate(a.contract_valid_to))}</td>
          <td>${a.is_default ? '<span class="tag info">Si</span>' : ''}</td>
          <td>${canOperate() ? `<button class="secondary small" data-deactivate="${esc(a.id)}" data-name="${esc(a.full_name)}">Desactivar</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty">Aun no hay administradores registrados</td></tr>'}</tbody>
      </table></div>
    </div>`;

  if (canOperate()) {
    $('#ad-create').addEventListener('click', () => runAction('Creando...', async () => {
      await post('/api/administrators', {
        companyId: $('#ad-company').value,
        fullName: $('#ad-name').value.trim(),
        email: $('#ad-email').value.trim(),
        site: $('#ad-site').value.trim() || undefined,
        contractNumber: $('#ad-contract').value.trim() || undefined,
        contractValidTo: $('#ad-to').value || undefined,
        isDefault: $('#ad-default').checked,
      });
      app.administrators = [];
      toast('Administrador agregado', 'ok');
    }));

    el.querySelectorAll('[data-deactivate]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm(`Desactivar a "${b.dataset.name}"? Dejara de recibir campanas, pero su historial se conserva.`)) return;
      runAction('Desactivando...', async () => {
        await del(`/api/administrators/${b.dataset.deactivate}`);
        app.administrators = [];
        toast('Administrador desactivado', 'ok');
      });
    }));
  }
}

// ===========================================================================
// Auditoria
// ===========================================================================
async function renderAuditoria() {
  const el = viewEl('auditoria');
  el.innerHTML = `
    <div class="card">
      <h2>Bitacora de auditoria</h2>
      <p class="hint">Registro inmutable de todo lo ocurrido: importaciones, reasignaciones, envios,
        aperturas del portal, respuestas de administradores y vencimientos automaticos.</p>
      <div class="row">
        <div class="field"><label>Origen</label><select id="a-actor"><option value="">Todos</option>
          <option value="internal_user">Usuario interno</option><option value="external_admin">Administrador externo</option>
          <option value="system">Sistema (cron)</option></select></div>
        <div class="field"><label>Desde</label><input type="date" id="a-from"></div>
        <div class="field"><label>Hasta</label><input type="date" id="a-to"></div>
        <div class="field"><label>&nbsp;</label><label style="font-weight:400;font-size:13px;color:#1c2733;"><input type="checkbox" id="a-campaign" style="width:auto;margin-right:6px;" checked>Solo campana actual</label></div>
        <button class="secondary" id="a-apply">Filtrar</button>
        <button class="secondary" id="a-export">Exportar CSV</button>
      </div>
      <div id="audit-table"><div class="loading">Cargando...</div></div>
    </div>`;

  $('#a-apply').addEventListener('click', loadAudit);
  $('#a-export').addEventListener('click', () => {
    if (!app.campaignId) return toast('Seleccione una campana', 'error');
    const code = app.campaigns.find((c) => c.id === app.campaignId)?.code || 'campana';
    download(`/api/campaigns/${app.campaignId}/export/auditoria`, `bitacora_${code}.csv`).catch(showError);
  });
  await loadAudit();
}

async function loadAudit() {
  const box = $('#audit-table');
  box.innerHTML = '<div class="loading">Cargando...</div>';
  const r = await get('/api/audit', {
    campaignId: $('#a-campaign').checked ? app.campaignId : '',
    actorType: $('#a-actor').value,
    from: $('#a-from').value,
    to: $('#a-to').value,
    limit: 300,
  });

  box.innerHTML = `
    <p class="hint">Mostrando ${r.events.length} de ${num(r.total)} evento(s).</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Origen</th><th>Actor</th><th>Accion</th><th>Entidad</th><th>Detalle</th></tr></thead>
      <tbody>${r.events.map((e) => `<tr>
        <td style="white-space:nowrap;">${esc(fmtDateTime(e.created_at))}</td>
        <td>${esc({ internal_user: 'Interno', external_admin: 'Externo', system: 'Sistema' }[e.actor_type] || e.actor_type)}</td>
        <td>${esc(e.actor_label || e.actor_id || '')}</td>
        <td class="mono" style="font-size:12px;">${esc(e.action)}</td>
        <td class="mono" style="font-size:12px;color:#63788a;">${esc(e.entity_type || '')}</td>
        <td style="max-width:420px;"><span class="mono" style="font-size:11.5px;color:#63788a;">${esc(String(e.after_json || e.before_json || '').slice(0, 240))}</span></td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">Sin eventos registrados</td></tr>'}</tbody>
    </table></div>`;
}

// ===========================================================================
// Configuracion
// ===========================================================================
async function renderConfig() {
  const el = viewEl('config');
  el.innerHTML = '<div class="loading">Cargando configuracion...</div>';
  const s = await get('/api/settings');

  el.innerHTML = `
    <div class="card">
      <h2>Estado del envio de correo</h2>
      <div class="${s.mail.ready ? 'alert ok' : 'alert danger'}">
        <strong>Proveedor: ${esc(s.mail.provider)}</strong>
        ${s.mail.ready ? ' &mdash; configuracion completa.' : ''}
        ${s.mail.issues.length ? `<ul>${s.mail.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="table-wrap"><table>
        <tbody>
          <tr><th style="width:220px;">Remitente</th><td>${esc(s.mail.from || '(sin definir)')}</td></tr>
          <tr><th>Nombre visible</th><td>${esc(s.mail.fromName || '')}</td></tr>
          <tr><th>Responder a</th><td>${esc(s.mail.replyTo || '')}</td></tr>
          <tr><th>Copia a mesa de ayuda</th><td>${esc(s.mail.ccHelpdesk || '(sin copia)')}</td></tr>
        </tbody>
      </table></div>
      <p class="hint" style="margin-top:12px;">El remitente se cambia con la variable de entorno <span class="mono">MAIL_FROM</span>
        (y <span class="mono">GOOGLE_IMPERSONATE_USER</span> en modo service account). No requiere cambios de codigo.</p>
    </div>

    <div class="card">
      <h2>Parametros del proceso</h2>
      <div class="table-wrap"><table>
        <tbody>
          <tr><th style="width:280px;">URL base de la aplicacion</th><td class="mono">${esc(s.runtime.appBaseUrl)}</td></tr>
          <tr><th>Plazo de respuesta (dias)</th><td>${num(s.runtime.responseDays)}</td></tr>
          <tr><th>Recordatorios (dias antes del vencimiento)</th><td>${esc(s.runtime.reminderDays)}</td></tr>
          <tr><th>Gracia del token tras el vencimiento (dias)</th><td>${num(s.runtime.tokenGraceDays)}</td></tr>
          <tr><th>Modo de deteccion EXT</th><td>${esc(s.runtime.extMatchMode)} ${s.runtime.extMatchMode === 'token' ? '(EXT como token delimitado: evita falsos positivos)' : '(cualquier aparicion de EXT)'}</td></tr>
        </tbody>
      </table></div>
      ${canAdmin() ? `<div class="actions">
        <button class="secondary" id="cfg-reminders">Ejecutar recordatorios ahora</button>
        <button class="secondary" id="cfg-expire">Ejecutar vencimientos ahora</button>
        <button class="secondary" id="cfg-daily">Ejecutar rutina diaria completa</button>
      </div>
      <p class="hint" style="margin-top:8px;">La rutina diaria se ejecuta automaticamente por Cron Trigger.
        Estos botones sirven para reprocesar o para verificar el comportamiento en pruebas.</p>` : ''}
    </div>

    <div class="card">
      <h2>Mi cuenta</h2>
      <div class="row">
        <div class="field"><label for="pw-current">Contrasena actual</label><input type="password" id="pw-current" autocomplete="current-password"></div>
        <div class="field"><label for="pw-new">Nueva contrasena</label><input type="password" id="pw-new" autocomplete="new-password"></div>
        <button id="pw-save">Cambiar contrasena</button>
      </div>
      <p class="hint" style="margin-top:8px;">Minimo 12 caracteres, combinando al menos 3 de: minusculas, mayusculas, numeros y simbolos.</p>
    </div>`;

  if (canAdmin()) {
    $('#cfg-reminders').addEventListener('click', () => runAction('Enviando recordatorios...', async () => {
      const r = await post('/api/jobs/reminders', {});
      toast(`${r.sent} recordatorio(s) enviados`, 'ok');
    }, false));
    $('#cfg-expire').addEventListener('click', () => runAction('Procesando vencimientos...', async () => {
      const r = await post('/api/jobs/expire', {});
      toast(`${r.expiredRequests} solicitud(es) vencidas, ${r.accountsMarked} cuenta(s) marcadas para baja`, 'ok');
    }, false));
    $('#cfg-daily').addEventListener('click', () => runAction('Ejecutando rutina diaria...', async () => {
      const r = await post('/api/jobs/daily', {});
      toast(`Rutina completa: ${r.reminders.length} recordatorios, ${r.expiry.expiredRequests} vencimientos`, 'ok');
    }, false));
  }

  $('#pw-save').addEventListener('click', () => runAction('Cambiando contrasena...', async () => {
    await post('/api/auth/password', {
      currentPassword: $('#pw-current').value,
      newPassword: $('#pw-new').value,
    });
    $('#pw-current').value = '';
    $('#pw-new').value = '';
    toast('Contrasena actualizada', 'ok');
  }, false));
}

// ===========================================================================
// Utilidades de UI
// ===========================================================================
function num(v) {
  return Number(v || 0);
}

/**
 * Ejecuta una accion mostrando estado y refrescando la vista al terminar.
 * @param {string} label @param {() => Promise<void>} fn @param {boolean} refresh
 */
async function runAction(label, fn, refresh = true) {
  const alertBox = $('#global-alert');
  alertBox.innerHTML = `<div class="alert info">${esc(label)}</div>`;
  try {
    await fn();
    alertBox.innerHTML = '';
    if (refresh) refreshView();
  } catch (err) {
    alertBox.innerHTML = '';
    showError(err);
  }
}

function openModal(html, onMount) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  if (onMount) onMount();
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}
