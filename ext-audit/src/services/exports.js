/**
 * Exportacion de resultados para la ejecucion operativa de bajas y para
 * evidencia de auditoria.
 */
import { all } from '../lib/db.js';
import { toCsv } from '../lib/csv.js';
import { formatCl } from '../lib/dates.js';

/**
 * Cola de bajas: lo que el equipo de identidades debe ejecutar en AD.
 * Excluye cuentas ya deshabilitadas o eliminadas en el origen.
 * @param {any} env @param {string} campaignId
 */
export async function disableQueueCsv(env, campaignId) {
  const rows = await all(
    env.DB,
    `SELECT * FROM v_disable_queue WHERE campaign_id = ? ORDER BY company_name, sam_account_name`,
    [campaignId]
  );
  const headers = [
    'samAccountName', 'displayName', 'userPrincipalName', 'email', 'empresa', 'faena',
    'administradorContrato', 'correoAdministrador', 'numeroContrato', 'estadoEnAD',
    'origenDecision', 'fechaDecision', 'fechaTerminoTrabajador', 'vigenciaContrato',
    'comentarioAdministrador', 'campana', 'ouPath',
  ];
  const data = rows.map((r) => [
    r.sam_account_name, r.display_name, r.upn, r.email, r.company_name, r.site,
    r.administrator_name, r.administrator_email, r.contract_number,
    labelSourceState(r.source_state), labelDecisionSource(r.decision_source),
    formatCl(r.decided_at, true), formatCl(r.response_worker_end_date),
    formatCl(r.response_contract_valid_to), r.response_comment, r.campaign_code, r.ou_path,
  ]);
  return { csv: toCsv(headers, data, ';'), count: rows.length };
}

/**
 * Script PowerShell para deshabilitar en AD. Se entrega como apoyo: el equipo
 * operativo lo revisa antes de ejecutarlo, no se ejecuta desde la aplicacion.
 * @param {any} env @param {string} campaignId
 */
export async function disableQueuePowerShell(env, campaignId) {
  const rows = await all(
    env.DB,
    `SELECT * FROM v_disable_queue WHERE campaign_id = ? ORDER BY company_name, sam_account_name`,
    [campaignId]
  );
  const code = rows[0] ? rows[0].campaign_code : campaignId;
  const lines = [
    '<#',
    `  Bajas de cuentas externas EXT - campana ${code}`,
    `  Generado: ${formatCl(new Date().toISOString(), true)} (America/Santiago)`,
    `  Cuentas: ${rows.length}`,
    '',
    '  REVISAR ANTES DE EJECUTAR. Ejecutar con -WhatIf la primera vez.',
    '#>',
    'param([switch]$WhatIf)',
    'Import-Module ActiveDirectory',
    `$campana = "${code}"`,
    '$log = @()',
    '',
  ];
  for (const r of rows) {
    const sam = String(r.sam_account_name || '').replace(/[^A-Za-z0-9._$-]/g, '');
    if (!sam) continue;
    const desc = `Baja auditoria ${code} - ${String(r.company_name || '').replace(/"/g, "'")} - ${labelDecisionSource(r.decision_source)}`;
    lines.push(
      `# ${r.display_name || ''} | ${r.company_name || ''} | ${r.administrator_email || 'sin administrador'}`,
      `try {`,
      `  Disable-ADAccount -Identity "${sam}" -WhatIf:$WhatIf -ErrorAction Stop`,
      `  Set-ADUser -Identity "${sam}" -Description "${desc}" -WhatIf:$WhatIf -ErrorAction Stop`,
      `  $log += [pscustomobject]@{ Cuenta = "${sam}"; Resultado = "OK" }`,
      `} catch {`,
      `  $log += [pscustomobject]@{ Cuenta = "${sam}"; Resultado = "ERROR: $($_.Exception.Message)" }`,
      `}`,
      ''
    );
  }
  lines.push(
    `$log | Export-Csv -Path ".\\bajas_${code}_resultado.csv" -NoTypeInformation -Encoding UTF8`,
    '$log | Format-Table -AutoSize'
  );
  return { script: lines.join('\r\n'), count: rows.length };
}

/**
 * Export completo de la campana (evidencia de auditoria).
 * @param {any} env @param {string} campaignId
 */
export async function fullCampaignCsv(env, campaignId) {
  const rows = await all(
    env.DB,
    `SELECT * FROM v_campaign_accounts WHERE campaign_id = ? ORDER BY company_name, administrator_name, sam_account_name`,
    [campaignId]
  );
  const headers = [
    'campana', 'samAccountName', 'displayName', 'userPrincipalName', 'email', 'departamento', 'cargo',
    'empresaOrigen', 'empresaNormalizada', 'faena', 'administradorContrato', 'correoAdministrador',
    'numeroContrato', 'reglaDeCruce', 'confianza', 'estadoRevision', 'origenAsignacion',
    'estadoEnAD', 'motivoEXT', 'ultimoLogon', 'estadoSolicitud', 'fechaEnvio', 'fechaLimite',
    'fechaRespuesta', 'decisionFinal', 'origenDecision', 'fechaDecision',
    'vigenciaContrato', 'fechaTerminoTrabajador', 'comentario', 'ouPath',
  ];
  const data = rows.map((r) => [
    r.campaign_code, r.sam_account_name, r.display_name, r.upn, r.email, r.department, r.job_title,
    r.company_raw, r.company_name, r.site, r.administrator_name, r.administrator_email,
    r.contract_number, r.match_rule, r.confidence, labelReviewStatus(r.review_status), r.assignment_source,
    labelSourceState(r.source_state), r.ext_reason, formatCl(r.last_logon_at), labelRequestStatus(r.request_status),
    formatCl(r.request_sent_at, true), formatCl(r.request_due_at), formatCl(r.request_responded_at, true),
    labelDecision(r.final_decision), labelDecisionSource(r.decision_source), formatCl(r.decided_at, true),
    formatCl(r.response_contract_valid_to), formatCl(r.response_worker_end_date), r.response_comment, r.ou_path,
  ]);
  return { csv: toCsv(headers, data, ';'), count: rows.length };
}

/**
 * Bitacora de auditoria de la campana en CSV.
 * @param {any} env @param {string} campaignId
 */
export async function auditCsv(env, campaignId) {
  const rows = await all(
    env.DB,
    `SELECT * FROM audit_log WHERE campaign_id = ? ORDER BY created_at`,
    [campaignId]
  );
  const headers = ['fecha', 'actorTipo', 'actor', 'accion', 'entidad', 'entidadId', 'detalle'];
  const data = rows.map((r) => [
    formatCl(r.created_at, true), r.actor_type, r.actor_label || r.actor_id || '',
    r.action, r.entity_type, r.entity_id, r.after_json || r.before_json || '',
  ]);
  return { csv: toCsv(headers, data, ';'), count: rows.length };
}

/** Cuentas sin administrador: cola de revision manual. */
export async function unassignedCsv(env, campaignId) {
  const rows = await all(
    env.DB,
    `SELECT * FROM v_campaign_accounts
      WHERE campaign_id = ? AND (administrator_id IS NULL OR review_status IN ('unassigned','manual_review'))
      ORDER BY company_raw, sam_account_name`,
    [campaignId]
  );
  const headers = [
    'samAccountName', 'displayName', 'empresaOrigen', 'empresaNormalizada', 'managerOrigen',
    'correoManager', 'faena', 'estadoRevision', 'reglaDeCruce', 'estadoEnAD', 'ouPath',
  ];
  const data = rows.map((r) => [
    r.sam_account_name, r.display_name, r.company_raw, r.company_name, r.manager_raw,
    r.manager_email, r.site, labelReviewStatus(r.review_status), r.match_rule,
    labelSourceState(r.source_state), r.ou_path,
  ]);
  return { csv: toCsv(headers, data, ';'), count: rows.length };
}

// --- Etiquetas legibles -----------------------------------------------------

function labelDecision(v) {
  return v === 'keep' ? 'Mantener activa' : v === 'disable' ? 'Dar de baja' : 'Sin decision';
}
function labelDecisionSource(v) {
  return (
    { administrator: 'Respuesta del administrador', timeout: 'Vencimiento sin respuesta', internal: 'Decision interna', source_state: 'Estado en origen' }[v] || ''
  );
}
function labelSourceState(v) {
  return { active: 'Activa', disabled: 'Deshabilitada', locked: 'Bloqueada', deleted: 'Eliminada' }[v] || v || '';
}
function labelReviewStatus(v) {
  return (
    {
      pending: 'Pendiente', auto_assigned: 'Asignada automaticamente', manual_review: 'Revision manual',
      confirmed: 'Confirmada', unassigned: 'Sin administrador', excluded: 'Excluida (estado en origen)',
    }[v] || v || ''
  );
}
function labelRequestStatus(v) {
  return (
    {
      pending: 'Por enviar', sent: 'Enviada', opened: 'Abierta', responded: 'Respondida',
      expired: 'Vencida', cancelled: 'Cancelada', failed: 'Error de envio',
    }[v] || v || ''
  );
}
