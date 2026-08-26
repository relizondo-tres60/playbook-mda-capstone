/**
 * Helpers sobre D1. Todas las consultas usan sentencias preparadas con
 * parametros ligados: no se concatena input de usuario en SQL.
 */

/** @param {any} db @param {string} sql @param {any[]} params */
export async function all(db, sql, params = []) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

/** @param {any} db @param {string} sql @param {any[]} params */
export async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

/** @param {any} db @param {string} sql @param {any[]} params */
export async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

/**
 * Ejecuta sentencias en lote. D1 limita el tamano por batch, asi que se
 * trocea: una importacion de cientos de cuentas cabe sin problemas.
 * @param {any} db @param {any[]} statements @param {number} chunkSize
 */
export async function batched(db, statements, chunkSize = 50) {
  for (let i = 0; i < statements.length; i += chunkSize) {
    await db.batch(statements.slice(i, i + chunkSize));
  }
}

/**
 * Construye una clausula WHERE a partir de filtros opcionales.
 * Las claves son fragmentos SQL con placeholders controlados por el servidor.
 * @param {Array<[string, any]>} conditions
 */
export function buildWhere(conditions) {
  const clauses = [];
  const params = [];
  for (const [sql, value] of conditions) {
    if (value === undefined || value === null || value === '') continue;
    clauses.push(sql);
    if (Array.isArray(value)) params.push(...value);
    else params.push(value);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** Genera una lista de placeholders "?,?,?" del largo indicado. */
export function placeholders(n) {
  return Array.from({ length: n }, () => '?').join(',');
}
