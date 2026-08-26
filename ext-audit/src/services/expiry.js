/**
 * Logica de vencimiento automatico y recordatorios.
 *
 * Se ejecuta desde el Cron Trigger diario (ver wrangler.toml) y tambien puede
 * dispararse manualmente desde el panel.
 *
 * Regla de negocio: si el administrador no responde dentro de RESPONSE_DAYS
 * (14 por defecto), sus cuentas quedan marcadas para deshabilitacion con
 * decision_source = 'timeout'. Las cuentas ya deshabilitadas o eliminadas en
 * origen no se vuelven a accionar.
 */
import { nowIso, daysBetween, addDays } from '../lib/dates.js';
import { all, first, run } from '../lib/db.js';
import { logAudit } from '../lib/audit.js';
import { sendEmail } from './mailer.js';
import { reminderEmail, expiryNoticeEmail } from './templates.js';
import { accountsForRequest, rotateToken, portalUrl } from './requests.js';

/**
 * Envia recordatorios a las solicitudes que vencen en los dias configurados.
 * @param {any} env
 */
export async function sendDueReminders(env) {
  const offsets = String(env.REMINDER_DAYS || '7,3,1')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);

  const pending = await all(
    env.DB,
    `SELECT vr.*, ca.full_name, ca.email, co.canonical_name,
            c.code, c.period_year, c.period_month, c.name AS campaign_name
       FROM validation_requests vr
       JOIN contract_administrators ca ON ca.id = vr.administrator_id
       JOIN companies co ON co.id = vr.company_id
       JOIN campaigns c ON c.id = vr.campaign_id
      WHERE vr.status IN ('sent','opened') AND c.status = 'sent'`
  );

  const results = [];
  for (const req of pending) {
    const daysLeft = daysBetween(nowIso(), req.due_at);
    if (!offsets.includes(daysLeft)) continue;

    // Evita duplicar el recordatorio del mismo dia.
    if (req.last_reminder_at && daysBetween(req.last_reminder_at, nowIso()) < 1) continue;

    const accounts = await accountsForRequest(env, req.id);
    if (accounts.length === 0) continue;

    // Se rota el token en cada recordatorio: el enlace vigente es siempre el ultimo.
    const token = await rotateToken(env, req.id);
    const mail = reminderEmail({
      admin: { full_name: req.full_name },
      company: { canonical_name: req.canonical_name },
      campaign: { code: req.code, period_year: req.period_year, period_month: req.period_month },
      accounts,
      url: portalUrl(env, token),
      dueAt: req.due_at,
      daysLeft,
    });

    const delivery = await sendEmail(env, {
      campaignId: req.campaign_id,
      validationRequestId: req.id,
      kind: 'reminder',
      to: req.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    await run(env.DB, 'UPDATE validation_requests SET reminder_count = reminder_count + 1, last_reminder_at = ?, updated_at = ? WHERE id = ?', [
      nowIso(),
      nowIso(),
      req.id,
    ]);
    await logAudit(env, {
      campaignId: req.campaign_id,
      actorType: 'system',
      actorLabel: 'cron:reminders',
      action: 'reminder_sent',
      entityType: 'validation_request',
      entityId: req.id,
      after: { daysLeft, to: req.email, status: delivery.status },
    });

    results.push({ requestId: req.id, to: req.email, daysLeft, status: delivery.status });
  }
  return results;
}

/**
 * Marca como vencidas las solicitudes sin respuesta y sus cuentas para baja.
 * @param {any} env @param {{notify?: boolean}} [opts]
 */
export async function expireOverdueRequests(env, opts = {}) {
  const { notify = true } = opts;
  const now = nowIso();

  const overdue = await all(
    env.DB,
    `SELECT vr.*, ca.full_name, ca.email, co.canonical_name,
            c.code, c.period_year, c.period_month
       FROM validation_requests vr
       JOIN contract_administrators ca ON ca.id = vr.administrator_id
       JOIN companies co ON co.id = vr.company_id
       JOIN campaigns c ON c.id = vr.campaign_id
      WHERE vr.status IN ('pending','sent','opened','failed')
        AND vr.due_at < ?
        AND c.status IN ('sent','ready')`,
    [now]
  );

  const results = [];
  for (const req of overdue) {
    // Solo se marcan las cuentas aun sin decision y accionables en AD.
    const affected = await all(
      env.DB,
      `SELECT aa.id, ia.sam_account_name, ia.display_name, ia.source_state
         FROM account_assignments aa
         JOIN imported_accounts ia ON ia.id = aa.imported_account_id
        WHERE aa.campaign_id = ? AND aa.administrator_id = ?
          AND aa.final_decision IS NULL
          AND aa.review_status <> 'excluded'`,
      [req.campaign_id, req.administrator_id]
    );

    await run(
      env.DB,
      `UPDATE account_assignments
          SET final_decision = 'disable', decision_source = 'timeout', decided_at = ?, updated_at = ?
        WHERE campaign_id = ? AND administrator_id = ?
          AND final_decision IS NULL AND review_status <> 'excluded'`,
      [now, now, req.campaign_id, req.administrator_id]
    );
    await run(env.DB, `UPDATE validation_requests SET status = 'expired', updated_at = ? WHERE id = ?`, [now, req.id]);

    await logAudit(env, {
      campaignId: req.campaign_id,
      actorType: 'system',
      actorLabel: 'cron:expiry',
      action: 'request_expired',
      entityType: 'validation_request',
      entityId: req.id,
      after: {
        administrator: req.email,
        dueAt: req.due_at,
        accountsMarkedForDisable: affected.length,
        accounts: affected.map((a) => a.sam_account_name),
      },
    });

    if (notify && affected.length > 0) {
      const mail = expiryNoticeEmail({
        admin: { full_name: req.full_name },
        company: { canonical_name: req.canonical_name },
        campaign: { code: req.code, period_year: req.period_year, period_month: req.period_month },
        accounts: affected,
        dueAt: req.due_at,
      });
      await sendEmail(env, {
        campaignId: req.campaign_id,
        validationRequestId: req.id,
        kind: 'expiry_notice',
        to: req.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
    }

    results.push({ requestId: req.id, administrator: req.email, marked: affected.length });
  }

  // Cuentas EXT sin administrador identificado y con la campana ya vencida:
  // permanecen en cola de revision manual, nunca se dan de baja en automatico.
  const orphaned = await first(
    env.DB,
    `SELECT COUNT(*) AS n
       FROM account_assignments aa JOIN campaigns c ON c.id = aa.campaign_id
      WHERE aa.administrator_id IS NULL AND aa.final_decision IS NULL
        AND aa.review_status <> 'excluded' AND c.status = 'sent' AND c.due_at < ?`,
    [now]
  );

  return {
    expiredRequests: results.length,
    accountsMarked: results.reduce((sum, r) => sum + r.marked, 0),
    orphanAccountsPendingReview: Number(orphaned?.n || 0),
    results,
  };
}

/**
 * Rutina diaria completa. La invoca el handler `scheduled`.
 * @param {any} env
 */
export async function runDailyJob(env) {
  const startedAt = nowIso();
  const reminders = await sendDueReminders(env);
  const expiry = await expireOverdueRequests(env);

  await logAudit(env, {
    actorType: 'system',
    actorLabel: 'cron:daily',
    action: 'daily_job_completed',
    entityType: 'job',
    entityId: 'daily',
    after: {
      startedAt,
      finishedAt: nowIso(),
      remindersSent: reminders.length,
      expiredRequests: expiry.expiredRequests,
      accountsMarked: expiry.accountsMarked,
      orphanAccountsPendingReview: expiry.orphanAccountsPendingReview,
    },
  });

  return { startedAt, reminders, expiry };
}
