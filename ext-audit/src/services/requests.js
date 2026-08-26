/**
 * Solicitudes de validacion y portal externo.
 *
 * Seguridad del enlace:
 *  - Token de 32 bytes aleatorios (256 bits) codificado en base64url.
 *  - En D1 solo vive su SHA-256; el token en claro existe unicamente en el
 *    correo del administrador.
 *  - Un solo proposito: valida una unica solicitud (campana + administrador).
 *  - Expira en due_at + TOKEN_GRACE_DAYS y se rota en cada reenvio, lo que
 *    invalida el enlace anterior.
 *  - Cada apertura y cada intento fallido quedan en la bitacora.
 */
import { uuid, randomToken, sha256Hex } from '../lib/crypto.js';
import { nowIso, addDays, isPast, daysBetween } from '../lib/dates.js';
import { all, first, run } from '../lib/db.js';
import { badRequest, notFound, conflict, forbidden } from '../lib/http.js';
import { getCampaign } from './campaigns.js';
import { sendEmail } from './mailer.js';
import { invitationEmail, reminderEmail, confirmationEmail } from './templates.js';
import { logAudit } from '../lib/audit.js';

/**
 * Genera (o actualiza) una solicitud por cada administrador con cuentas
 * asignadas en la campana. No envia correo todavia.
 * @param {any} env @param {string} campaignId
 */
export async function generateRequests(env, campaignId) {
  const campaign = await getCampaign(env, campaignId);
  if (campaign.status === 'closed') throw badRequest('La campana esta cerrada');

  const responseDays = Number(campaign.response_days || env.RESPONSE_DAYS || 14);
  const graceDays = Number(env.TOKEN_GRACE_DAYS || 7);
  const dueAt = addDays(new Date(), responseDays).toISOString();
  const expiresAt = addDays(dueAt, graceDays).toISOString();

  const groups = await all(
    env.DB,
    `SELECT aa.administrator_id, aa.company_id, COUNT(*) AS accounts
       FROM account_assignments aa
      WHERE aa.campaign_id = ?
        AND aa.administrator_id IS NOT NULL
        AND aa.review_status IN ('auto_assigned','manual_review','confirmed')
      GROUP BY aa.administrator_id, aa.company_id`,
    [campaignId]
  );

  let created = 0;
  let updated = 0;
  for (const g of groups) {
    const existing = await first(
      env.DB,
      'SELECT * FROM validation_requests WHERE campaign_id = ? AND administrator_id = ?',
      [campaignId, g.administrator_id]
    );
    if (existing) {
      if (existing.status === 'responded') continue;
      await run(
        env.DB,
        `UPDATE validation_requests SET accounts_count = ?, company_id = ?, due_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`,
        [g.accounts, g.company_id, dueAt, expiresAt, nowIso(), existing.id]
      );
      updated++;
    } else {
      // Se siembra un token que sera rotado en el envio real.
      const seed = randomToken(32);
      await run(
        env.DB,
        `INSERT INTO validation_requests
           (id, campaign_id, administrator_id, company_id, token_hash, token_prefix, status,
            accounts_count, due_at, expires_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?, 'pending', ?,?,?,?,?)`,
        [uuid(), campaignId, g.administrator_id, g.company_id, await sha256Hex(seed), seed.slice(0, 8), g.accounts, dueAt, expiresAt, nowIso(), nowIso()]
      );
      created++;
    }
  }

  const orphans = await first(
    env.DB,
    `SELECT COUNT(*) AS n FROM account_assignments
      WHERE campaign_id = ? AND (administrator_id IS NULL) AND review_status <> 'excluded'`,
    [campaignId]
  );

  await run(env.DB, `UPDATE campaigns SET status = 'ready', due_at = ?, updated_at = ? WHERE id = ? AND status IN ('draft','imported')`, [
    dueAt,
    nowIso(),
    campaignId,
  ]);

  return { created, updated, total: groups.length, accountsWithoutAdministrator: Number(orphans?.n || 0), dueAt, expiresAt };
}

/**
 * Rota el token de una solicitud y devuelve el valor en claro (solo en memoria).
 * @param {any} env @param {string} requestId
 * @returns {Promise<string>}
 */
export async function rotateToken(env, requestId) {
  const token = randomToken(32);
  await run(env.DB, 'UPDATE validation_requests SET token_hash = ?, token_prefix = ?, failed_attempts = 0, updated_at = ? WHERE id = ?', [
    await sha256Hex(token),
    token.slice(0, 8),
    nowIso(),
    requestId,
  ]);
  return token;
}

/**
 * URL absoluta del portal de validacion.
 *
 * Se emite sin la extension ".html": con el manejo de assets por defecto de
 * Cloudflare, /validar sirve validar.html directamente, mientras que
 * /validar.html responde con un redirect 307 hacia /validar. El enlace del
 * correo debe resolver de una sola vez.
 */
export function portalUrl(env, token) {
  const base = String(env.APP_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/validar?t=${encodeURIComponent(token)}`;
}

/**
 * Envia las invitaciones de una campana.
 * @param {any} env @param {string} campaignId
 * @param {{only?: string[]|null, resend?: boolean}} [opts]
 */
export async function sendCampaignInvitations(env, campaignId, opts = {}) {
  const { only = null, resend = false } = opts;
  const campaign = await getCampaign(env, campaignId);
  if (campaign.status === 'closed') throw badRequest('La campana esta cerrada');

  const statusFilter = resend ? ['pending', 'sent', 'opened', 'failed'] : ['pending', 'failed'];
  const requests = await all(
    env.DB,
    `SELECT vr.*, ca.full_name, ca.email, ca.site, co.canonical_name
       FROM validation_requests vr
       JOIN contract_administrators ca ON ca.id = vr.administrator_id
       JOIN companies co ON co.id = vr.company_id
      WHERE vr.campaign_id = ? AND vr.status IN (${statusFilter.map(() => '?').join(',')})`,
    [campaignId, ...statusFilter]
  );

  const targets = only ? requests.filter((r) => only.includes(r.id)) : requests;
  const results = [];

  for (const req of targets) {
    const accounts = await accountsForRequest(env, req.id);
    if (accounts.length === 0) {
      results.push({ requestId: req.id, to: req.email, status: 'skipped', reason: 'sin cuentas asignadas' });
      continue;
    }

    const token = await rotateToken(env, req.id);
    const url = portalUrl(env, token);
    const mail = invitationEmail({
      admin: { full_name: req.full_name, site: req.site },
      company: { canonical_name: req.canonical_name },
      campaign,
      accounts,
      url,
      dueAt: req.due_at,
    });

    const delivery = await sendEmail(env, {
      campaignId,
      validationRequestId: req.id,
      kind: 'invitation',
      to: req.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    if (delivery.status === 'sent') {
      await run(env.DB, `UPDATE validation_requests SET status = 'sent', sent_at = COALESCE(sent_at, ?), accounts_count = ?, updated_at = ? WHERE id = ?`, [
        nowIso(),
        accounts.length,
        nowIso(),
        req.id,
      ]);
    } else {
      await run(env.DB, `UPDATE validation_requests SET status = 'failed', updated_at = ? WHERE id = ?`, [nowIso(), req.id]);
    }

    await logAudit(env, {
      campaignId,
      actorType: 'system',
      actorLabel: 'mailer',
      action: delivery.status === 'sent' ? 'invitation_sent' : 'invitation_failed',
      entityType: 'validation_request',
      entityId: req.id,
      after: { to: req.email, accounts: accounts.length, dueAt: req.due_at, error: delivery.error },
    });

    results.push({ requestId: req.id, to: req.email, status: delivery.status, accounts: accounts.length, error: delivery.error });
  }

  const anySent = results.some((r) => r.status === 'sent');
  if (anySent) {
    await run(env.DB, `UPDATE campaigns SET status = 'sent', sent_at = COALESCE(sent_at, ?), due_at = COALESCE(due_at, ?), updated_at = ? WHERE id = ?`, [
      nowIso(),
      targets[0] ? targets[0].due_at : null,
      nowIso(),
      campaignId,
    ]);
  }

  return {
    total: targets.length,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results,
  };
}

/** Cuentas incluidas en una solicitud. */
export async function accountsForRequest(env, requestId) {
  return all(
    env.DB,
    `SELECT aa.id AS assignment_id, ia.sam_account_name, ia.display_name, ia.upn, ia.email,
            ia.department, ia.job_title, ia.last_logon_at, ia.source_state, ia.ou_path,
            aa.contract_number, aa.site, aa.final_decision, aa.review_status
       FROM validation_requests vr
       JOIN account_assignments aa
         ON aa.campaign_id = vr.campaign_id AND aa.administrator_id = vr.administrator_id
       JOIN imported_accounts ia ON ia.id = aa.imported_account_id
      WHERE vr.id = ? AND aa.review_status <> 'excluded'
      ORDER BY ia.display_name, ia.sam_account_name`,
    [requestId]
  );
}

/**
 * Resuelve un token del portal externo.
 * @param {any} env @param {string} token
 * @returns {Promise<any>}
 */
export async function resolveToken(env, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw notFound('Enlace invalido');
  }
  const tokenHash = await sha256Hex(token);
  const req = await first(
    env.DB,
    `SELECT vr.*, ca.full_name AS administrator_name, ca.email AS administrator_email, ca.site AS administrator_site,
            ca.contract_number AS admin_contract_number, co.canonical_name AS company_name,
            c.code AS campaign_code, c.name AS campaign_name, c.period_year, c.period_month, c.status AS campaign_status
       FROM validation_requests vr
       JOIN contract_administrators ca ON ca.id = vr.administrator_id
       JOIN companies co ON co.id = vr.company_id
       JOIN campaigns c ON c.id = vr.campaign_id
      WHERE vr.token_hash = ?`,
    [tokenHash]
  );
  if (!req) throw notFound('Enlace invalido o ya reemplazado por un reenvio posterior');
  return req;
}

/**
 * Payload del portal externo (vista del administrador).
 * @param {any} env @param {string} token @param {Request} request
 */
export async function openPortal(env, token, request) {
  const req = await resolveToken(env, token);

  const state = portalState(req);
  await run(
    env.DB,
    `UPDATE validation_requests
        SET open_count = open_count + 1,
            first_opened_at = COALESCE(first_opened_at, ?),
            last_opened_at = ?,
            status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END,
            updated_at = ?
      WHERE id = ?`,
    [nowIso(), nowIso(), nowIso(), req.id]
  );
  await logAudit(env, {
    campaignId: req.campaign_id,
    actorType: 'external_admin',
    actorId: req.administrator_id,
    actorLabel: req.administrator_email,
    action: 'portal_opened',
    entityType: 'validation_request',
    entityId: req.id,
    after: { state },
    request,
  });

  const accounts = await accountsForRequest(env, req.id);
  const responses = await all(
    env.DB,
    'SELECT * FROM validation_responses WHERE validation_request_id = ?',
    [req.id]
  );
  const byAssignment = new Map(responses.map((r) => [r.account_assignment_id, r]));

  return {
    state,
    request: {
      id: req.id,
      status: req.status,
      dueAt: req.due_at,
      expiresAt: req.expires_at,
      sentAt: req.sent_at,
      respondedAt: req.responded_at,
      daysLeft: daysBetween(nowIso(), req.due_at),
    },
    campaign: {
      code: req.campaign_code,
      name: req.campaign_name,
      year: req.period_year,
      month: req.period_month,
      status: req.campaign_status,
    },
    administrator: {
      name: req.administrator_name,
      email: req.administrator_email,
      site: req.administrator_site,
    },
    company: { name: req.company_name },
    defaultContractNumber: req.admin_contract_number || null,
    accounts: accounts.map((a) => {
      const r = byAssignment.get(a.assignment_id);
      return {
        assignmentId: a.assignment_id,
        samAccountName: a.sam_account_name,
        displayName: a.display_name,
        upn: a.upn,
        email: a.email,
        department: a.department,
        jobTitle: a.job_title,
        lastLogonAt: a.last_logon_at,
        sourceState: a.source_state,
        contractNumber: r?.contract_number ?? a.contract_number ?? null,
        contractValidTo: r?.contract_valid_to ?? null,
        workerEndDate: r?.worker_end_date ?? null,
        comment: r?.comment ?? null,
        decision: r?.decision ?? null,
      };
    }),
  };
}

/**
 * Estado del portal: define si acepta respuestas.
 * @param {any} req fila de validation_requests
 * @returns {'open'|'responded'|'expired'|'cancelled'|'closed'}
 */
export function portalState(req) {
  if (req.status === 'cancelled') return 'cancelled';
  if (req.status === 'responded') return 'responded';
  if (req.campaign_status === 'closed') return 'closed';
  if (isPast(req.expires_at)) return 'expired';
  if (isPast(req.due_at)) return 'expired';
  return 'open';
}

/**
 * Registra la respuesta del administrador.
 * @param {any} env @param {string} token
 * @param {{decisions: Array<{assignmentId:string, decision:'keep'|'disable', contractNumber?:string|null, contractValidTo?:string|null, workerEndDate?:string|null, comment?:string|null}>}} payload
 * @param {Request} request
 */
export async function submitResponse(env, token, payload, request) {
  const req = await resolveToken(env, token);
  const state = portalState(req);
  if (state === 'responded') throw conflict('Esta validacion ya fue enviada. Contacte a la mesa de ayuda si necesita corregirla.');
  if (state !== 'open') throw forbidden('El plazo de validacion se encuentra cerrado');

  const accounts = await accountsForRequest(env, req.id);
  const valid = new Set(accounts.map((a) => a.assignment_id));

  const decisions = payload.decisions || [];
  if (decisions.length === 0) throw badRequest('No se recibio ninguna decision');
  if (decisions.length > 2000) throw badRequest('Demasiadas decisiones en una sola solicitud');

  const seen = new Set();
  for (const d of decisions) {
    if (!valid.has(d.assignmentId)) throw forbidden('Una de las cuentas no pertenece a esta validacion');
    if (seen.has(d.assignmentId)) throw badRequest('Hay cuentas duplicadas en el envio');
    seen.add(d.assignmentId);
  }
  const missing = accounts.filter((a) => !seen.has(a.assignment_id));
  if (missing.length > 0) {
    throw badRequest(`Faltan ${missing.length} cuenta(s) por decidir`, {
      missing: missing.map((m) => m.sam_account_name),
    });
  }

  const respondedAt = nowIso();
  const ipHash = null; // se registra hasheada en audit_log
  const ua = (request.headers.get('User-Agent') || '').slice(0, 300);

  /** @type {any[]} */
  const statements = [];
  for (const d of decisions) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO validation_responses
           (id, validation_request_id, account_assignment_id, decision, contract_number,
            contract_valid_to, worker_end_date, comment, responded_at, responder_ip_hash, responder_ua)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (validation_request_id, account_assignment_id) DO UPDATE SET
           decision = excluded.decision,
           contract_number = excluded.contract_number,
           contract_valid_to = excluded.contract_valid_to,
           worker_end_date = excluded.worker_end_date,
           comment = excluded.comment,
           responded_at = excluded.responded_at`
      ).bind(
        uuid(),
        req.id,
        d.assignmentId,
        d.decision,
        d.contractNumber || null,
        d.contractValidTo || null,
        d.workerEndDate || null,
        d.comment || null,
        respondedAt,
        ipHash,
        ua
      )
    );
    statements.push(
      env.DB.prepare(
        `UPDATE account_assignments
            SET final_decision = ?, decision_source = 'administrator', decided_at = ?,
                contract_number = COALESCE(?, contract_number), review_status = 'confirmed', updated_at = ?
          WHERE id = ? AND campaign_id = ?`
      ).bind(d.decision, respondedAt, d.contractNumber || null, respondedAt, d.assignmentId, req.campaign_id)
    );
  }

  for (let i = 0; i < statements.length; i += 40) {
    await env.DB.batch(statements.slice(i, i + 40));
  }

  await run(env.DB, `UPDATE validation_requests SET status = 'responded', responded_at = ?, updated_at = ? WHERE id = ?`, [
    respondedAt,
    nowIso(),
    req.id,
  ]);

  const keep = decisions.filter((d) => d.decision === 'keep').length;
  const disable = decisions.length - keep;

  await logAudit(env, {
    campaignId: req.campaign_id,
    actorType: 'external_admin',
    actorId: req.administrator_id,
    actorLabel: req.administrator_email,
    action: 'validation_submitted',
    entityType: 'validation_request',
    entityId: req.id,
    after: { keep, disable, total: decisions.length, decisions },
    request,
  });

  // Acuse de recibo al administrador (no bloquea la respuesta si falla).
  const campaign = await getCampaign(env, req.campaign_id);
  const mail = confirmationEmail({
    admin: { full_name: req.administrator_name },
    company: { canonical_name: req.company_name },
    campaign,
    keep,
    disable,
    respondedAt,
  });
  await sendEmail(env, {
    campaignId: req.campaign_id,
    validationRequestId: req.id,
    kind: 'confirmation',
    to: req.administrator_email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  return { keep, disable, total: decisions.length, respondedAt };
}

/**
 * Reenvia el enlace a un administrador puntual (rota el token).
 * @param {any} env @param {string} requestId
 */
export async function resendRequest(env, requestId) {
  const req = await first(env.DB, 'SELECT * FROM validation_requests WHERE id = ?', [requestId]);
  if (!req) throw notFound('Solicitud no encontrada');
  if (req.status === 'responded') throw conflict('La solicitud ya fue respondida');
  return sendCampaignInvitations(env, req.campaign_id, { only: [requestId], resend: true });
}
