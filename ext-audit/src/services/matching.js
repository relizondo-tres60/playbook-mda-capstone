/**
 * Cruce de datos: cuenta EXT -> empresa -> administrador de contrato.
 *
 * Supuesto operativo del negocio: cerca del 80% de la asignacion viene
 * correcta desde origen. Este modulo produce esa asignacion automatica con un
 * puntaje de confianza y deja el resto en cola de revision manual, sin
 * inventar datos.
 *
 * Cascada de reglas (de mayor a menor confianza):
 *   R1  manager_email coincide exactamente con un administrador de la empresa
 *   R2  manager_email coincide con un administrador de otra empresa (alerta)
 *   R3  nombre del manager coincide con administrador de la empresa
 *   R4  empresa + faena detectada coinciden con un unico administrador
 *   R5  la empresa tiene un unico administrador activo
 *   R6  la empresa tiene administrador marcado por defecto
 *   --  sin match -> cola de revision manual
 */
import { uuid } from '../lib/crypto.js';
import { nowIso } from '../lib/dates.js';
import { all, first, run } from '../lib/db.js';
import {
  companyKey,
  canonicalCompanyName,
  companySimilarity,
  normalizeEmail,
  stripAccents,
  detectSite,
} from '../lib/normalize.js';

const AUTO_ASSIGN_THRESHOLD = 0.75;

/**
 * Resuelve (o crea) la empresa a partir del nombre crudo del origen.
 * @param {any} env
 * @param {string} rawName
 * @param {{create?: boolean, cache?: Map<string, any>}} [opts]
 * @returns {Promise<{company: any|null, matchRule: string, confidence: number, suggestions: any[]}>}
 */
export async function resolveCompany(env, rawName, opts = {}) {
  const { create = true, cache } = opts;
  const key = companyKey(rawName);
  if (!key) return { company: null, matchRule: 'sin_empresa', confidence: 0, suggestions: [] };

  if (cache && cache.has(key)) {
    return { company: cache.get(key), matchRule: 'cache', confidence: 1, suggestions: [] };
  }

  // R1: clave canonica exacta
  let company = await first(env.DB, "SELECT * FROM companies WHERE normalized_key = ? AND status = 'active'", [key]);
  let matchRule = 'empresa_exacta';
  let confidence = 1;

  // R2: alias registrado
  if (!company) {
    const alias = await first(
      env.DB,
      `SELECT c.* FROM company_aliases a JOIN companies c ON c.id = a.company_id
        WHERE a.normalized_key = ? AND c.status = 'active'`,
      [key]
    );
    if (alias) {
      company = alias;
      matchRule = 'empresa_alias';
      confidence = 0.98;
    }
  }

  // R3: similitud difusa -> se sugiere, pero no se fusiona sola
  let suggestions = [];
  if (!company) {
    const candidates = await all(env.DB, "SELECT id, canonical_name, normalized_key FROM companies WHERE status = 'active'");
    suggestions = candidates
      .map((c) => ({ ...c, score: companySimilarity(key, c.normalized_key) }))
      .filter((c) => c.score >= 0.82)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  if (!company && create) {
    const id = uuid();
    const canonical = canonicalCompanyName(rawName);
    await run(
      env.DB,
      `INSERT INTO companies (id, canonical_name, normalized_key, status, created_at, updated_at)
       VALUES (?,?,?, 'active', ?, ?)`,
      [id, canonical, key, nowIso(), nowIso()]
    );
    company = { id, canonical_name: canonical, normalized_key: key, status: 'active' };
    matchRule = suggestions.length ? 'empresa_nueva_con_sugerencias' : 'empresa_nueva';
    confidence = suggestions.length ? 0.5 : 0.9;
  }

  if (cache && company) cache.set(key, company);
  return { company, matchRule, confidence, suggestions };
}

/**
 * Elige el administrador de contrato para una cuenta.
 * @param {any} env
 * @param {{companyId: string|null, managerEmail: string|null, managerName: string|null, site: string|null}} input
 * @returns {Promise<{administrator: any|null, matchRule: string, confidence: number, warning: string|null}>}
 */
export async function resolveAdministrator(env, input) {
  const { companyId, managerEmail, managerName, site } = input;
  const mail = normalizeEmail(managerEmail || '');

  // R1: correo del manager coincide con administrador de la misma empresa
  if (mail && companyId) {
    const hit = await first(
      env.DB,
      "SELECT * FROM contract_administrators WHERE company_id = ? AND email_normalized = ? AND status = 'active'",
      [companyId, mail]
    );
    if (hit) return { administrator: hit, matchRule: 'R1_manager_email_empresa', confidence: 0.98, warning: null };
  }

  // R2: el correo existe pero registrado bajo otra empresa
  if (mail) {
    const other = await first(
      env.DB,
      "SELECT * FROM contract_administrators WHERE email_normalized = ? AND status = 'active'",
      [mail]
    );
    if (other) {
      return {
        administrator: other,
        matchRule: 'R2_manager_email_otra_empresa',
        confidence: 0.6,
        warning: 'El administrador esta registrado en otra empresa; verificar antes de enviar.',
      };
    }
  }

  if (!companyId) return { administrator: null, matchRule: 'sin_empresa', confidence: 0, warning: null };

  const admins = await all(
    env.DB,
    "SELECT * FROM contract_administrators WHERE company_id = ? AND status = 'active' ORDER BY is_default DESC, full_name",
    [companyId]
  );
  if (admins.length === 0) {
    return { administrator: null, matchRule: 'empresa_sin_administrador', confidence: 0, warning: null };
  }

  // R3: coincidencia por nombre del manager
  if (managerName) {
    const target = normalizeName(managerName);
    const byName = admins.filter((a) => normalizeName(a.full_name) === target);
    if (byName.length === 1) {
      return { administrator: byName[0], matchRule: 'R3_manager_nombre', confidence: 0.9, warning: null };
    }
    if (byName.length > 1 && site) {
      const bySite = byName.filter((a) => sameSite(a.site, site));
      if (bySite.length === 1) {
        return { administrator: bySite[0], matchRule: 'R3_manager_nombre_faena', confidence: 0.92, warning: null };
      }
    }
  }

  // R4: unico administrador para la faena detectada
  if (site) {
    const bySite = admins.filter((a) => sameSite(a.site, site));
    if (bySite.length === 1) {
      return { administrator: bySite[0], matchRule: 'R4_empresa_faena', confidence: 0.85, warning: null };
    }
    if (bySite.length > 1) {
      return {
        administrator: null,
        matchRule: 'R4_faena_ambigua',
        confidence: 0,
        warning: `La empresa tiene ${bySite.length} administradores en ${site}.`,
      };
    }
  }

  // R5: la empresa tiene un unico administrador activo
  if (admins.length === 1) {
    return { administrator: admins[0], matchRule: 'R5_unico_administrador', confidence: 0.8, warning: null };
  }

  // R6: administrador por defecto de la empresa
  const def = admins.find((a) => a.is_default === 1);
  if (def) {
    return {
      administrator: def,
      matchRule: 'R6_administrador_por_defecto',
      confidence: 0.65,
      warning: 'Asignado al administrador por defecto: confirmar faena/contrato.',
    };
  }

  return {
    administrator: null,
    matchRule: 'multiples_administradores',
    confidence: 0,
    warning: `La empresa tiene ${admins.length} administradores y no se pudo desambiguar.`,
  };
}

/**
 * Recalcula las asignaciones de una campana completa.
 * @param {any} env @param {string} campaignId @param {{onlyPending?: boolean}} [opts]
 * @returns {Promise<{total:number, autoAssigned:number, manualReview:number, unassigned:number}>}
 */
export async function rebuildAssignments(env, campaignId, opts = {}) {
  const { onlyPending = true } = opts;
  const accounts = await all(
    env.DB,
    `SELECT ia.*, aa.id AS assignment_id, aa.review_status
       FROM imported_accounts ia
       LEFT JOIN account_assignments aa ON aa.imported_account_id = ia.id
      WHERE ia.campaign_id = ? AND ia.is_ext = 1`,
    [campaignId]
  );

  const threshold = Number((await getSetting(env, 'auto_assign_threshold')) ?? AUTO_ASSIGN_THRESHOLD);
  const stats = { total: 0, autoAssigned: 0, manualReview: 0, unassigned: 0 };
  const companyCache = new Map();

  for (const acc of accounts) {
    if (onlyPending && acc.review_status && ['confirmed', 'manual_review', 'excluded'].includes(acc.review_status)) {
      continue;
    }
    stats.total++;

    const { company, matchRule: companyRule } = await resolveCompany(env, acc.company_raw || '', { cache: companyCache });
    const site = detectSite(acc.site_raw, acc.ou_path, acc.department);
    const { administrator, matchRule, confidence, warning } = await resolveAdministrator(env, {
      companyId: company ? company.id : null,
      managerEmail: acc.manager_email,
      managerName: acc.manager_raw,
      site,
    });

    let reviewStatus = 'manual_review';
    if (!company) reviewStatus = 'unassigned';
    else if (administrator && confidence >= threshold) reviewStatus = 'auto_assigned';
    else if (administrator) reviewStatus = 'manual_review';
    else reviewStatus = 'unassigned';

    if (reviewStatus === 'auto_assigned') stats.autoAssigned++;
    else if (reviewStatus === 'manual_review') stats.manualReview++;
    else stats.unassigned++;

    const rule = [companyRule, matchRule].filter(Boolean).join(' | ') + (warning ? ` | ${warning}` : '');

    if (company) {
      await run(env.DB, 'UPDATE imported_accounts SET normalized_company_id = ? WHERE id = ?', [company.id, acc.id]);
    }

    if (acc.assignment_id) {
      await run(
        env.DB,
        `UPDATE account_assignments
            SET company_id = ?, administrator_id = ?, site = ?, contract_number = COALESCE(contract_number, ?),
                assignment_source = 'auto', match_rule = ?, confidence = ?, review_status = ?, updated_at = ?
          WHERE id = ?`,
        [
          company ? company.id : null,
          administrator ? administrator.id : null,
          site,
          administrator ? administrator.contract_number : null,
          rule,
          confidence,
          reviewStatus,
          nowIso(),
          acc.assignment_id,
        ]
      );
    } else {
      await run(
        env.DB,
        `INSERT INTO account_assignments
           (id, campaign_id, imported_account_id, company_id, administrator_id, contract_number, site,
            assignment_source, match_rule, confidence, review_status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,'auto',?,?,?,?,?)`,
        [
          uuid(),
          campaignId,
          acc.id,
          company ? company.id : null,
          administrator ? administrator.id : null,
          administrator ? administrator.contract_number : null,
          site,
          rule,
          confidence,
          reviewStatus,
          nowIso(),
          nowIso(),
        ]
      );
    }
  }

  // Las cuentas ya eliminadas/deshabilitadas en origen no requieren accion:
  // se marcan como excluidas para no duplicar trabajo operativo.
  await run(
    env.DB,
    `UPDATE account_assignments
        SET review_status = 'excluded',
            final_decision = 'disable',
            decision_source = 'source_state',
            decided_at = COALESCE(decided_at, ?),
            updated_at = ?
      WHERE campaign_id = ?
        AND review_status <> 'confirmed'
        AND imported_account_id IN (
              SELECT id FROM imported_accounts
               WHERE campaign_id = ? AND source_state IN ('deleted','disabled'))`,
    [nowIso(), nowIso(), campaignId, campaignId]
  );

  return stats;
}

/** Detecta empresas probablemente duplicadas para la herramienta de normalizacion. */
export async function findDuplicateCompanies(env, minScore = 0.82) {
  const companies = await all(
    env.DB,
    `SELECT c.id, c.canonical_name, c.normalized_key,
            (SELECT COUNT(*) FROM imported_accounts ia WHERE ia.normalized_company_id = c.id) AS accounts_count
       FROM companies c WHERE c.status = 'active' ORDER BY c.canonical_name`
  );
  const pairs = [];
  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const score = companySimilarity(companies[i].normalized_key, companies[j].normalized_key);
      if (score >= minScore) pairs.push({ a: companies[i], b: companies[j], score: Number(score.toFixed(3)) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

/**
 * Fusiona una empresa dentro de otra, conservando el nombre origen como alias.
 * @param {any} env @param {string} sourceId @param {string} targetId
 */
export async function mergeCompanies(env, sourceId, targetId) {
  if (sourceId === targetId) throw new Error('No se puede fusionar una empresa consigo misma');
  const source = await first(env.DB, 'SELECT * FROM companies WHERE id = ?', [sourceId]);
  const target = await first(env.DB, 'SELECT * FROM companies WHERE id = ?', [targetId]);
  if (!source || !target) throw new Error('Empresa no encontrada');

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO company_aliases (id, company_id, alias, normalized_key, source, created_at)
       VALUES (?,?,?,?, 'merge', ?)`
    ).bind(uuid(), targetId, source.canonical_name, source.normalized_key, nowIso()),
    env.DB.prepare('UPDATE company_aliases SET company_id = ? WHERE company_id = ?').bind(targetId, sourceId),
    env.DB.prepare('UPDATE contract_administrators SET company_id = ? WHERE company_id = ?').bind(targetId, sourceId),
    env.DB.prepare('UPDATE imported_accounts SET normalized_company_id = ? WHERE normalized_company_id = ?').bind(targetId, sourceId),
    env.DB.prepare('UPDATE account_assignments SET company_id = ? WHERE company_id = ?').bind(targetId, sourceId),
    env.DB.prepare(
      "UPDATE companies SET status = 'merged', merged_into_id = ?, updated_at = ? WHERE id = ?"
    ).bind(targetId, nowIso(), sourceId),
  ]);
  return { source, target };
}

/** Lee un valor de la tabla settings. */
export async function getSetting(env, key) {
  const row = await first(env.DB, 'SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

/** @param {string} s */
function normalizeName(s) {
  return stripAccents(String(s || ''))
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compara dos faenas tolerando escrituras distintas. */
function sameSite(a, b) {
  if (!a || !b) return false;
  return normalizeName(a) === normalizeName(b) || detectSite(a) === detectSite(b);
}
