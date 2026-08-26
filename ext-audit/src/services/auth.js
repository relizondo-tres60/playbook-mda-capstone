/**
 * Autenticacion del panel interno.
 *
 * Modelo: usuario + contrasena (PBKDF2-HMAC-SHA256, 210k iteraciones) con
 * sesion en cookie HttpOnly / Secure / SameSite=Strict. El token de sesion
 * nunca se guarda en claro: en D1 vive solo su SHA-256.
 *
 * Ver docs/SEGURIDAD.md para la ruta de migracion a Cloudflare Access (SSO).
 */
import { uuid, randomToken, sha256Hex, pbkdf2, hashPassword, timingSafeEqual, hashWithSecret } from '../lib/crypto.js';
import { nowIso, addDays, isPast } from '../lib/dates.js';
import { unauthorized, forbidden, tooMany, clientIp } from '../lib/http.js';
import { first, run } from '../lib/db.js';

export const SESSION_COOKIE = 'ext_audit_session';
const SESSION_DAYS = 1;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/** Jerarquia de permisos del panel interno. */
export const ROLE_RANK = { auditor: 1, operator: 2, admin: 3 };

/**
 * @param {any} env @param {string} emailAddr @param {string} password @param {Request} request
 * @returns {Promise<{user:any, token:string, expiresAt:string}>}
 */
export async function login(env, emailAddr, password, request) {
  const user = await first(env.DB, 'SELECT * FROM internal_users WHERE email = ?', [emailAddr]);

  // Se calcula un hash aunque el usuario no exista, para no filtrar por tiempo
  // que correos estan registrados.
  const salt = user ? user.password_salt : 'AAAAAAAAAAAAAAAAAAAAAA';
  const iter = user ? user.password_iter : 210000;
  const candidate = await pbkdf2(password, salt, iter);

  if (!user || user.status !== 'active') throw unauthorized('Credenciales invalidas');
  if (user.locked_until && !isPast(user.locked_until)) {
    throw tooMany('Cuenta bloqueada temporalmente por intentos fallidos. Reintente en unos minutos.');
  }

  if (!timingSafeEqual(candidate, user.password_hash)) {
    const failed = (user.failed_logins || 0) + 1;
    const lockUntil =
      failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    await run(env.DB, 'UPDATE internal_users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?', [
      failed,
      lockUntil,
      nowIso(),
      user.id,
    ]);
    throw unauthorized('Credenciales invalidas');
  }

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = addDays(new Date(), SESSION_DAYS).toISOString();
  const ip = clientIp(request);

  await run(
    env.DB,
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_hash, user_agent, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      uuid(),
      user.id,
      tokenHash,
      expiresAt,
      ip ? await hashWithSecret(ip, env.APP_SECRET || 'dev-secret') : null,
      (request.headers.get('User-Agent') || '').slice(0, 300),
      nowIso(),
    ]
  );
  await run(
    env.DB,
    'UPDATE internal_users SET failed_logins = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
    [nowIso(), nowIso(), user.id]
  );

  return { user: publicUser(user), token, expiresAt };
}

/** Invalida la sesion actual. */
export async function logout(env, token) {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await run(env.DB, 'UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [nowIso(), tokenHash]);
}

/**
 * Resuelve la sesion desde la cookie. Devuelve null si no hay sesion valida.
 * @param {any} env @param {Request} request
 */
export async function resolveSession(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await first(
    env.DB,
    `SELECT s.id AS session_id, s.expires_at, s.revoked_at, u.*
       FROM sessions s JOIN internal_users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [tokenHash]
  );
  if (!row) return null;
  if (row.revoked_at || isPast(row.expires_at) || row.status !== 'active') return null;
  return { ...publicUser(row), sessionId: row.session_id };
}

/** Exige sesion valida. */
export function requireUser(ctx) {
  if (!ctx.user) throw unauthorized('Debe iniciar sesion');
  return ctx.user;
}

/**
 * Exige un rol minimo.
 * @param {any} ctx @param {'auditor'|'operator'|'admin'} minRole
 */
export function requireRole(ctx, minRole) {
  const user = requireUser(ctx);
  if ((ROLE_RANK[user.role] || 0) < ROLE_RANK[minRole]) {
    throw forbidden(`Se requiere rol ${minRole} o superior`);
  }
  return user;
}

/** Crea un usuario interno. */
export async function createUser(env, { email, name, role, password }) {
  const { salt, hash, iterations } = await hashPassword(password);
  const id = uuid();
  await run(
    env.DB,
    `INSERT INTO internal_users (id, email, name, role, password_hash, password_salt, password_iter, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'active',?,?)`,
    [id, email, name, role, hash, salt, iterations, nowIso(), nowIso()]
  );
  return { id, email, name, role };
}

/** Cambia la contrasena de un usuario. */
export async function setPassword(env, userId, password) {
  const { salt, hash, iterations } = await hashPassword(password);
  await run(
    env.DB,
    'UPDATE internal_users SET password_hash = ?, password_salt = ?, password_iter = ?, updated_at = ? WHERE id = ?',
    [hash, salt, iterations, nowIso(), userId]
  );
}

/** Politica minima de contrasena para el portal interno. */
export function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'La contrasena debe tener al menos 12 caracteres';
  }
  if (password.length > 200) return 'La contrasena es demasiado larga';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    return 'La contrasena debe combinar al menos 3 de: minusculas, mayusculas, numeros y simbolos';
  }
  return null;
}

/** Cabecera Set-Cookie de la sesion. */
export function sessionCookie(token, expiresAt, secure = true) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/** Cabecera Set-Cookie que borra la sesion. */
export function clearCookie(secure = true) {
  const attrs = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/** @param {Request} request @param {string} name */
export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/** Proyecta solo los campos publicables de un usuario. */
function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at || null,
  };
}
