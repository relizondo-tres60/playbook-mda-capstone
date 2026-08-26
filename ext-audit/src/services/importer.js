/**
 * Modulo de importacion de planillas de AD Manager.
 *
 * Acepta CSV, TSV y XLSX. Guarda el archivo original en R2 (evidencia
 * inmutable), mapea las cabeceras a campos canonicos, detecta cuentas EXT y
 * persiste tanto la fila cruda como los campos normalizados.
 */
import { uuid, sha256Hex } from '../lib/crypto.js';
import { nowIso, parseLooseDate } from '../lib/dates.js';
import { parseDelimited, toRecords, detectDelimiter } from '../lib/csv.js';
import { parseXlsx, looksLikeXlsx } from '../lib/xlsx.js';
import { badRequest } from '../lib/http.js';
import { batched, run } from '../lib/db.js';
import {
  mapColumns,
  applyColumnMap,
  detectExt,
  deriveSourceState,
  parseManager,
  parseBool,
  detectSite,
} from '../lib/normalize.js';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_ROWS = 20000;

/**
 * Convierte el archivo subido en una matriz de celdas.
 * @param {Uint8Array} bytes @param {string} filename
 * @returns {Promise<string[][]>}
 */
export async function parseSpreadsheet(bytes, filename) {
  if (bytes.length === 0) throw badRequest('El archivo esta vacio');
  if (bytes.length > MAX_FILE_BYTES) throw badRequest('El archivo supera el limite de 15 MB');

  const lower = String(filename || '').toLowerCase();
  if (looksLikeXlsx(bytes) || lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    try {
      return await parseXlsx(bytes);
    } catch (e) {
      throw badRequest(
        `No se pudo leer el XLSX (${e.message}). Exporte la planilla como CSV desde AD Manager y reintente.`
      );
    }
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  const rows = parseDelimited(text, detectDelimiter(text));
  if (rows.length === 0) throw badRequest('No se detectaron filas en el archivo');
  return rows;
}

/**
 * Analiza el archivo sin persistir nada: sirve para la vista previa del panel.
 * @param {Uint8Array} bytes @param {string} filename @param {'token'|'substring'} extMode
 */
export async function previewImport(bytes, filename, extMode = 'token') {
  const rows = await parseSpreadsheet(bytes, filename);
  const { headers, records } = toRecords(rows);
  if (headers.length === 0) throw badRequest('El archivo no tiene fila de cabecera');

  const { map, unmapped } = mapColumns(headers);
  if (!Object.values(map).includes('sam_account_name') && !Object.values(map).includes('upn')) {
    throw badRequest(
      'No se identifico la columna de cuenta (samAccountName o userPrincipalName). Revise la cabecera del archivo.',
      { headers }
    );
  }

  const normalized = records.slice(0, MAX_ROWS).map((r, i) => normalizeRow(r, map, i + 2, extMode));
  const ext = normalized.filter((r) => r.is_ext);

  return {
    headers,
    columnMap: map,
    unmappedHeaders: unmapped,
    rowCount: records.length,
    extCount: ext.length,
    sample: ext.slice(0, 20).map(toPreviewRow),
    companies: summarizeBy(ext, 'company_raw'),
    managers: summarizeBy(ext, 'manager_raw'),
    withoutCompany: ext.filter((r) => !r.company_raw).length,
    withoutManager: ext.filter((r) => !r.manager_raw && !r.manager_email).length,
  };
}

/**
 * Importa el archivo dentro de una campana.
 * @param {any} env
 * @param {{campaignId:string, bytes:Uint8Array, filename:string, contentType:string, userId:string|null, extMode:'token'|'substring'}} input
 */
export async function importFile(env, input) {
  const { campaignId, bytes, filename, contentType, userId, extMode } = input;

  const rows = await parseSpreadsheet(bytes, filename);
  const { headers, records } = toRecords(rows);
  const { map } = mapColumns(headers);
  if (!Object.values(map).includes('sam_account_name') && !Object.values(map).includes('upn')) {
    throw badRequest('No se identifico la columna de cuenta (samAccountName o userPrincipalName)', { headers });
  }
  if (records.length > MAX_ROWS) throw badRequest(`El archivo excede ${MAX_ROWS} filas`);

  const checksum = await sha256Hex(bytes);
  const importId = uuid();

  // Respaldo inmutable del archivo original en R2 (si el binding existe).
  let r2Key = null;
  if (env.FILES) {
    r2Key = `imports/${campaignId}/${importId}/${sanitizeFilename(filename)}`;
    try {
      await env.FILES.put(r2Key, bytes, {
        httpMetadata: { contentType: contentType || 'application/octet-stream' },
        customMetadata: { campaignId, importId, checksum, uploadedBy: userId || 'system' },
      });
    } catch (e) {
      console.error('r2_put_failed', e && e.message);
      r2Key = null;
    }
  }

  await run(
    env.DB,
    `INSERT INTO imports
       (id, campaign_id, filename, content_type, size_bytes, checksum, r2_key, source_system,
        row_count, ext_count, skipped_count, status, column_map, imported_by, created_at)
     VALUES (?,?,?,?,?,?,?, 'ad_manager', 0,0,0, 'processing', ?, ?, ?)`,
    [importId, campaignId, filename, contentType || null, bytes.length, checksum, r2Key, JSON.stringify(map), userId, nowIso()]
  );

  const seen = new Set();
  let extCount = 0;
  let skipped = 0;
  /** @type {any[]} */
  const statements = [];

  for (let i = 0; i < records.length; i++) {
    const normalized = normalizeRow(records[i], map, i + 2, extMode);
    if (!normalized.is_ext) continue;

    const sam = normalized.sam_account_name || normalized.upn || `sin-sam-${i}`;
    const dedupeKey = sam.toLowerCase();
    if (seen.has(dedupeKey)) {
      skipped++;
      continue;
    }
    seen.add(dedupeKey);
    extCount++;

    statements.push(
      env.DB.prepare(
        `INSERT INTO imported_accounts
           (id, import_id, campaign_id, row_number, raw_json, sam_account_name, display_name, upn, email,
            department, job_title, company_raw, manager_raw, manager_email, ou_path, site_raw,
            ad_enabled, ad_locked, ad_deleted, password_expired, last_logon_at, created_at_source,
            expires_at_source, is_ext, ext_reason, source_state, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)
         ON CONFLICT (campaign_id, sam_account_name) DO UPDATE SET
           raw_json = excluded.raw_json,
           display_name = excluded.display_name,
           upn = excluded.upn,
           email = excluded.email,
           department = excluded.department,
           job_title = excluded.job_title,
           company_raw = excluded.company_raw,
           manager_raw = excluded.manager_raw,
           manager_email = excluded.manager_email,
           ou_path = excluded.ou_path,
           site_raw = excluded.site_raw,
           ad_enabled = excluded.ad_enabled,
           ad_locked = excluded.ad_locked,
           ad_deleted = excluded.ad_deleted,
           last_logon_at = excluded.last_logon_at,
           source_state = excluded.source_state,
           ext_reason = excluded.ext_reason`
      ).bind(
        uuid(),
        importId,
        campaignId,
        normalized.row_number,
        JSON.stringify(records[i]),
        sam,
        normalized.display_name,
        normalized.upn,
        normalized.email,
        normalized.department,
        normalized.job_title,
        normalized.company_raw,
        normalized.manager_raw,
        normalized.manager_email,
        normalized.ou_path,
        normalized.site_raw,
        normalized.ad_enabled,
        normalized.ad_locked,
        normalized.ad_deleted,
        normalized.password_expired,
        normalized.last_logon_at,
        normalized.created_at_source,
        normalized.expires_at_source,
        normalized.ext_reason,
        normalized.source_state,
        nowIso()
      )
    );
  }

  await batched(env.DB, statements, 40);

  await run(
    env.DB,
    `UPDATE imports SET row_count = ?, ext_count = ?, skipped_count = ?, status = 'processed' WHERE id = ?`,
    [records.length, extCount, skipped, importId]
  );
  await run(
    env.DB,
    `UPDATE campaigns SET status = CASE WHEN status = 'draft' THEN 'imported' ELSE status END, updated_at = ? WHERE id = ?`,
    [nowIso(), campaignId]
  );

  return { importId, checksum, r2Key, rowCount: records.length, extCount, skipped, columnMap: map };
}

/**
 * Normaliza una fila cruda a campos canonicos.
 * @param {Record<string,string>} record @param {Record<string,string>} map
 * @param {number} rowNumber @param {'token'|'substring'} extMode
 */
export function normalizeRow(record, map, rowNumber, extMode = 'token') {
  const f = applyColumnMap(record, map);
  const manager = parseManager(f.manager_raw || '');
  const managerEmail = (f.manager_email || manager.email || '').toLowerCase() || null;

  const base = {
    row_number: rowNumber,
    sam_account_name: f.sam_account_name || null,
    display_name: f.display_name || null,
    upn: f.upn || null,
    email: f.email || null,
    department: f.department || null,
    job_title: f.job_title || null,
    company_raw: f.company_raw || null,
    manager_raw: manager.name || f.manager_raw || null,
    manager_email: managerEmail,
    ou_path: f.ou_path || null,
    site_raw: f.site_raw || detectSite(f.ou_path, f.department) || null,
    ad_enabled: boolToInt(parseBool(f.ad_enabled)),
    ad_locked: boolToInt(parseBool(f.ad_locked)),
    ad_deleted: boolToInt(parseBool(f.ad_deleted)),
    password_expired: boolToInt(parseBool(f.password_expired)),
    last_logon_at: parseLooseDate(f.last_logon_at),
    created_at_source: parseLooseDate(f.created_at_source),
    expires_at_source: parseLooseDate(f.expires_at_source),
  };

  const { isExt, reason } = detectExt(base, extMode);
  return {
    ...base,
    is_ext: isExt,
    ext_reason: reason,
    source_state: deriveSourceState({
      ad_enabled: f.ad_enabled,
      ad_locked: f.ad_locked,
      ad_deleted: f.ad_deleted,
    }),
  };
}

function boolToInt(v) {
  return v === null ? null : v ? 1 : 0;
}

function toPreviewRow(r) {
  return {
    samAccountName: r.sam_account_name,
    displayName: r.display_name,
    company: r.company_raw,
    manager: r.manager_raw,
    managerEmail: r.manager_email,
    site: r.site_raw,
    sourceState: r.source_state,
    extReason: r.ext_reason,
  };
}

/** Agrupa y cuenta valores de un campo, para la vista previa. */
function summarizeBy(rows, field) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const r of rows) {
    const key = r[field] || '(sin dato)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
}

/** Evita path traversal y caracteres problematicos en la clave de R2. */
function sanitizeFilename(name) {
  return String(name || 'archivo')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 120);
}
