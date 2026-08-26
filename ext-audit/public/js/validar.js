/**
 * Portal de validacion para administradores de contrato externos.
 *
 * Objetivo de UX: una sola pantalla, una tabla, dos decisiones por fila, y la
 * fecha limite siempre visible. Nada de menus ni navegacion.
 */
import { get, post, esc, fmtDate, fmtDateTime, daysUntil, toast, MESES, ApiError } from './api.js';

const token = new URLSearchParams(location.search).get('t') || '';
const content = document.getElementById('content');
const titleEl = document.getElementById('title');
const subtitleEl = document.getElementById('subtitle');

/** @type {any} */
let data = null;
/** @type {Map<string, {decision:string|null, contractNumber:string, contractValidTo:string, workerEndDate:string, comment:string}>} */
const state = new Map();

init();

async function init() {
  if (!token) {
    renderNotice('danger', 'Enlace invalido', 'El enlace no contiene un identificador de validacion. Solicite el reenvio a la mesa de ayuda.');
    return;
  }
  try {
    data = await get(`/api/portal/${encodeURIComponent(token)}`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'No fue posible conectar con el servidor';
    renderNotice('danger', 'No pudimos abrir su validacion', msg);
    return;
  }

  titleEl.textContent = `Cuentas externas de ${data.company.name}`;
  subtitleEl.textContent =
    `${data.administrator.name}${data.administrator.site ? ' - ' + data.administrator.site : ''} · ` +
    `Campana ${data.campaign.code} (${MESES[data.campaign.month - 1]} ${data.campaign.year})`;

  for (const a of data.accounts) {
    state.set(a.assignmentId, {
      decision: a.decision || null,
      contractNumber: a.contractNumber || data.defaultContractNumber || '',
      contractValidTo: a.contractValidTo ? a.contractValidTo.slice(0, 10) : '',
      workerEndDate: a.workerEndDate ? a.workerEndDate.slice(0, 10) : '',
      comment: a.comment || '',
    });
  }

  if (data.state === 'responded') return renderResponded();
  if (data.state === 'expired') return renderExpired();
  if (data.state === 'cancelled' || data.state === 'closed') {
    return renderNotice('warn', 'Validacion no disponible',
      'Esta campana fue cerrada. Si necesita corregir alguna cuenta, contacte a la mesa de ayuda.');
  }
  renderForm();
}

// --- Pantallas de estado ----------------------------------------------------

function renderNotice(kind, heading, message) {
  content.innerHTML = `<div class="card">
      <div class="alert ${kind}"><strong>${esc(heading)}</strong><div style="margin-top:5px;">${esc(message)}</div></div>
    </div>`;
}

function renderResponded() {
  const keep = data.accounts.filter((a) => a.decision === 'keep').length;
  const disable = data.accounts.filter((a) => a.decision === 'disable').length;
  content.innerHTML = `
    <div class="card">
      <div class="alert ok">
        <strong>Validacion registrada</strong>
        <div style="margin-top:5px;">Recibimos su respuesta el ${esc(fmtDateTime(data.request.respondedAt))} h.
        No es necesario hacer nada mas.</div>
      </div>
      <div class="grid cols-2" style="margin-top:14px;">
        <div class="kpi ok"><div class="value">${keep}</div><div class="label">cuentas se mantienen activas</div></div>
        <div class="kpi danger"><div class="value">${disable}</div><div class="label">cuentas se daran de baja</div></div>
      </div>
      <h3>Detalle de lo informado</h3>
      ${readOnlyTable()}
      <p class="hint" style="margin-top:14px;">Si detecta un error, responda el correo de confirmacion antes del cierre de la campana.</p>
    </div>`;
}

function renderExpired() {
  content.innerHTML = `
    <div class="card">
      <div class="alert danger">
        <strong>El plazo de validacion vencio el ${esc(fmtDate(data.request.dueAt))}</strong>
        <div style="margin-top:5px;">Segun la politica de auditoria, las cuentas sin confirmacion quedaron
        marcadas para deshabilitacion. Si alguna debe mantenerse activa, contacte a la mesa de ayuda
        indicando la campana <strong>${esc(data.campaign.code)}</strong>.</div>
      </div>
      <h3>Cuentas asociadas</h3>
      ${readOnlyTable()}
    </div>`;
}

function readOnlyTable() {
  const rows = data.accounts.map((a) => `<tr>
      <td class="mono">${esc(a.samAccountName)}</td>
      <td>${esc(a.displayName || '')}</td>
      <td>${esc(a.department || '')}</td>
      <td>${a.decision === 'keep' ? '<span class="tag ok">Mantener activa</span>'
            : a.decision === 'disable' ? '<span class="tag danger">Dar de baja</span>'
            : '<span class="tag muted">Sin respuesta</span>'}</td>
      <td>${esc(a.contractNumber || '')}</td>
      <td>${esc(fmtDate(a.workerEndDate))}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table>
      <thead><tr><th>Cuenta</th><th>Nombre</th><th>Area</th><th>Decision</th><th>Contrato</th><th>Termino trabajador</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

// --- Formulario principal ---------------------------------------------------

function renderForm() {
  const left = daysUntil(data.request.dueAt);
  const urgent = left !== null && left <= 3;

  content.innerHTML = `
    <div class="deadline ${urgent ? 'urgent' : ''}">
      Fecha limite de respuesta: <strong>${esc(fmtDate(data.request.dueAt))}</strong>
      ${left !== null ? `(${left > 1 ? `quedan ${left} dias` : left === 1 ? 'queda 1 dia' : left === 0 ? 'vence hoy' : 'plazo vencido'})` : ''}
      <div style="margin-top:5px;font-size:13.5px;">
        Las cuentas que no sean confirmadas dentro del plazo quedaran marcadas para deshabilitacion.
      </div>
    </div>

    <div class="card">
      <h2>Datos del contrato</h2>
      <p class="hint">Aplican a todas las cuentas de esta validacion.</p>
      <div class="row">
        <div class="field" style="max-width:260px;">
          <label for="contract-number">Numero de contrato</label>
          <input type="text" id="contract-number" maxlength="80" value="${esc(data.defaultContractNumber || '')}" placeholder="Ej: CTR-2026-0011">
        </div>
        <div class="field" style="max-width:220px;">
          <label for="contract-valid-to">Vigencia del contrato hasta</label>
          <input type="date" id="contract-valid-to">
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Cuentas asociadas a ${esc(data.company.name)}</h2>
      <p class="hint">Indique para cada cuenta si debe <strong>mantenerse activa</strong> o <strong>darse de baja</strong>.
        Si la da de baja, informe la fecha de termino del trabajador (o deje un comentario explicando el motivo).</p>

      <div class="row" style="margin-bottom:12px;">
        <button type="button" class="secondary small" id="all-keep">Marcar todas como "Mantener activa"</button>
        <button type="button" class="secondary small" id="all-disable">Marcar todas como "Dar de baja"</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sticky-col">Cuenta</th><th>Decision</th><th>Estado en AD</th>
              <th>Area / cargo</th><th>Termino trabajador</th><th>Comentario</th>
            </tr>
          </thead>
          <tbody id="tbody">${data.accounts.map(rowHtml).join('')}</tbody>
        </table>
      </div>

      <div class="sticky-bar">
        <div class="summary" id="summary"></div>
        <button type="button" id="submit">Enviar validacion</button>
      </div>
    </div>`;

  const contractValidTo = data.accounts.find((a) => a.contractValidTo);
  if (contractValidTo) document.getElementById('contract-valid-to').value = contractValidTo.contractValidTo.slice(0, 10);

  document.getElementById('tbody').addEventListener('change', onFieldChange);
  document.getElementById('tbody').addEventListener('input', onFieldChange);
  document.getElementById('all-keep').addEventListener('click', () => setAll('keep'));
  document.getElementById('all-disable').addEventListener('click', () => setAll('disable'));
  document.getElementById('submit').addEventListener('click', submitForm);
  updateSummary();
}

function rowHtml(a) {
  const s = state.get(a.assignmentId);
  const id = esc(a.assignmentId);
  const stateTag = {
    active: '<span class="tag ok">Activa</span>',
    disabled: '<span class="tag muted">Deshabilitada</span>',
    locked: '<span class="tag warn">Bloqueada</span>',
    deleted: '<span class="tag muted">Eliminada</span>',
  }[a.sourceState] || '';

  return `<tr id="tr-${id}" class="${s.decision ? 'row-' + s.decision : ''}">
    <td class="sticky-col">
      <div style="font-weight:600;">${esc(a.displayName || a.samAccountName)}</div>
      <div class="mono" style="color:#63788a;font-size:12px;">${esc(a.samAccountName)}</div>
    </td>
    <td>
      <div class="decision-group">
        <label class="${s.decision === 'keep' ? 'keep-on' : ''}" data-role="keep-label" data-id="${id}">
          <input type="radio" name="d-${id}" value="keep" data-field="decision" data-id="${id}" ${s.decision === 'keep' ? 'checked' : ''}>
          Mantener
        </label>
        <label class="${s.decision === 'disable' ? 'disable-on' : ''}" data-role="disable-label" data-id="${id}">
          <input type="radio" name="d-${id}" value="disable" data-field="decision" data-id="${id}" ${s.decision === 'disable' ? 'checked' : ''}>
          Dar de baja
        </label>
      </div>
    </td>
    <td style="white-space:nowrap;">${stateTag}
      <div style="color:#63788a;font-size:12px;">${a.lastLogonAt ? 'ultimo acceso ' + esc(fmtDate(a.lastLogonAt)) : 'sin registro de acceso'}</div>
    </td>
    <td>${esc(a.department || '')}<div style="color:#63788a;font-size:12px;">${esc(a.jobTitle || '')}</div></td>
    <td><input type="date" data-field="workerEndDate" data-id="${id}" value="${esc(s.workerEndDate)}"></td>
    <td><input type="text" maxlength="500" style="min-width:170px;" data-field="comment" data-id="${id}" value="${esc(s.comment)}" placeholder="opcional"></td>
  </tr>`;
}

function onFieldChange(e) {
  const el = e.target;
  const field = el.dataset.field;
  const id = el.dataset.id;
  if (!field || !id || !state.has(id)) return;

  const s = state.get(id);
  s[field] = el.value;

  if (field === 'decision') {
    const tr = document.getElementById(`tr-${id}`);
    if (tr) tr.className = `row-${el.value}`;
    const keepLabel = document.querySelector(`label[data-role="keep-label"][data-id="${CSS.escape(id)}"]`);
    const disableLabel = document.querySelector(`label[data-role="disable-label"][data-id="${CSS.escape(id)}"]`);
    if (keepLabel) keepLabel.className = el.value === 'keep' ? 'keep-on' : '';
    if (disableLabel) disableLabel.className = el.value === 'disable' ? 'disable-on' : '';
    updateSummary();
  }
}

function setAll(decision) {
  for (const [id, s] of state) {
    s.decision = decision;
    const radio = document.querySelector(`input[data-field="decision"][data-id="${CSS.escape(id)}"][value="${decision}"]`);
    if (radio) radio.checked = true;
    const tr = document.getElementById(`tr-${id}`);
    if (tr) tr.className = `row-${decision}`;
    const keepLabel = document.querySelector(`label[data-role="keep-label"][data-id="${CSS.escape(id)}"]`);
    const disableLabel = document.querySelector(`label[data-role="disable-label"][data-id="${CSS.escape(id)}"]`);
    if (keepLabel) keepLabel.className = decision === 'keep' ? 'keep-on' : '';
    if (disableLabel) disableLabel.className = decision === 'disable' ? 'disable-on' : '';
  }
  updateSummary();
}

function updateSummary() {
  const values = [...state.values()];
  const keep = values.filter((s) => s.decision === 'keep').length;
  const disable = values.filter((s) => s.decision === 'disable').length;
  const pending = values.length - keep - disable;
  document.getElementById('summary').innerHTML =
    `<b>${values.length}</b> cuentas &middot; <b>${keep}</b> se mantienen &middot; <b>${disable}</b> se dan de baja` +
    (pending ? ` &middot; <span style="color:#b03a2e;font-weight:600;">${pending} sin decidir</span>` : '');
  document.getElementById('submit').disabled = pending > 0;
}

async function submitForm() {
  const missing = [...state.entries()].filter(([, s]) => !s.decision);
  if (missing.length) {
    toast(`Faltan ${missing.length} cuenta(s) por decidir`, 'error');
    return;
  }

  // Regla del portal: la baja requiere fecha de termino o comentario.
  const invalid = [...state.entries()].filter(([, s]) => s.decision === 'disable' && !s.workerEndDate && !s.comment.trim());
  if (invalid.length) {
    toast(`Indique la fecha de termino del trabajador (o un comentario) en ${invalid.length} cuenta(s) marcadas para baja`, 'error');
    const first = document.querySelector(`input[data-field="workerEndDate"][data-id="${CSS.escape(invalid[0][0])}"]`);
    if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    return;
  }

  const keep = [...state.values()].filter((s) => s.decision === 'keep').length;
  const disable = state.size - keep;
  const ok = confirm(
    `Va a enviar su validacion:\n\n` +
    `  ${keep} cuenta(s) se mantienen activas\n` +
    `  ${disable} cuenta(s) se daran de baja\n\n` +
    `Una vez enviada no podra modificarla desde este enlace. Continuar?`
  );
  if (!ok) return;

  const button = document.getElementById('submit');
  button.disabled = true;
  button.textContent = 'Enviando...';

  // El numero y la vigencia del contrato son atributos del contrato, no del
  // trabajador: se capturan una vez y se replican en cada cuenta.
  const contractNumber = document.getElementById('contract-number').value.trim() || null;
  const contractValidTo = document.getElementById('contract-valid-to').value || null;

  const decisions = [...state.entries()].map(([assignmentId, s]) => ({
    assignmentId,
    decision: s.decision,
    contractNumber,
    contractValidTo,
    workerEndDate: s.workerEndDate || null,
    comment: s.comment.trim() || null,
  }));

  try {
    await post(`/api/portal/${encodeURIComponent(token)}/submit`, { decisions });
    location.href = `/gracias?k=${keep}&d=${disable}`;
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'No fue posible enviar la validacion';
    toast(msg, 'error');
    button.disabled = false;
    button.textContent = 'Enviar validacion';
  }
}
