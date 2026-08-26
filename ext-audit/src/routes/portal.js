/**
 * Portal externo de validacion (sin sesion: autenticado por token de un solo
 * proposito). Es la unica superficie publica de la API.
 */
import { json, readJson, badRequest, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { openPortal, submitResponse } from '../services/requests.js';
import { logAudit } from '../lib/audit.js';

const MAX_ACCOUNTS_PER_SUBMIT = 2000;

/** GET /api/portal/:token */
export async function handleOpenPortal(ctx, token) {
  try {
    return json(await openPortal(ctx.env, token, ctx.request));
  } catch (e) {
    if (e.status === 404) {
      await logAudit(ctx.env, {
        actorType: 'external_admin', actorLabel: 'token_invalido', action: 'portal_token_rejected',
        entityType: 'validation_request', entityId: null,
        after: { prefix: String(token || '').slice(0, 8) }, request: ctx.request,
      });
    }
    throw e;
  }
}

/** POST /api/portal/:token/submit */
export async function handleSubmitPortal(ctx, token) {
  const body = await readJson(ctx.request, 2_000_000);
  const raw = v.array(body.decisions, 'decisions', MAX_ACCOUNTS_PER_SUBMIT);

  const decisions = raw.map((d, i) => {
    if (!d || typeof d !== 'object') throw badRequest(`Decision invalida en la posicion ${i + 1}`);
    const decision = v.oneOf(d.decision, `decisions[${i}].decision`, ['keep', 'disable'], true);
    const workerEndDate = v.dateOnly(d.workerEndDate, `decisions[${i}].workerEndDate`);
    const contractValidTo = v.dateOnly(d.contractValidTo, `decisions[${i}].contractValidTo`);

    // Regla de negocio: dar de baja exige justificar con la fecha de termino
    // del trabajador, salvo que se deje un comentario explicito.
    if (decision === 'disable' && !workerEndDate && !v.str(d.comment, `decisions[${i}].comment`, { max: 500, multiline: true })) {
      throw badRequest('Para dar de baja debe indicar la fecha de termino del trabajador o un comentario');
    }
    return {
      assignmentId: v.id(d.assignmentId, `decisions[${i}].assignmentId`, true),
      decision,
      contractNumber: v.str(d.contractNumber, `decisions[${i}].contractNumber`, { max: 80 }),
      contractValidTo,
      workerEndDate,
      comment: v.str(d.comment, `decisions[${i}].comment`, { max: 500, multiline: true }),
    };
  });

  const result = await submitResponse(ctx.env, token, { decisions }, ctx.request);
  return json({ ok: true, ...result });
}
