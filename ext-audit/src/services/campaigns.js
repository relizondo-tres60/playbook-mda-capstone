/**
 * Gestion de campanas mensuales de validacion.
 */
import { uuid } from '../lib/crypto.js';
import { nowIso, campaignCode, monthName } from '../lib/dates.js';
import { all, first, run } from '../lib/db.js';
import { conflict, notFound, badRequest } from '../lib/http.js';

/**
 * Crea la campana del periodo indicado (idempotente por ano/mes).
 * @param {any} env @param {{year:number, month:number, responseDays:number, userId:string|null, notes?:string|null}} input
 */
export async function createCampaign(env, input) {
  const { year, month, responseDays, userId, notes } = input;
  const existing = await first(env.DB, 'SELECT * FROM campaigns WHERE period_year = ? AND period_month = ?', [year, month]);
  if (existing) throw conflict(`Ya existe la campana ${existing.code}`, { campaignId: existing.id });

  const id = uuid();
  const code = campaignCode(year, month);
  await run(
    env.DB,
    `INSERT INTO campaigns (id, code, name, period_year, period_month, status, response_days, created_by, notes, created_at, updated_at)
     VALUES (?,?,?,?,?, 'draft', ?, ?, ?, ?, ?)`,
    [id, code, `Auditoria cuentas EXT ${monthName(month)} ${year}`, year, month, responseDays, userId, notes || null, nowIso(), nowIso()]
  );
  return getCampaign(env, id);
}

/** @param {any} env @param {string} id */
export async function getCampaign(env, id) {
  const campaign = await first(env.DB, 'SELECT * FROM campaigns WHERE id = ?', [id]);
  if (!campaign) throw notFound('Campana no encontrada');
  return campaign;
}

/** Listado de campanas con contadores. */
export async function listCampaigns(env, limit = 50, offset = 0) {
  return all(
    env.DB,
    `SELECT c.*,
            (SELECT COUNT(*) FROM imported_accounts ia WHERE ia.campaign_id = c.id AND ia.is_ext = 1) AS ext_accounts,
            (SELECT COUNT(*) FROM validation_requests vr WHERE vr.campaign_id = c.id) AS requests_total,
            (SELECT COUNT(*) FROM validation_requests vr WHERE vr.campaign_id = c.id AND vr.status = 'responded') AS requests_responded,
            (SELECT COUNT(*) FROM validation_requests vr WHERE vr.campaign_id = c.id AND vr.status = 'expired') AS requests_expired
       FROM campaigns c
      ORDER BY c.period_year DESC, c.period_month DESC
      LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

/**
 * Resumen operativo de una campana: alimenta el panel interno.
 * @param {any} env @param {string} campaignId
 */
export async function campaignDashboard(env, campaignId) {
  const campaign = await getCampaign(env, campaignId);

  const accounts = await first(
    env.DB,
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN aa.review_status = 'auto_assigned' THEN 1 ELSE 0 END)  AS auto_assigned,
       SUM(CASE WHEN aa.review_status = 'manual_review' THEN 1 ELSE 0 END)  AS manual_review,
       SUM(CASE WHEN aa.review_status = 'unassigned'    THEN 1 ELSE 0 END)  AS unassigned,
       SUM(CASE WHEN aa.review_status = 'confirmed'     THEN 1 ELSE 0 END)  AS confirmed,
       SUM(CASE WHEN aa.review_status = 'excluded'      THEN 1 ELSE 0 END)  AS excluded,
       SUM(CASE WHEN aa.final_decision = 'keep'    THEN 1 ELSE 0 END)       AS keep_count,
       SUM(CASE WHEN aa.final_decision = 'disable' THEN 1 ELSE 0 END)       AS disable_count,
       SUM(CASE WHEN aa.final_decision IS NULL     THEN 1 ELSE 0 END)       AS undecided
     FROM account_assignments aa WHERE aa.campaign_id = ?`,
    [campaignId]
  );

  const requests = await first(
    env.DB,
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'sent'      THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN status = 'opened'    THEN 1 ELSE 0 END) AS opened,
       SUM(CASE WHEN status = 'responded' THEN 1 ELSE 0 END) AS responded,
       SUM(CASE WHEN status = 'expired'   THEN 1 ELSE 0 END) AS expired,
       SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed
     FROM validation_requests WHERE campaign_id = ?`,
    [campaignId]
  );

  const emails = await first(
    env.DB,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'sent'   THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM email_deliveries WHERE campaign_id = ?`,
    [campaignId]
  );

  const byCompany = await all(
    env.DB,
    `SELECT co.id AS company_id, co.canonical_name AS company_name,
            COUNT(aa.id) AS accounts,
            SUM(CASE WHEN aa.final_decision = 'keep' THEN 1 ELSE 0 END) AS keep_count,
            SUM(CASE WHEN aa.final_decision = 'disable' THEN 1 ELSE 0 END) AS disable_count,
            SUM(CASE WHEN aa.administrator_id IS NULL THEN 1 ELSE 0 END) AS without_admin
       FROM account_assignments aa
       LEFT JOIN companies co ON co.id = aa.company_id
      WHERE aa.campaign_id = ?
      GROUP BY co.id, co.canonical_name
      ORDER BY accounts DESC`,
    [campaignId]
  );

  const requestList = await all(
    env.DB,
    `SELECT vr.*, ca.full_name AS administrator_name, ca.email AS administrator_email, ca.site,
            co.canonical_name AS company_name,
            (SELECT COUNT(*) FROM email_deliveries ed WHERE ed.validation_request_id = vr.id AND ed.status = 'failed') AS failed_emails
       FROM validation_requests vr
       JOIN contract_administrators ca ON ca.id = vr.administrator_id
       JOIN companies co ON co.id = vr.company_id
      WHERE vr.campaign_id = ?
      ORDER BY vr.status, co.canonical_name`,
    [campaignId]
  );

  const importsList = await all(
    env.DB,
    `SELECT id, filename, row_count, ext_count, skipped_count, status, checksum, r2_key, created_at
       FROM imports WHERE campaign_id = ? ORDER BY created_at DESC`,
    [campaignId]
  );

  const responded = Number(requests?.responded || 0);
  const totalRequests = Number(requests?.total || 0);

  return {
    campaign,
    accounts: accounts || {},
    requests: requests || {},
    emails: emails || {},
    responseRate: totalRequests ? Number(((responded / totalRequests) * 100).toFixed(1)) : 0,
    byCompany,
    requestList,
    imports: importsList,
  };
}

/**
 * Cierra la campana: congela decisiones y bloquea nuevos envios.
 * @param {any} env @param {string} campaignId
 */
export async function closeCampaign(env, campaignId) {
  const campaign = await getCampaign(env, campaignId);
  if (campaign.status === 'closed') throw conflict('La campana ya esta cerrada');

  await run(
    env.DB,
    `UPDATE account_assignments
        SET final_decision = 'disable', decision_source = 'timeout', decided_at = ?, updated_at = ?
      WHERE campaign_id = ? AND final_decision IS NULL AND review_status <> 'excluded'`,
    [nowIso(), nowIso(), campaignId]
  );
  await run(env.DB, "UPDATE validation_requests SET status = 'expired', updated_at = ? WHERE campaign_id = ? AND status IN ('pending','sent','opened')", [
    nowIso(),
    campaignId,
  ]);
  await run(env.DB, "UPDATE campaigns SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?", [
    nowIso(),
    nowIso(),
    campaignId,
  ]);
  return getCampaign(env, campaignId);
}

/**
 * Listado filtrable de cuentas de una campana (vista consolidada).
 * @param {any} env @param {string} campaignId @param {Record<string, any>} filters
 */
export async function listCampaignAccounts(env, campaignId, filters = {}) {
  const clauses = ['campaign_id = ?'];
  const params = [campaignId];

  if (filters.companyId) {
    clauses.push('company_id = ?');
    params.push(filters.companyId);
  }
  if (filters.administratorId) {
    clauses.push('administrator_id = ?');
    params.push(filters.administratorId);
  }
  if (filters.reviewStatus) {
    clauses.push('review_status = ?');
    params.push(filters.reviewStatus);
  }
  if (filters.decision) {
    clauses.push('final_decision = ?');
    params.push(filters.decision);
  }
  if (filters.requestStatus) {
    clauses.push('request_status = ?');
    params.push(filters.requestStatus);
  }
  if (filters.sourceState) {
    clauses.push('source_state = ?');
    params.push(filters.sourceState);
  }
  if (filters.overdue === true) {
    clauses.push("request_due_at IS NOT NULL AND request_due_at < ? AND request_status <> 'responded'");
    params.push(nowIso());
  }
  if (filters.search) {
    clauses.push('(LOWER(sam_account_name) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(company_name) LIKE ? OR LOWER(administrator_name) LIKE ?)');
    const like = `%${String(filters.search).toLowerCase()}%`;
    params.push(like, like, like, like);
  }

  const limit = Math.min(Number(filters.limit) || 200, 500);
  const offset = Number(filters.offset) || 0;

  const rows = await all(
    env.DB,
    `SELECT * FROM v_campaign_accounts WHERE ${clauses.join(' AND ')}
      ORDER BY company_name, administrator_name, sam_account_name
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = await first(
    env.DB,
    `SELECT COUNT(*) AS n FROM v_campaign_accounts WHERE ${clauses.join(' AND ')}`,
    params
  );
  return { rows, total: Number(total?.n || 0), limit, offset };
}

/**
 * Reasignacion manual de una cuenta (correccion del cruce automatico).
 * @param {any} env
 * @param {{assignmentId:string, companyId?:string|null, administratorId?:string|null, contractNumber?:string|null, site?:string|null, reviewStatus?:string|null, userId:string|null}} input
 */
export async function reassignAccount(env, input) {
  const current = await first(env.DB, 'SELECT * FROM account_assignments WHERE id = ?', [input.assignmentId]);
  if (!current) throw notFound('Asignacion no encontrada');

  const campaign = await getCampaign(env, current.campaign_id);
  if (campaign.status === 'closed') throw badRequest('La campana esta cerrada: no admite reasignaciones');

  if (input.administratorId) {
    const admin = await first(env.DB, 'SELECT * FROM contract_administrators WHERE id = ?', [input.administratorId]);
    if (!admin) throw notFound('Administrador de contrato no encontrado');
    if (input.companyId && admin.company_id !== input.companyId) {
      throw badRequest('El administrador no pertenece a la empresa indicada');
    }
  }

  const companyId = input.companyId !== undefined ? input.companyId : current.company_id;
  const administratorId = input.administratorId !== undefined ? input.administratorId : current.administrator_id;
  const reviewStatus = input.reviewStatus || (administratorId ? 'confirmed' : 'unassigned');

  await run(
    env.DB,
    `UPDATE account_assignments
        SET company_id = ?, administrator_id = ?, contract_number = ?, site = ?,
            assignment_source = 'manual', review_status = ?, assigned_by = ?, updated_at = ?
      WHERE id = ?`,
    [
      companyId,
      administratorId,
      input.contractNumber !== undefined ? input.contractNumber : current.contract_number,
      input.site !== undefined ? input.site : current.site,
      reviewStatus,
      input.userId,
      nowIso(),
      input.assignmentId,
    ]
  );
  if (companyId) {
    await run(env.DB, 'UPDATE imported_accounts SET normalized_company_id = ? WHERE id = ?', [companyId, current.imported_account_id]);
  }
  return { before: current, after: await first(env.DB, 'SELECT * FROM account_assignments WHERE id = ?', [input.assignmentId]) };
}
