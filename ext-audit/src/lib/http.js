/**
 * Helpers HTTP: respuestas JSON, errores tipificados, CORS y cabeceras de seguridad.
 */

export class HttpError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {any} [details] */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'No autenticado') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Sin permisos para esta accion') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Recurso no encontrado') => new HttpError(404, 'not_found', msg);
export const conflict = (msg, details) => new HttpError(409, 'conflict', msg, details);
export const tooMany = (msg = 'Demasiados intentos') => new HttpError(429, 'rate_limited', msg);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/**
 * @param {any} data @param {number} status @param {Record<string,string>} [headers]
 */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

/** @param {string} body @param {string} filename */
export function csvResponse(body, filename) {
  // BOM UTF-8 para que Excel en Windows respete los acentos.
  return new Response('\uFEFF' + body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });
}

/** Convierte cualquier error en una respuesta JSON segura (sin filtrar stack traces). */
export function errorResponse(err, requestId) {
  if (err instanceof HttpError) {
    return json(
      { error: err.code, message: err.message, details: err.details ?? undefined, requestId },
      err.status
    );
  }
  console.error('unhandled_error', requestId, err && err.stack ? err.stack : String(err));
  return json({ error: 'internal_error', message: 'Error interno del servidor', requestId }, 500);
}

/**
 * Politica CORS. Por defecto la API y el frontend viven en el mismo origen
 * (Workers Static Assets) y no se emite ninguna cabecera CORS.
 * Si el frontend se despliega aparte en Cloudflare Pages, se listan los
 * origenes permitidos en la variable ALLOWED_ORIGINS.
 * @param {Request} request @param {any} env
 */
export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Aplica cabeceras extra a una respuesta ya construida. */
export function withHeaders(response, headers) {
  if (!headers || Object.keys(headers).length === 0) return response;
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) r.headers.set(k, v);
  return r;
}

/**
 * Lee y valida el cuerpo JSON de una peticion.
 * @param {Request} request @param {number} maxBytes
 */
export async function readJson(request, maxBytes = 1_000_000) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) throw badRequest('Se esperaba Content-Type: application/json');
  const text = await request.text();
  if (text.length > maxBytes) throw badRequest('Cuerpo de la peticion demasiado grande');
  try {
    const parsed = JSON.parse(text || '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw badRequest('El cuerpo debe ser un objeto JSON');
    }
    return parsed;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw badRequest('JSON invalido');
  }
}

/** IP del cliente segun cabecera de Cloudflare. */
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
}

/**
 * Proteccion CSRF: en mutaciones con cookie de sesion exigimos que el Origin
 * pertenezca al propio servicio (o a la lista blanca) ademas de SameSite=Strict.
 * @param {Request} request @param {any} env
 */
export function assertSameOrigin(request, env) {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const origin = request.headers.get('Origin');
  if (!origin) return; // clientes no-navegador (curl, scripts) no envian Origin
  const self = new URL(request.url).origin;
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin !== self && !allowed.includes(origin)) {
    throw forbidden('Origen no permitido para esta operacion');
  }
}
