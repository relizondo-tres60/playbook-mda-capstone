/**
 * Punto de entrada del Worker.
 *
 * Sirve dos superficies claramente segregadas:
 *   /api/portal/*  -> portal externo, autenticado por token de un solo proposito
 *   /api/*         -> panel interno, autenticado por sesion
 * Todo lo demas se resuelve contra los assets estaticos del frontend.
 *
 * Ademas expone un handler `scheduled` para el Cron Trigger diario que aplica
 * los recordatorios y el vencimiento automatico a los 14 dias.
 */
import { Router } from './router.js';
import {
  json, errorResponse, notFound, corsHeaders, withHeaders, assertSameOrigin, HttpError,
} from './lib/http.js';
import { resolveSession } from './services/auth.js';
import { runDailyJob } from './services/expiry.js';
import { uuid } from './lib/crypto.js';

import * as authRoutes from './routes/auth.js';
import * as campaignRoutes from './routes/campaigns.js';
import * as catalogRoutes from './routes/catalog.js';
import * as portalRoutes from './routes/portal.js';
import * as adminRoutes from './routes/admin.js';

const router = new Router();

// --- Publicas ---------------------------------------------------------------
router.get('/api/health', adminRoutes.handleHealth);
router.post('/api/setup', adminRoutes.handleSetup);
router.post('/api/auth/login', authRoutes.handleLogin);

// --- Portal externo (token) -------------------------------------------------
router.get('/api/portal/:token', portalRoutes.handleOpenPortal);
router.post('/api/portal/:token/submit', portalRoutes.handleSubmitPortal);

// --- Sesion interna ---------------------------------------------------------
router.post('/api/auth/logout', authRoutes.handleLogout);
router.get('/api/auth/me', authRoutes.handleMe);
router.post('/api/auth/password', authRoutes.handleChangePassword);
router.get('/api/users', authRoutes.handleListUsers);
router.post('/api/users', authRoutes.handleCreateUser);

// Campanas
router.get('/api/campaigns', campaignRoutes.handleListCampaigns);
router.post('/api/campaigns', campaignRoutes.handleCreateCampaign);
router.get('/api/campaigns/:id', campaignRoutes.handleGetCampaign);
router.get('/api/campaigns/:id/dashboard', campaignRoutes.handleDashboard);
router.post('/api/campaigns/:id/close', campaignRoutes.handleCloseCampaign);
router.post('/api/campaigns/:id/import', campaignRoutes.handleImport);
router.post('/api/campaigns/:id/rebuild-assignments', campaignRoutes.handleRebuildAssignments);
router.get('/api/campaigns/:id/accounts', campaignRoutes.handleListAccounts);
router.post('/api/campaigns/:id/generate-requests', campaignRoutes.handleGenerateRequests);
router.post('/api/campaigns/:id/send', campaignRoutes.handleSendCampaign);
router.get('/api/campaigns/:id/export/:kind', campaignRoutes.handleExport);
router.post('/api/imports/preview', campaignRoutes.handlePreviewImport);

// Asignaciones y solicitudes
router.patch('/api/assignments/:id', campaignRoutes.handleReassign);
router.post('/api/assignments/:id/decision', campaignRoutes.handleInternalDecision);
router.get('/api/requests/:id', campaignRoutes.handleRequestDetail);
router.post('/api/requests/:id/resend', campaignRoutes.handleResendRequest);

// Catalogo maestro
router.get('/api/companies', catalogRoutes.handleListCompanies);
router.post('/api/companies', catalogRoutes.handleCreateCompany);
router.get('/api/companies/duplicates', catalogRoutes.handleDuplicateCompanies);
router.get('/api/companies/:id', catalogRoutes.handleCompanyDetail);
router.patch('/api/companies/:id', catalogRoutes.handleUpdateCompany);
router.post('/api/companies/:id/aliases', catalogRoutes.handleAddAlias);
router.post('/api/companies/:id/merge', catalogRoutes.handleMergeCompanies);
router.get('/api/administrators', catalogRoutes.handleListAdministrators);
router.post('/api/administrators', catalogRoutes.handleCreateAdministrator);
router.patch('/api/administrators/:id', catalogRoutes.handleUpdateAdministrator);
router.delete('/api/administrators/:id', catalogRoutes.handleDeactivateAdministrator);

// Operacion y auditoria
router.get('/api/audit', adminRoutes.handleAuditLog);
router.get('/api/emails', adminRoutes.handleEmailLog);
router.get('/api/settings', adminRoutes.handleGetSettings);
router.put('/api/settings', adminRoutes.handleUpdateSettings);
router.get('/api/mail/status', adminRoutes.handleMailStatus);
router.post('/api/jobs/daily', adminRoutes.handleRunDailyJob);
router.post('/api/jobs/expire', adminRoutes.handleRunExpiry);
router.post('/api/jobs/reminders', adminRoutes.handleRunReminders);

/** Rutas que no requieren sesion interna. */
const PUBLIC_ROUTES = new Set(['/api/health', '/api/setup', '/api/auth/login']);
const isPortalRoute = (p) => p.startsWith('/api/portal/');

export default {
  /**
   * @param {Request} request @param {any} env @param {any} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const requestId = uuid();
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Fuera de /api el Worker delega en los assets estaticos del frontend.
    // El binding de assets resuelve la raiz y las rutas sin extension.
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Frontend no disponible en este despliegue', { status: 404 });
    }

    try {
      assertSameOrigin(request, env);

      const match = router.match(request.method, url.pathname);
      if (!match) throw notFound('Endpoint no encontrado');
      if (!match.handler) throw new HttpError(405, 'method_not_allowed', 'Metodo no permitido para este endpoint');

      const requestCtx = { request, env, ctx, url, requestId, user: null };

      // El portal externo nunca lee la cookie de sesion interna: la
      // segregacion entre ambas superficies es explicita.
      if (!isPortalRoute(url.pathname) && !PUBLIC_ROUTES.has(url.pathname)) {
        requestCtx.user = await resolveSession(env, request);
      }

      const response = await match.handler(requestCtx, ...match.params);
      return withHeaders(response, cors);
    } catch (err) {
      return withHeaders(errorResponse(err, requestId), cors);
    }
  },

  /**
   * Cron Trigger diario: recordatorios y vencimiento automatico.
   * @param {any} event @param {any} env @param {any} ctx
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runDailyJob(env)
        .then((r) =>
          console.log('daily_job', JSON.stringify({
            cron: event.cron,
            reminders: r.reminders.length,
            expiredRequests: r.expiry.expiredRequests,
            accountsMarked: r.expiry.accountsMarked,
          }))
        )
        .catch((e) => console.error('daily_job_failed', e && e.stack ? e.stack : String(e)))
    );
  },
};
