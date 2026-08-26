/**
 * Integracion con Google Workspace para el envio de correo.
 *
 * Dos modos soportados, ambos sobre la API de Gmail (REST) porque el runtime
 * de Cloudflare Workers no permite abrir conexiones SMTP:
 *
 *  A) gmail_service_account  Service Account + Domain-Wide Delegation.
 *     Se firma un JWT RS256 y se intercambia por un access_token que actua en
 *     nombre de GOOGLE_IMPERSONATE_USER. Es el modo recomendado en produccion:
 *     cambiar de casilla remitente es cambiar una variable de entorno.
 *
 *  B) gmail_oauth  OAuth2 de usuario con refresh_token.
 *     Util para pruebas rapidas con relizondo@tres60.cl sin tocar la consola
 *     de administracion del dominio.
 *
 * Ver docs/GOOGLE-WORKSPACE.md para el paso a paso de configuracion.
 */
import { signRS256, b64url } from '../lib/crypto.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/**
 * Obtiene un access_token mediante Service Account con delegacion de dominio.
 * @param {any} env
 * @returns {Promise<string>}
 */
export async function getServiceAccountToken(env) {
  const clientEmail = env.GOOGLE_SA_CLIENT_EMAIL;
  const privateKey = env.GOOGLE_SA_PRIVATE_KEY;
  const subject = env.GOOGLE_IMPERSONATE_USER || env.MAIL_FROM;
  if (!clientEmail || !privateKey || !subject) {
    throw new Error('Faltan GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY o GOOGLE_IMPERSONATE_USER');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: clientEmail,
        sub: subject,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const signature = await signRS256(privateKey, `${header}.${claims}`);
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${data.error_description || data.error || 'desconocido'}`);
  return data.access_token;
}

/**
 * Obtiene un access_token a partir de un refresh_token de usuario.
 * @param {any} env
 */
export async function getOAuthToken(env) {
  const { GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret, GOOGLE_OAUTH_REFRESH_TOKEN: refresh } = env;
  if (!id || !secret || !refresh) {
    throw new Error('Faltan GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET o GOOGLE_OAUTH_REFRESH_TOKEN');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google OAuth error ${res.status}: ${data.error_description || data.error || 'desconocido'}`);
  return data.access_token;
}

/**
 * Construye un mensaje MIME multipart/alternative (texto + HTML).
 * Los valores de cabecera se sanean para impedir inyeccion CRLF.
 * @param {{from:string, fromName:string, to:string, cc?:string, replyTo?:string, subject:string, text:string, html:string}} msg
 */
export function buildMime(msg) {
  const boundary = `b_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const h = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim();
  const headers = [
    `From: ${encodeHeaderName(msg.fromName)} <${h(msg.from)}>`,
    `To: ${h(msg.to)}`,
  ];
  if (msg.cc) headers.push(`Cc: ${h(msg.cc)}`);
  if (msg.replyTo) headers.push(`Reply-To: ${h(msg.replyTo)}`);
  headers.push(
    `Subject: ${encodeHeaderValue(msg.subject)}`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  );

  // La linea en blanco (CRLF CRLF) que separa cabeceras de cuerpo es
  // obligatoria: sin ella el cliente no reconoce el multipart.
  const body = [
    '',
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Utf8(msg.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Utf8(msg.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return headers.join('\r\n') + body;
}

/**
 * Envia el mensaje por la API de Gmail.
 * @param {any} env @param {ReturnType<typeof buildMime>} mime
 * @returns {Promise<{id:string, threadId:string}>}
 */
export async function sendViaGmail(env, mime) {
  const provider = env.MAIL_PROVIDER;
  const token =
    provider === 'gmail_oauth' ? await getOAuthToken(env) : await getServiceAccountToken(env);

  const res = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(new TextEncoder().encode(mime)) }),
  });
  const data = await res.json();
  if (!res.ok) {
    const detail = data && data.error ? data.error.message : `HTTP ${res.status}`;
    throw new Error(`Gmail API: ${detail}`);
  }
  return { id: data.id, threadId: data.threadId };
}

/** Codifica un nombre para cabecera MIME si contiene caracteres no ASCII. */
function encodeHeaderName(name) {
  const s = String(name || '').replace(/[\r\n]+/g, ' ').trim();
  if (!s) return '';
  return /^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/"/g, '')}"` : encodeHeaderValue(s);
}

/** RFC 2047: codifica cabeceras con caracteres no ASCII (acentos en asuntos). */
export function encodeHeaderValue(value) {
  const s = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${base64Utf8(s).replace(/\r?\n/g, '')}?=`;
}

/** base64 estandar (con padding) de una cadena UTF-8. */
function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  // Gmail acepta lineas largas, pero se troza a 76 chars por compatibilidad MIME.
  return (b64.match(/.{1,76}/g) || []).join('\r\n');
}
