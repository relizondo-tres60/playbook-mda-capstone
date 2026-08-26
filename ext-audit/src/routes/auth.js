/**
 * Rutas de autenticacion del panel interno.
 */
import { json, readJson, badRequest, unauthorized } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import * as v from '../lib/validate.js';
import {
  login, logout, sessionCookie, clearCookie, requireUser, requireRole,
  createUser, setPassword, validatePasswordStrength, readCookie, SESSION_COOKIE,
} from '../services/auth.js';
import { all, first } from '../lib/db.js';
import { nowIso } from '../lib/dates.js';

const isHttps = (request) => new URL(request.url).protocol === 'https:';

export async function handleLogin(ctx) {
  const { env, request } = ctx;
  const body = await readJson(request);
  const emailAddr = v.email(body.email, 'email', true);
  const password = v.str(body.password, 'password', { max: 200, required: true });

  try {
    const { user, token, expiresAt } = await login(env, emailAddr, password, request);
    await logAudit(env, {
      actorType: 'internal_user', actorId: user.id, actorLabel: user.email,
      action: 'login_success', entityType: 'internal_user', entityId: user.id, request,
    });
    return json({ user }, 200, { 'Set-Cookie': sessionCookie(token, expiresAt, isHttps(request)) });
  } catch (e) {
    await logAudit(env, {
      actorType: 'internal_user', actorLabel: emailAddr, action: 'login_failed',
      entityType: 'internal_user', entityId: null, after: { reason: e.code || 'error' }, request,
    });
    throw e;
  }
}

export async function handleLogout(ctx) {
  const { env, request } = ctx;
  await logout(env, readCookie(request, SESSION_COOKIE));
  if (ctx.user) {
    await logAudit(env, {
      actorType: 'internal_user', actorId: ctx.user.id, actorLabel: ctx.user.email,
      action: 'logout', entityType: 'internal_user', entityId: ctx.user.id, request,
    });
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(isHttps(request)) });
}

export async function handleMe(ctx) {
  if (!ctx.user) throw unauthorized('Sesion no valida o expirada');
  return json({ user: ctx.user });
}

export async function handleListUsers(ctx) {
  requireRole(ctx, 'admin');
  const users = await all(
    ctx.env.DB,
    'SELECT id, email, name, role, status, last_login_at, created_at FROM internal_users ORDER BY name'
  );
  return json({ users });
}

export async function handleCreateUser(ctx) {
  const actor = requireRole(ctx, 'admin');
  const body = await readJson(ctx.request);
  const emailAddr = v.email(body.email, 'email', true);
  const name = v.str(body.name, 'name', { max: 120, required: true });
  const role = v.oneOf(body.role, 'role', ['admin', 'operator', 'auditor'], true);
  const password = v.str(body.password, 'password', { max: 200, required: true });

  const strength = validatePasswordStrength(password);
  if (strength) throw badRequest(strength);

  const exists = await first(ctx.env.DB, 'SELECT id FROM internal_users WHERE email = ?', [emailAddr]);
  if (exists) throw badRequest('Ya existe un usuario con ese correo');

  const user = await createUser(ctx.env, { email: emailAddr, name, role, password });
  await logAudit(ctx.env, {
    actorType: 'internal_user', actorId: actor.id, actorLabel: actor.email,
    action: 'user_created', entityType: 'internal_user', entityId: user.id,
    after: { email: emailAddr, role }, request: ctx.request,
  });
  return json({ user }, 201);
}

export async function handleChangePassword(ctx) {
  const user = requireUser(ctx);
  const body = await readJson(ctx.request);
  const current = v.str(body.currentPassword, 'currentPassword', { max: 200, required: true });
  const next = v.str(body.newPassword, 'newPassword', { max: 200, required: true });

  const strength = validatePasswordStrength(next);
  if (strength) throw badRequest(strength);

  // Se reautentica al usuario antes de permitir el cambio.
  await login(ctx.env, user.email, current, ctx.request);
  await setPassword(ctx.env, user.id, next);
  await logAudit(ctx.env, {
    actorType: 'internal_user', actorId: user.id, actorLabel: user.email,
    action: 'password_changed', entityType: 'internal_user', entityId: user.id, request: ctx.request,
  });
  return json({ ok: true, changedAt: nowIso() });
}
