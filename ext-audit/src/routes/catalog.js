/**
 * Rutas del catalogo maestro: empresas, alias y administradores de contrato.
 */
import { json, readJson, badRequest, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireRole, requireUser } from '../services/auth.js';
import { logUserChange } from '../lib/audit.js';
import { all, first, run } from '../lib/db.js';
import { uuid } from '../lib/crypto.js';
import { nowIso } from '../lib/dates.js';
import { companyKey, canonicalCompanyName, normalizeEmail } from '../lib/normalize.js';
import { findDuplicateCompanies, mergeCompanies } from '../services/matching.js';

// --- Empresas ---------------------------------------------------------------

export async function handleListCompanies(ctx) {
  requireUser(ctx);
  const search = ctx.url.searchParams.get('search');
  const { limit, offset } = v.pagination(ctx.url);
  const params = [];
  let where = "WHERE c.status = 'active'";
  if (search) {
    where += ' AND LOWER(c.canonical_name) LIKE ?';
    params.push(`%${String(search).toLowerCase().slice(0, 80)}%`);
  }
  const companies = await all(
    ctx.env.DB,
    `SELECT c.*,
            (SELECT COUNT(*) FROM contract_administrators ca WHERE ca.company_id = c.id AND ca.status = 'active') AS admins_count,
            (SELECT COUNT(*) FROM company_aliases a WHERE a.company_id = c.id) AS aliases_count,
            (SELECT COUNT(*) FROM imported_accounts ia WHERE ia.normalized_company_id = c.id) AS accounts_count
       FROM companies c ${where}
      ORDER BY c.canonical_name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return json({ companies });
}

export async function handleCreateCompany(ctx) {
  requireRole(ctx, 'operator');
  const body = await readJson(ctx.request);
  const name = v.str(body.name, 'name', { max: 200, required: true });
  const taxId = v.str(body.taxId, 'taxId', { max: 20 });
  const key = companyKey(name);
  if (!key) throw badRequest('El nombre de la empresa no es valido');

  const exists = await first(ctx.env.DB, 'SELECT * FROM companies WHERE normalized_key = ?', [key]);
  if (exists) throw badRequest(`Ya existe la empresa "${exists.canonical_name}"`, { companyId: exists.id });

  const id = uuid();
  await run(
    ctx.env.DB,
    `INSERT INTO companies (id, canonical_name, normalized_key, tax_id, status, created_at, updated_at)
     VALUES (?,?,?,?, 'active', ?, ?)`,
    [id, canonicalCompanyName(name), key, taxId, nowIso(), nowIso()]
  );
  await logUserChange(ctx.env, ctx, {
    action: 'company_created', entityType: 'company', entityId: id, after: { name, key },
  });
  return json({ company: await first(ctx.env.DB, 'SELECT * FROM companies WHERE id = ?', [id]) }, 201);
}

export async function handleUpdateCompany(ctx, companyId) {
  requireRole(ctx, 'operator');
  const id = v.id(companyId, 'companyId');
  const before = await first(ctx.env.DB, 'SELECT * FROM companies WHERE id = ?', [id]);
  if (!before) throw notFound('Empresa no encontrada');

  const body = await readJson(ctx.request);
  const name = v.str(body.name, 'name', { max: 200 }) ?? before.canonical_name;
  const taxId = body.taxId === undefined ? before.tax_id : v.str(body.taxId, 'taxId', { max: 20 });
  const notes = body.notes === undefined ? before.notes : v.str(body.notes, 'notes', { max: 1000, multiline: true });

  await run(
    ctx.env.DB,
    'UPDATE companies SET canonical_name = ?, normalized_key = ?, tax_id = ?, notes = ?, updated_at = ? WHERE id = ?',
    [canonicalCompanyName(name), companyKey(name), taxId, notes, nowIso(), id]
  );
  const after = await first(ctx.env.DB, 'SELECT * FROM companies WHERE id = ?', [id]);
  await logUserChange(ctx.env, ctx, {
    action: 'company_updated', entityType: 'company', entityId: id, before, after,
  });
  return json({ company: after });
}

export async function handleAddAlias(ctx, companyId) {
  requireRole(ctx, 'operator');
  const id = v.id(companyId, 'companyId');
  const body = await readJson(ctx.request);
  const alias = v.str(body.alias, 'alias', { max: 200, required: true });
  const key = companyKey(alias);
  if (!key) throw badRequest('El alias no es valido');

  const taken = await first(ctx.env.DB, 'SELECT company_id FROM company_aliases WHERE normalized_key = ?', [key]);
  if (taken) throw badRequest('Ese alias ya esta asignado a otra empresa');
  const collides = await first(ctx.env.DB, 'SELECT id FROM companies WHERE normalized_key = ? AND id <> ?', [key, id]);
  if (collides) throw badRequest('Ese alias coincide con el nombre de otra empresa: use la fusion en su lugar');

  const aliasId = uuid();
  await run(
    ctx.env.DB,
    `INSERT INTO company_aliases (id, company_id, alias, normalized_key, source, created_at) VALUES (?,?,?,?, 'manual', ?)`,
    [aliasId, id, alias, key, nowIso()]
  );
  await logUserChange(ctx.env, ctx, {
    action: 'company_alias_added', entityType: 'company', entityId: id, after: { alias, key },
  });
  return json({ alias: { id: aliasId, alias, normalizedKey: key } }, 201);
}

export async function handleCompanyDetail(ctx, companyId) {
  requireUser(ctx);
  const id = v.id(companyId, 'companyId');
  const company = await first(ctx.env.DB, 'SELECT * FROM companies WHERE id = ?', [id]);
  if (!company) throw notFound('Empresa no encontrada');
  const aliases = await all(ctx.env.DB, 'SELECT * FROM company_aliases WHERE company_id = ? ORDER BY alias', [id]);
  const admins = await all(
    ctx.env.DB,
    'SELECT * FROM contract_administrators WHERE company_id = ? ORDER BY is_default DESC, full_name',
    [id]
  );
  return json({ company, aliases, administrators: admins });
}

export async function handleDuplicateCompanies(ctx) {
  requireUser(ctx);
  return json({ duplicates: await findDuplicateCompanies(ctx.env) });
}

export async function handleMergeCompanies(ctx, companyId) {
  requireRole(ctx, 'operator');
  const sourceId = v.id(companyId, 'companyId');
  const body = await readJson(ctx.request);
  const targetId = v.id(body.targetId, 'targetId');

  try {
    const { source, target } = await mergeCompanies(ctx.env, sourceId, targetId);
    await logUserChange(ctx.env, ctx, {
      action: 'companies_merged', entityType: 'company', entityId: targetId,
      before: { source: source.canonical_name }, after: { target: target.canonical_name },
    });
    return json({ ok: true, merged: { from: source.canonical_name, into: target.canonical_name } });
  } catch (e) {
    throw badRequest(e.message);
  }
}

// --- Administradores de contrato -------------------------------------------

export async function handleListAdministrators(ctx) {
  requireUser(ctx);
  const q = ctx.url.searchParams;
  const { limit, offset } = v.pagination(ctx.url);
  const params = [];
  let where = "WHERE ca.status = 'active'";
  if (q.get('companyId')) {
    where += ' AND ca.company_id = ?';
    params.push(q.get('companyId'));
  }
  if (q.get('search')) {
    where += ' AND (LOWER(ca.full_name) LIKE ? OR LOWER(ca.email) LIKE ? OR LOWER(co.canonical_name) LIKE ?)';
    const like = `%${String(q.get('search')).toLowerCase().slice(0, 80)}%`;
    params.push(like, like, like);
  }
  const administrators = await all(
    ctx.env.DB,
    `SELECT ca.*, co.canonical_name AS company_name
       FROM contract_administrators ca JOIN companies co ON co.id = ca.company_id
       ${where} ORDER BY co.canonical_name, ca.full_name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return json({ administrators });
}

export async function handleCreateAdministrator(ctx) {
  requireRole(ctx, 'operator');
  const body = await readJson(ctx.request);
  const data = parseAdminBody(body, true);

  const company = await first(ctx.env.DB, 'SELECT * FROM companies WHERE id = ?', [data.companyId]);
  if (!company) throw notFound('Empresa no encontrada');

  const dupe = await first(
    ctx.env.DB,
    `SELECT id FROM contract_administrators
      WHERE company_id = ? AND email_normalized = ? AND COALESCE(site, '') = COALESCE(?, '')`,
    [data.companyId, data.email, data.site]
  );
  if (dupe) throw badRequest('Ya existe ese administrador para la empresa y faena indicadas');

  const id = uuid();
  await run(
    ctx.env.DB,
    `INSERT INTO contract_administrators
       (id, company_id, full_name, email, email_normalized, phone, site, contract_number,
        contract_valid_from, contract_valid_to, is_default, status, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'active', ?, ?, ?)`,
    [id, data.companyId, data.fullName, data.email, data.email, data.phone, data.site, data.contractNumber,
     data.validFrom, data.validTo, data.isDefault ? 1 : 0, data.notes, nowIso(), nowIso()]
  );
  if (data.isDefault) await clearOtherDefaults(ctx.env, data.companyId, id);

  await logUserChange(ctx.env, ctx, {
    action: 'administrator_created', entityType: 'contract_administrator', entityId: id,
    after: { company: company.canonical_name, email: data.email, site: data.site },
  });
  return json({ administrator: await first(ctx.env.DB, 'SELECT * FROM contract_administrators WHERE id = ?', [id]) }, 201);
}

export async function handleUpdateAdministrator(ctx, administratorId) {
  requireRole(ctx, 'operator');
  const id = v.id(administratorId, 'administratorId');
  const before = await first(ctx.env.DB, 'SELECT * FROM contract_administrators WHERE id = ?', [id]);
  if (!before) throw notFound('Administrador no encontrado');

  const body = await readJson(ctx.request);
  const data = parseAdminBody({ companyId: before.company_id, ...body }, false);

  await run(
    ctx.env.DB,
    `UPDATE contract_administrators
        SET full_name = ?, email = ?, email_normalized = ?, phone = ?, site = ?, contract_number = ?,
            contract_valid_from = ?, contract_valid_to = ?, is_default = ?, status = ?, notes = ?, updated_at = ?
      WHERE id = ?`,
    [
      data.fullName ?? before.full_name,
      data.email ?? before.email,
      data.email ?? before.email_normalized,
      data.phone ?? before.phone,
      data.site ?? before.site,
      data.contractNumber ?? before.contract_number,
      data.validFrom ?? before.contract_valid_from,
      data.validTo ?? before.contract_valid_to,
      data.isDefault === null ? before.is_default : data.isDefault ? 1 : 0,
      data.status ?? before.status,
      data.notes ?? before.notes,
      nowIso(),
      id,
    ]
  );
  if (data.isDefault) await clearOtherDefaults(ctx.env, before.company_id, id);

  const after = await first(ctx.env.DB, 'SELECT * FROM contract_administrators WHERE id = ?', [id]);
  await logUserChange(ctx.env, ctx, {
    action: 'administrator_updated', entityType: 'contract_administrator', entityId: id, before, after,
  });
  return json({ administrator: after });
}

export async function handleDeactivateAdministrator(ctx, administratorId) {
  requireRole(ctx, 'operator');
  const id = v.id(administratorId, 'administratorId');
  const before = await first(ctx.env.DB, 'SELECT * FROM contract_administrators WHERE id = ?', [id]);
  if (!before) throw notFound('Administrador no encontrado');

  await run(ctx.env.DB, "UPDATE contract_administrators SET status = 'inactive', updated_at = ? WHERE id = ?", [nowIso(), id]);
  await logUserChange(ctx.env, ctx, {
    action: 'administrator_deactivated', entityType: 'contract_administrator', entityId: id, before,
  });
  return json({ ok: true });
}

function parseAdminBody(body, required) {
  return {
    companyId: v.id(body.companyId, 'companyId', required),
    fullName: v.str(body.fullName, 'fullName', { max: 150, required }),
    email: body.email === undefined ? null : normalizeEmail(v.email(body.email, 'email', required) || ''),
    phone: v.str(body.phone, 'phone', { max: 40 }),
    site: v.str(body.site, 'site', { max: 120 }),
    contractNumber: v.str(body.contractNumber, 'contractNumber', { max: 80 }),
    validFrom: v.dateOnly(body.contractValidFrom, 'contractValidFrom'),
    validTo: v.dateOnly(body.contractValidTo, 'contractValidTo'),
    isDefault: v.bool(body.isDefault, 'isDefault'),
    status: v.oneOf(body.status, 'status', ['active', 'inactive']),
    notes: v.str(body.notes, 'notes', { max: 1000, multiline: true }),
  };
}

/** Solo un administrador por defecto por empresa. */
async function clearOtherDefaults(env, companyId, keepId) {
  await run(env.DB, 'UPDATE contract_administrators SET is_default = 0 WHERE company_id = ? AND id <> ?', [companyId, keepId]);
}
