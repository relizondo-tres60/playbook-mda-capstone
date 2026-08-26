/**
 * Validacion de inputs. Toda entrada externa pasa por aqui antes de tocar D1.
 */
import { badRequest } from './http.js';
import { isValidDateOnly } from './dates.js';
import { isValidEmail } from './normalize.js';

/**
 * Detecta caracteres de control (C0 y DEL). Se usa como defensa contra
 * inyeccion de cabeceras de correo (CRLF) y contra basura binaria.
 * @param {string} s
 */
export function hasControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * @param {any} value @param {string} field @param {{max?:number, min?:number, required?:boolean, multiline?:boolean}} [opts]
 * @returns {string|null}
 */
export function str(value, field, opts = {}) {
  const { max = 255, min = 0, required = false, multiline = false } = opts;
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`El campo "${field}" es obligatorio`);
    return null;
  }
  if (typeof value !== 'string') throw badRequest(`El campo "${field}" debe ser texto`);
  const s = value.trim();
  if (s.length < min) throw badRequest(`El campo "${field}" debe tener al menos ${min} caracteres`);
  if (s.length > max) throw badRequest(`El campo "${field}" excede ${max} caracteres`);
  const probe = multiline ? s.replace(/[\r\n\t]/g, ' ') : s;
  if (hasControlChars(probe)) {
    throw badRequest(`El campo "${field}" contiene caracteres no permitidos`);
  }
  return s;
}

/** @param {any} value @param {string} field @param {boolean} required */
export function email(value, field, required = false) {
  const s = str(value, field, { max: 254, required });
  if (s === null) return null;
  if (!isValidEmail(s)) throw badRequest(`El campo "${field}" no es un correo valido`);
  return s.toLowerCase();
}

/** @param {any} value @param {string} field @param {string[]} allowed @param {boolean} required */
export function oneOf(value, field, allowed, required = false) {
  const s = str(value, field, { required });
  if (s === null) return null;
  if (!allowed.includes(s)) {
    throw badRequest(`El campo "${field}" debe ser uno de: ${allowed.join(', ')}`);
  }
  return s;
}

/** @param {any} value @param {string} field @param {{min?:number,max?:number,required?:boolean}} [opts] */
export function int(value, field, opts = {}) {
  const { min = -2147483648, max = 2147483647, required = false } = opts;
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`El campo "${field}" es obligatorio`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`El campo "${field}" debe ser un numero entero`);
  if (n < min || n > max) throw badRequest(`El campo "${field}" debe estar entre ${min} y ${max}`);
  return n;
}

/** Fecha en formato YYYY-MM-DD. */
export function dateOnly(value, field, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`El campo "${field}" es obligatorio`);
    return null;
  }
  const s = String(value).trim();
  if (!isValidDateOnly(s)) throw badRequest(`El campo "${field}" debe tener formato AAAA-MM-DD`);
  return s;
}

/** @param {any} value @param {string} field */
export function bool(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  throw badRequest(`El campo "${field}" debe ser booleano`);
}

/** Identificador opaco (UUID u otro token corto sin caracteres especiales). */
export function id(value, field, required = true) {
  const s = str(value, field, { max: 64, required });
  if (s === null) return null;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(s)) throw badRequest(`El campo "${field}" no es un identificador valido`);
  return s;
}

/** @param {any} value @param {string} field @param {number} maxItems */
export function array(value, field, maxItems = 5000) {
  if (!Array.isArray(value)) throw badRequest(`El campo "${field}" debe ser una lista`);
  if (value.length > maxItems) throw badRequest(`El campo "${field}" excede ${maxItems} elementos`);
  return value;
}

/** Paginacion consistente para todos los listados. */
export function pagination(url) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  return { limit, offset };
}
