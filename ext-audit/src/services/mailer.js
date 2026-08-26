/**
 * Capa de envio de correo con registro de trazabilidad.
 *
 * Cada envio deja una fila en email_deliveries con estado, fecha, destinatarios
 * y el identificador del proveedor. El proveedor se elige por variable de
 * entorno (MAIL_PROVIDER), de modo que cambiar la casilla remitente o migrar
 * de OAuth a Service Account no toca el resto de la aplicacion.
 */
import { uuid } from '../lib/crypto.js';
import { nowIso } from '../lib/dates.js';
import { run } from '../lib/db.js';
import { buildMime, sendViaGmail } from './gmail.js';
import { sanitizeSubject } from './templates.js';

/**
 * @param {any} env
 * @param {{
 *   campaignId: string,
 *   validationRequestId?: string|null,
 *   kind: 'invitation'|'reminder'|'expiry_notice'|'confirmation'|'internal_summary',
 *   to: string,
 *   cc?: string|null,
 *   subject: string,
 *   html: string,
 *   text: string
 * }} message
 * @returns {Promise<{deliveryId:string, status:'sent'|'failed', providerMessageId:string|null, error:string|null}>}
 */
export async function sendEmail(env, message) {
  const provider = String(env.MAIL_PROVIDER || 'console');
  const deliveryId = uuid();
  const subject = sanitizeSubject(message.subject);
  const cc = message.cc || env.MAIL_CC_HELPDESK || null;

  await run(
    env.DB,
    `INSERT INTO email_deliveries
       (id, campaign_id, validation_request_id, kind, to_email, cc_email, subject, body_preview,
        provider, status, attempts, created_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'queued', 0, ?)`,
    [
      deliveryId,
      message.campaignId,
      message.validationRequestId || null,
      message.kind,
      message.to,
      cc,
      subject,
      message.text.slice(0, 500),
      provider,
      nowIso(),
    ]
  );

  try {
    let providerMessageId = null;

    if (provider === 'console') {
      // Modo de desarrollo: no se envia nada, se deja el rastro en los logs.
      console.log('[mail:console]', JSON.stringify({ to: message.to, cc, subject, kind: message.kind }));
      providerMessageId = `console-${deliveryId}`;
    } else if (provider === 'gmail_service_account' || provider === 'gmail_oauth') {
      const mime = buildMime({
        from: env.MAIL_FROM,
        fromName: env.MAIL_FROM_NAME || 'Auditoria de Cuentas Externas',
        to: message.to,
        cc: cc || undefined,
        replyTo: env.MAIL_REPLY_TO || env.MAIL_FROM,
        subject,
        text: message.text,
        html: message.html,
      });
      const result = await sendViaGmail(env, mime);
      providerMessageId = result.id;
    } else {
      throw new Error(`MAIL_PROVIDER no soportado: ${provider}`);
    }

    await run(
      env.DB,
      `UPDATE email_deliveries SET status = 'sent', provider_message_id = ?, attempts = attempts + 1, sent_at = ? WHERE id = ?`,
      [providerMessageId, nowIso(), deliveryId]
    );
    return { deliveryId, status: 'sent', providerMessageId, error: null };
  } catch (e) {
    const error = String((e && e.message) || e).slice(0, 500);
    console.error('mail_send_failed', message.kind, message.to, error);
    await run(
      env.DB,
      `UPDATE email_deliveries SET status = 'failed', error = ?, attempts = attempts + 1 WHERE id = ?`,
      [error, deliveryId]
    );
    return { deliveryId, status: 'failed', providerMessageId: null, error };
  }
}

/**
 * Verificacion de configuracion del proveedor, sin enviar correo real.
 * Se expone en el panel para diagnosticar antes de lanzar una campana.
 * @param {any} env
 */
export async function checkMailConfig(env) {
  const provider = String(env.MAIL_PROVIDER || 'console');
  const issues = [];
  if (!env.MAIL_FROM) issues.push('Falta MAIL_FROM');
  if (provider === 'gmail_service_account') {
    if (!env.GOOGLE_SA_CLIENT_EMAIL) issues.push('Falta GOOGLE_SA_CLIENT_EMAIL');
    if (!env.GOOGLE_SA_PRIVATE_KEY) issues.push('Falta GOOGLE_SA_PRIVATE_KEY');
    if (!env.GOOGLE_IMPERSONATE_USER) issues.push('Falta GOOGLE_IMPERSONATE_USER');
  } else if (provider === 'gmail_oauth') {
    if (!env.GOOGLE_OAUTH_CLIENT_ID) issues.push('Falta GOOGLE_OAUTH_CLIENT_ID');
    if (!env.GOOGLE_OAUTH_CLIENT_SECRET) issues.push('Falta GOOGLE_OAUTH_CLIENT_SECRET');
    if (!env.GOOGLE_OAUTH_REFRESH_TOKEN) issues.push('Falta GOOGLE_OAUTH_REFRESH_TOKEN');
  } else if (provider !== 'console') {
    issues.push(`MAIL_PROVIDER desconocido: ${provider}`);
  }
  return {
    provider,
    from: env.MAIL_FROM || null,
    fromName: env.MAIL_FROM_NAME || null,
    replyTo: env.MAIL_REPLY_TO || null,
    ccHelpdesk: env.MAIL_CC_HELPDESK || null,
    ready: issues.length === 0,
    issues,
  };
}
