/**
 * Rutas de campanas: creacion, importacion, cruce, envio, exportacion.
 */
import { json, csvResponse, readJson, badRequest, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireRole, requireUser } from '../services/auth.js';
import { logUserChange } from '../lib/audit.js';
import {
  createCampaign, getCampaign, listCampaigns, campaignDashboard, closeCampaign,
  listCampaignAccounts, reassignAccount,
} from '../services/campaigns.js';
import { importFile, previewImport } from '../services/importer.js';
import { rebuildAssignments } from '../services/matching.js';
import { generateRequests, sendCampaignInvitations, resendRequest, accountsForRequest } from '../services/requests.js';
import { disableQueueCsv, disableQueuePowerShell, fullCampaignCsv, auditCsv, unassignedCsv } from '../services/exports.js';
import { all } from '../lib/db.js';

const MAX_UPLOAD = 15 * 1024 * 1024;

export async function handleListCampaigns(ctx) {
  requireUser(ctx);
  const { limit, offset } = v.pagination(ctx.url);
  return json({ campaigns: await listCampaigns(ctx.env, limit, offset) });
}

export async function handleCreateCampaign(ctx) {
  const user = requireRole(ctx, 'operator');
  const body = await readJson(ctx.request);
  const now = new Date();
  const year = v.int(body.year, 'year', { min: 2020, max: 2100 }) ?? now.getUTCFullYear();
  const month = v.int(body.month, 'month', { min: 1, max: 12 }) ?? now.getUTCMonth() + 1;
  const responseDays = v.int(body.responseDays, 'responseDays', { min: 1, max: 90 }) ?? Number(ctx.env.RESPONSE_DAYS || 14);
  const notes = v.str(body.notes, 'notes', { max: 1000, multiline: true });

  const campaign = await createCampaign(ctx.env, { year, month, responseDays, userId: user.id, notes });
  await logUserChange(ctx.env, ctx, {
    campaignId: campaign.id, action: 'campaign_created', entityType: 'campaign',
    entityId: campaign.id, after: { code: campaign.code, responseDays },
  });
  return json({ campaign }, 201);
}

export async function handleGetCampaign(ctx, id) {
  requireUser(ctx);
  return json({ campaign: await getCampaign(ctx.env, v.id(id, 'campaignId')) });
}

export async function handleDashboard(ctx, id) {
  requireUser(ctx);
  return json(await campaignDashboard(ctx.env, v.id(id, 'campaignId')));
}

export async function handleCloseCampaign(ctx, id) {
  requireRole(ctx, 'operator');
  const campaignId = v.id(id, 'campaignId');
  const campaign = await closeCampaign(ctx.env, campaignId);
  await logUserChange(ctx.env, ctx, {
    campaignId, action: 'campaign_closed', entityType: 'campaign', entityId: campaignId,
    after: { closedAt: campaign.closed_at },
  });
  return json({ campaign });
}

/** Lee el archivo del formulario multipart. */
async function readUpload(request) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('multipart/form-data')) throw badRequest('Se esperaba multipart/form-data con el campo "file"');
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw badRequest('Falta el archivo en el campo "file"');
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.length > MAX_UPLOAD) throw badRequest('El archivo supera el limite de 15 MB');
  return { bytes: buf, filename: file.name || 'planilla', contentType: file.type || 'application/octet-stream' };
}

export async function handlePreviewImport(ctx) {
  requireRole(ctx, 'operator');
  const { bytes, filename } = await readUpload(ctx.request);
  const extMode = ctx.env.EXT_MATCH_MODE === 'substring' ? 'substring' : 'token';
  return json(await previewImport(bytes, filename, extMode));
}

export async function handleImport(ctx, id) {
  const user = requireRole(ctx, 'operator');
  const campaignId = v.id(id, 'campaignId');
  const campaign = await getCampaign(ctx.env, campaignId);
  if (campaign.status === 'closed') throw badRequest('La campana esta cerrada');

  const { bytes, filename, contentType } = await readUpload(ctx.request);
  const extMode = ctx.env.EXT_MATCH_MODE === 'substring' ? 'substring' : 'token';

  const result = await importFile(ctx.env, { campaignId, bytes, filename, contentType, userId: user.id, extMode });
  const stats = await rebuildAssignments(ctx.env, campaignId);

  await logUserChange(ctx.env, ctx, {
    campaignId, action: 'import_processed', entityType: 'import', entityId: result.importId,
    after: { filename, checksum: result.checksum, rowCount: result.rowCount, extCount: result.extCount, assignments: stats },
  });
  return json({ import: result, assignments: stats }, 201);
}

export async function handleRebuildAssignments(ctx, id) {
  requireRole(ctx, 'operator');
  const campaignId = v.id(id, 'campaignId');
  const body = await readJson(ctx.request).catch(() => ({}));
  const force = v.bool(body.force, 'force') === true;

  const stats = await rebuildAssignments(ctx.env, campaignId, { onlyPending: !force });
  await logUserChange(ctx.env, ctx, {
    campaignId, action: 'assignments_rebuilt', entityType: 'campaign', entityId: campaignId,
    after: { force, ...stats },
  });
  return json({ assignments: stats });
}

export async function handleListAccounts(ctx, id) {
  requireUser(ctx);
  const campaignId = v.id(id, 'campaignId');
  const q = ctx.url.searchParams;
  const { limit, offset } = v.pagination(ctx.url);

  const result = await listCampaignAccounts(ctx.env, campaignId, {
    companyId: q.get('companyId') || null,
    administratorId: q.get('administratorId') || null,
    reviewStatus: q.get('reviewStatus') || null,
    decision: q.get('decision') || null,
    requestStatus: q.get('requestStatus') || null,
    sourceState: q.get('sourceState') || null,
    overdue: q.get('overdue') === 'true',
    search: q.get('search') ? String(q.get('search')).slice(0, 100) : null,
    limit,
    offset,
  });
  return json(result);
}

export async function handleReassign(ctx, assignmentId) {
  const user = requireRole(ctx, 'operator');
  const id = v.id(assignmentId, 'assignmentId');
  const body = await readJson(ctx.request);

  const input = {
    assignmentId: id,
    userId: user.id,
    contractNumber: body.contractNumber === undefined ? undefined : v.str(body.contractNumber, 'contractNumber', { max: 80 }),
    site: body.site === undefined ? undefined : v.str(body.site, 'site', { max: 120 }),
    reviewStatus: body.reviewStatus === undefined ? null : v.oneOf(body.reviewStatus, 'reviewStatus', ['manual_review', 'confirmed', 'unassigned', 'excluded']),
  };
  if (body.companyId !== undefined) input.companyId = body.companyId === null ? null : v.id(body.companyId, 'companyId');
  if (body.administratorId !== undefined) {
    input.administratorId = body.administratorId === null ? null : v.id(body.administratorId, 'administratorId');
  }

  const { before, after } = await reassignAccount(ctx.env, input);
  await logUserChange(ctx.env, ctx, {
    campaignId: before.campaign_id, action: 'assignment_reassigned', entityType: 'account_assignment',
    entityId: id, before, after,
  });
  return json({ assignment: after });
}

/** Decision manual del equipo interno (excepcion documentada). */
export async function handleInternalDecision(ctx, assignmentId) {
  requireRole(ctx, 'operator');
  const id = v.id(assignmentId, 'assignmentId');
  const body = await readJson(ctx.request);
  const decision = v.oneOf(body.decision, 'decision', ['keep', 'disable'], true);
  const reason = v.str(body.reason, 'reason', { max: 500, required: true, multiline: true });

  const before = await ctx.env.DB.prepare('SELECT * FROM account_assignments WHERE id = ?').bind(id).first();
  if (!before) throw notFound('Asignacion no encontrada');

  await ctx.env.DB.prepare(
    `UPDATE account_assignments
        SET final_decision = ?, decision_source = 'internal', decided_at = ?, review_status = 'confirmed', updated_at = ?
      WHERE id = ?`
  ).bind(decision, new Date().toISOString(), new Date().toISOString(), id).run();

  await logUserChange(ctx.env, ctx, {
    campaignId: before.campaign_id, action: 'internal_decision', entityType: 'account_assignment',
    entityId: id, before: { decision: before.final_decision }, after: { decision, reason },
  });
  return json({ ok: true, decision });
}

export async function handleGenerateRequests(ctx, id) {
  requireRole(ctx, 'operator');
  const campaignId = v.id(id, 'campaignId');
  const result = await generateRequests(ctx.env, campaignId);
  await logUserChange(ctx.env, ctx, {
    campaignId, action: 'requests_generated', entityType: 'campaign', entityId: campaignId, after: result,
  });
  return json(result);
}

export async function handleSendCampaign(ctx, id) {
  requireRole(ctx, 'operator');
  const campaignId = v.id(id, 'campaignId');
  const body = await readJson(ctx.request).catch(() => ({}));
  const only = body.requestIds ? v.array(body.requestIds, 'requestIds', 500).map((r) => v.id(r, 'requestId')) : null;
  const resend = v.bool(body.resend, 'resend') === true;

  const result = await sendCampaignInvitations(ctx.env, campaignId, { only, resend });
  await logUserChange(ctx.env, ctx, {
    campaignId, action: 'campaign_sent', entityType: 'campaign', entityId: campaignId,
    after: { total: result.total, sent: result.sent, failed: result.failed, resend },
  });
  return json(result);
}

export async function handleResendRequest(ctx, requestId) {
  requireRole(ctx, 'operator');
  const id = v.id(requestId, 'requestId');
  const result = await resendRequest(ctx.env, id);
  await logUserChange(ctx.env, ctx, {
    action: 'request_resent', entityType: 'validation_request', entityId: id, after: result,
  });
  return json(result);
}

export async function handleRequestDetail(ctx, requestId) {
  requireUser(ctx);
  const id = v.id(requestId, 'requestId');
  const request = await ctx.env.DB.prepare(
    `SELECT vr.*, ca.full_name AS administrator_name, ca.email AS administrator_email,
            co.canonical_name AS company_name
       FROM validation_requests vr
       JOIN contract_administrators ca ON ca.id = vr.administrator_id
       JOIN companies co ON co.id = vr.company_id
      WHERE vr.id = ?`
  ).bind(id).first();
  if (!request) throw notFound('Solicitud no encontrada');

  const accounts = await accountsForRequest(ctx.env, id);
  const emails = await all(
    ctx.env.DB,
    'SELECT id, kind, to_email, cc_email, subject, provider, status, error, attempts, created_at, sent_at FROM email_deliveries WHERE validation_request_id = ? ORDER BY created_at DESC',
    [id]
  );
  return json({ request, accounts, emails });
}

// --- Exportaciones ---------------------------------------------------------

export async function handleExport(ctx, id, kind) {
  requireUser(ctx);
  const campaignId = v.id(id, 'campaignId');
  const campaign = await getCampaign(ctx.env, campaignId);
  const stamp = campaign.code;

  if (kind === 'bajas') {
    const { csv, count } = await disableQueueCsv(ctx.env, campaignId);
    await logUserChange(ctx.env, ctx, {
      campaignId, action: 'export_disable_queue', entityType: 'campaign', entityId: campaignId, after: { count },
    });
    return csvResponse(csv, `bajas_${stamp}.csv`);
  }
  if (kind === 'bajas.ps1') {
    const { script, count } = await disableQueuePowerShell(ctx.env, campaignId);
    await logUserChange(ctx.env, ctx, {
      campaignId, action: 'export_disable_script', entityType: 'campaign', entityId: campaignId, after: { count },
    });
    return new Response(script, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="bajas_${stamp}.ps1"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  if (kind === 'completo') {
    const { csv } = await fullCampaignCsv(ctx.env, campaignId);
    return csvResponse(csv, `auditoria_completa_${stamp}.csv`);
  }
  if (kind === 'auditoria') {
    const { csv } = await auditCsv(ctx.env, campaignId);
    return csvResponse(csv, `bitacora_${stamp}.csv`);
  }
  if (kind === 'sin-administrador') {
    const { csv } = await unassignedCsv(ctx.env, campaignId);
    return csvResponse(csv, `sin_administrador_${stamp}.csv`);
  }
  throw notFound('Tipo de exportacion no reconocido');
}
