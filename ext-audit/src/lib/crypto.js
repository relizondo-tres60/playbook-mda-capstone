/**
 * Primitivas criptograficas sobre Web Crypto (disponible en Cloudflare Workers).
 * No se usa ninguna dependencia externa.
 */

const enc = new TextEncoder();

/** @returns {string} UUID v4 */
export function uuid() {
  return crypto.randomUUID();
}

/**
 * Codifica bytes en base64url (sin padding).
 * @param {ArrayBuffer|Uint8Array} buf
 */
export function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} s base64 o base64url */
export function fromB64(s) {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Token opaco de alta entropia para enlaces firmados y sesiones.
 * @param {number} bytes
 */
export function randomToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

/** @param {string|Uint8Array} data @returns {Promise<string>} hex */
export async function sha256Hex(data) {
  const buf = typeof data === 'string' ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash con sal secreta de la aplicacion. Se usa para IPs en la auditoria:
 * permite correlacionar sin almacenar el dato personal en claro.
 * @param {string} value @param {string} secret
 */
export async function hashWithSecret(value, secret) {
  if (!value) return null;
  return sha256Hex(`${secret}::${value}`);
}

/**
 * Deriva una clave PBKDF2-HMAC-SHA256.
 * @param {string} password @param {string} saltB64 @param {number} iterations
 * @returns {Promise<string>} hash en base64url
 */
export async function pbkdf2(password, saltB64, iterations = 210000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return b64url(bits);
}

/** Genera {salt, hash, iterations} para una contrasena nueva. */
export async function hashPassword(password, iterations = 210000) {
  const salt = randomToken(16);
  const hash = await pbkdf2(password, salt, iterations);
  return { salt, hash, iterations };
}

/**
 * Comparacion en tiempo constante de dos strings ASCII.
 * @param {string} a @param {string} b
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Firma RS256 usando una clave privada PKCS#8 en formato PEM
 * (service account de Google Workspace).
 * @param {string} pem @param {string} payload
 * @returns {Promise<string>} firma en base64url
 */
export async function signRS256(pem, payload) {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    fromB64(body),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(payload));
  return b64url(sig);
}
