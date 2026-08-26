/**
 * Utilidades de fecha. Todo se persiste en ISO-8601 UTC; la presentacion al
 * usuario se hace en America/Santiago.
 */

export const TZ = 'America/Santiago';

/** @param {Date} [d] @returns {string} ISO UTC con milisegundos */
export function nowIso(d = new Date()) {
  return d.toISOString();
}

/** @param {string|Date} base @param {number} days */
export function addDays(base, days) {
  const d = base instanceof Date ? new Date(base.getTime()) : new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Diferencia en dias calendario completos entre dos instantes (b - a). */
export function daysBetween(a, b) {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.floor((db - da) / 86400000);
}

/** @param {string|Date} iso @returns {boolean} */
export function isPast(iso, ref = new Date()) {
  return new Date(iso).getTime() < ref.getTime();
}

/**
 * Formatea una fecha para mostrar al administrador de contrato.
 * @param {string|Date} iso @param {boolean} withTime
 */
export function formatCl(iso, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opts = { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit', hour12: false });
  return new Intl.DateTimeFormat('es-CL', opts).format(d);
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** @param {number} month 1-12 */
export function monthName(month) {
  return MESES[month - 1] || '';
}

/** Codigo canonico de campana: EXT-2026-08 */
export function campaignCode(year, month) {
  return `EXT-${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Normaliza fechas que llegan desde AD Manager en formatos heterogeneos:
 * ISO, dd/mm/yyyy, dd-mm-yyyy, yyyy/mm/dd, serial de Excel.
 * @param {any} value @returns {string|null} fecha ISO o null
 */
export function parseLooseDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const s = String(value).trim();
  if (!s || /^(n\/?a|never|nunca|-|--)$/i.test(s)) return null;

  // Serial de Excel (dias desde 1899-12-30)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      return new Date(Math.round((serial - 25569) * 86400000)).toISOString();
    }
  }

  // dd/mm/yyyy o dd-mm-yyyy (con hora opcional)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    const [, d, m, y, hh = '0', mm = '0', ss = '0'] = dmy;
    const dt = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  // yyyy-mm-dd / yyyy/mm/dd / ISO completo
  const ymd = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (ymd) {
    const [, y, m, d, hh = '0', mm = '0', ss = '0'] = ymd;
    const dt = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

/** Valida que un string sea una fecha YYYY-MM-DD razonable (formularios). */
export function isValidDateOnly(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
