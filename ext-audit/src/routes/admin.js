/**
 * Rutas de administracion: bitacora, configuracion, diagnostico de correo,
 * ejecucion manual del job diario y arranque inicial del sistema.
 */
import { json, readJson, badRequest, forbidden, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireRole, requireUser, createUser, validatePasswordStrength } from '../services/auth.js';
import { logAudit, logUserChange } from '../lib/audit.js';
import { all, first, run } from '../lib/db.js';
import { nowIso } from '../lib/dates.js';
import { timingSafeEqual } from '../lib/crypto.js';
import { checkMailConfig } from '../services/mailer.js';
import { runDailyJob, expireOverdueRequests, sendDueReminders } from '../services/expiry.js';

/** GET /api/audit */
export async function handleAuditLog(ctx) {
  requireUser(ctx);
  const q = ctx.url.searchParams;
  const { limit, offset } = v.pagination(ctx.url);
  const clauses = [];
  const params = [];

  if (q.get('campaignId')) {
    clauses.push('campaign_id = ?');
    params.push(q.get('campaignId'));
  }
  if (q.get('action')) {
    clauses.push('action = ?');
    params.push(String(q.get('action')).slice(0, 60));
  }
  if (q.get('actorType')) {
    clauses.push('actor_type = ?');
    params.push(v.oneOf(q.get('actorType'), 'actorType', ['internal_user', 'external_admin', 'system'], true));
  }
  if (q.get('entityId')) {
    clauses.push('entity_id = ?');
    params.push(String(q.get('entityId')).slice(0, 64));
  }
  if (q.get('from')) {
    clauses.push('created_at >= ?');
    params.push(`${v.dateOnly(q.get('from'), 'from', true)}T00:00:00.000Z`);
  }
  if (q.get('to')) {
    clauses.push('created_at <= ?');
    params.push(`${v.dateOnly(q.get('to'), 'to', true)}T23:59:59.999Z`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const events = await all(
    ctx.env.DB,
    `SELECT id, campaign_id, actor_type, actor_id, actor_label, action, entity_type, entity_id,
            before_json, after_json, created_at
       FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = await first(ctx.env.DB, `SELECT COUNT(*) AS n FROM audit_log ${where}`, params);
  return json({ events, total: Number(total?.n || 0), limit, offset });
}

/** GET /api/emails */
export async function handleEmailLog(ctx) {
  requireUser(ctx);
  const q = ctx.url.searchParams;
  const { limit, offset } = v.pagination(ctx.url);
  const clauses = [];
  const params = [];
  if (q.get('campaignId')) {
    clauses.push('ed.campaign_id = ?');
    params.push(q.get('campaignId'));
  }
  if (q.get('status')) {
    clauses.push('ed.status = ?');
    params.push(v.oneOf(q.get('status'), 'status', ['queued', 'sent', 'failed'], true));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const emails = await all(
    ctx.env.DB,
    `SELECT ed.*, ca.full_name AS administrator_name, co.canonical_name AS company_name
       FROM email_deliveries ed
       LEFT JOIN validation_requests vr ON vr.id = ed.validation_request_id
       LEFT JOIN contract_administrators ca ON ca.id = vr.administrator_id
       LEFT JOIN companies co ON co.id = vr.company_id
       ${where} ORDER BY ed.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return json({ emails });
}

/** GET /api/settings */
export async function handleGetSettings(ctx) {
  requireUser(ctx);
  const rows = await all(ctx.env.DB, 'SELECT key, value, updated_at FROM settings ORDER BY key');
  return json({
    settings: rows,
    runtime: {
      appName: ctx.env.APP_NAME,
      appBaseUrl: ctx.env.APP_BASE_URL,
      responseDays: Number(ctx.env.RESPONSE_DAYS || 14),
      reminderDays: String(ctx.env.REMINDER_DAYS || '7,3,1'),
      tokenGraceDays: Number(ctx.env.TOKEN_GRACE_DAYS || 7),
      extMatchMode: ctx.env.EXT_MATCH_MODE || 'token',
    },
    mail: await checkMailConfig(ctx.env),
  });
}

/** PUT /api/settings */
export async function handleUpdateSettings(ctx) {
  const user = requireRole(ctx, 'admin');
  const body = await readJson(ctx.request);
  const allowed = ['ext_match_mode', 'auto_assign_threshold', 'response_days', 'reminder_days', 'token_grace_days'];
  const updates = [];

  for (const [key, value] of Object.entries(body)) {
    if (!allowed.includes(key)) throw badRequest(`Parametro no configurable: ${key}`);
    const val = v.str(String(value), key, { max: 100, required: true });
    if (key === 'ext_match_mode' && !['token', 'substring'].includes(val)) {
      throw badRequest('ext_match_mode debe ser "token" o "substring"');
    }
    if (key === 'auto_assign_threshold' && !(Number(val) >= 0 && Number(val) <= 1)) {
      throw badRequest('auto_assign_threshold debe estar entre 0 y 1');
    }
    if (key === 'response_days' && !(Number(val) >= 1 && Number(val) <= 90)) {
      throw badRequest('response_days debe estar entre 1 y 90');
    }
    updates.push([key, val]);
  }

  for (const [key, val] of updates) {
    await run(
      ctx.env.DB,
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?,?,?,?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [key, val, nowIso(), user.id]
    );
  }
  await logUserChange(ctx.env, ctx, {
    action: 'settings_updated', entityType: 'settings', entityId: 'settings', after: Object.fromEntries(updates),
  });
  return json({ ok: true, updated: updates.length });
}

/** GET /api/mail/status */
export async function handleMailStatus(ctx) {
  requireUser(ctx);
  return json(await checkMailConfig(ctx.env));
}

/** POST /api/jobs/daily  (ejecucion manual del cron) */
export async function handleRunDailyJob(ctx) {
  requireRole(ctx, 'admin');
  const result = await runDailyJob(ctx.env);
  await logUserChange(ctx.env, ctx, {
    action: 'daily_job_manual_run', entityType: 'job', entityId: 'daily',
    after: { reminders: result.reminders.length, expired: result.expiry.expiredRequests },
  });
  return json(result);
}

/** POST /api/jobs/expire */
export async function handleRunExpiry(ctx) {
  requireRole(ctx, 'admin');
  const body = await readJson(ctx.request).catch(() => ({}));
  const notify = v.bool(body.notify, 'notify');
  const result = await expireOverdueRequests(ctx.env, { notify: notify !== false });
  await logUserChange(ctx.env, ctx, {
    action: 'expiry_manual_run', entityType: 'job', entityId: 'expiry', after: result,
  });
  return json(result);
}

/** POST /api/jobs/reminders */
export async function handleRunReminders(ctx) {
  requireRole(ctx, 'admin');
  const results = await sendDueReminders(ctx.env);
  await logUserChange(ctx.env, ctx, {
    action: 'reminders_manual_run', entityType: 'job', entityId: 'reminders', after: { sent: results.length },
  });
  return json({ sent: results.length, results });
}

/**
 * POST /api/setup - crea el primer usuario administrador.
 * Solo funciona si no existe ningun usuario y se presenta SETUP_TOKEN.
 */
export async function handleSetup(ctx) {
  const { env } = ctx;
  const count = await first(env.DB, 'SELECT COUNT(*) AS n FROM internal_users');
  if (Number(count?.n || 0) > 0) throw forbidden('El sistema ya fue inicializado');

  const body = await readJson(ctx.request);
  const token = v.str(body.setupToken, 'setupToken', { max: 200, required: true });
  if (!env.SETUP_TOKEN || !timingSafeEqual(token, String(env.SETUP_TOKEN))) {
    throw forbidden('SETUP_TOKEN invalido');
  }

  const emailAddr = v.email(body.email || env.SEED_ADMIN_EMAIL, 'email', true);
  const name = v.str(body.name, 'name', { max: 120 }) || 'Administrador';
  const password = v.str(body.password || env.SEED_ADMIN_PASSWORD, 'password', { max: 200, required: true });
  const strength = validatePasswordStrength(password);
  if (strength) throw badRequest(strength);

  const user = await createUser(env, { email: emailAddr, name, role: 'admin', password });
  await logAudit(env, {
    actorType: 'system', actorLabel: 'setup', action: 'system_initialized',
    entityType: 'internal_user', entityId: user.id, after: { email: emailAddr }, request: ctx.request,
  });
  return json({ ok: true, user }, 201);
}

/** GET /api/health */
export async function handleHealth(ctx) {
  let db = 'ok';
  try {
    await first(ctx.env.DB, 'SELECT 1 AS ok');
  } catch (e) {
    db = `error: ${String(e.message || e).slice(0, 120)}`;
  }
  return json({
    status: db === 'ok' ? 'ok' : 'degraded',
    time: nowIso(),
    db,
    mailProvider: ctx.env.MAIL_PROVIDER || 'console',
    version: '1.0.0',
  });
}
