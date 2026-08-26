/**
 * Bitacora de auditoria (append-only) y registro de acciones internas.
 * Todo cambio de estado relevante para la auditoria pasa por aqui.
 */
import { uuid, hashWithSecret } from './crypto.js';
import { nowIso } from './dates.js';
import { clientIp } from './http.js';

/**
 * @param {any} env
 * @param {{
 *   campaignId?: string|null,
 *   actorType: 'internal_user'|'external_admin'|'system',
 *   actorId?: string|null,
 *   actorLabel?: string|null,
 *   action: string,
 *   entityType?: string|null,
 *   entityId?: string|null,
 *   before?: any,
 *   after?: any,
 *   request?: Request|null
 * }} event
 */
export async function logAudit(env, event) {
  const ip = event.request ? clientIp(event.request) : '';
  const ipHash = ip ? await hashWithSecret(ip, env.APP_SECRET || 'dev-secret') : null;
  const ua = event.request ? (event.request.headers.get('User-Agent') || '').slice(0, 300) : null;

  await env.DB.prepare(
    `INSERT INTO audit_log
       (id, campaign_id, actor_type, actor_id, actor_label, action, entity_type, entity_id,
        before_json, after_json, ip_hash, user_agent, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      uuid(),
      event.campaignId ?? null,
      event.actorType,
      event.actorId ?? null,
      event.actorLabel ?? null,
      event.action,
      event.entityType ?? null,
      event.entityId ?? null,
      event.before === undefined ? null : JSON.stringify(event.before),
      event.after === undefined ? null : JSON.stringify(event.after),
      ipHash,
      ua,
      nowIso()
    )
    .run();
}

/**
 * Registro de accion de un usuario interno del panel.
 * @param {any} env @param {any} ctx contexto de request con `user`
 * @param {{action:string, targetType?:string, targetId?:string, campaignId?:string, payload?:any}} action
 */
export async function logUserAction(env, ctx, action) {
  const ip = ctx.request ? clientIp(ctx.request) : '';
  const ipHash = ip ? await hashWithSecret(ip, env.APP_SECRET || 'dev-secret') : null;
  await env.DB.prepare(
    `INSERT INTO user_actions (id, user_id, campaign_id, action, target_type, target_id, payload_json, ip_hash, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      uuid(),
      ctx.user ? ctx.user.id : null,
      action.campaignId ?? null,
      action.action,
      action.targetType ?? null,
      action.targetId ?? null,
      action.payload === undefined ? null : JSON.stringify(action.payload),
      ipHash,
      nowIso()
    )
    .run();
}

/**
 * Atajo: registra en ambas tablas cuando un usuario interno hace un cambio.
 */
export async function logUserChange(env, ctx, event) {
  await logAudit(env, {
    ...event,
    actorType: 'internal_user',
    actorId: ctx.user ? ctx.user.id : null,
    actorLabel: ctx.user ? ctx.user.email : null,
    request: ctx.request,
  });
  await logUserAction(env, ctx, {
    action: event.action,
    targetType: event.entityType,
    targetId: event.entityId,
    campaignId: event.campaignId,
    payload: event.after,
  });
}
