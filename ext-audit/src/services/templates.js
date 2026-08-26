/**
 * Plantillas de correo (HTML + texto plano).
 *
 * Todo dato dinamico pasa por escapeHtml antes de entrar al HTML. Los asuntos
 * se sanean para impedir inyeccion de cabeceras.
 */
import { formatCl, monthName } from '../lib/dates.js';

/** @param {any} v */
export function escapeHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Elimina CR/LF de un asunto (defensa contra inyeccion de cabeceras SMTP). */
export function sanitizeSubject(s) {
  return String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}

const BRAND = '#0b4a6f';
const BRAND_SOFT = '#eef5f9';

/** Envoltorio comun de todos los correos. */
function layout({ title, intro, bodyHtml, ctaUrl, ctaLabel, footerNote }) {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#1c2733;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #dfe6ec;">
        <tr><td style="background:${BRAND};padding:20px 28px;">
          <div style="color:#ffffff;font-size:18px;font-weight:600;">${escapeHtml(title)}</div>
          <div style="color:#cfe3ee;font-size:13px;margin-top:4px;">Auditoria de cuentas externas (EXT) &middot; Active Directory</div>
        </td></tr>
        <tr><td style="padding:26px 28px 8px 28px;font-size:15px;line-height:1.6;">
          ${intro}
        </td></tr>
        <tr><td style="padding:0 28px;">${bodyHtml}</td></tr>
        ${
          ctaUrl
            ? `<tr><td align="center" style="padding:26px 28px;">
                 <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:6px;">${escapeHtml(ctaLabel)}</a>
                 <div style="color:#6b7b8c;font-size:12px;margin-top:14px;word-break:break-all;">Si el boton no funciona, copie este enlace en su navegador:<br>${escapeHtml(ctaUrl)}</div>
               </td></tr>`
            : ''
        }
        <tr><td style="padding:18px 28px 26px 28px;border-top:1px solid #eef2f5;color:#6b7b8c;font-size:12px;line-height:1.6;">
          ${footerNote || ''}
          <div style="margin-top:10px;">Este enlace es personal, de un solo proposito y queda registrado para efectos de auditoria. No lo reenvie.</div>
          <div style="margin-top:10px;">Correo automatico. Ante dudas responda a este mensaje o contacte a la mesa de ayuda.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Tabla resumen de cuentas incluida en el correo. */
function accountsTable(accounts) {
  const rows = accounts
    .slice(0, 25)
    .map(
      (a) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eef2f5;font-size:13px;">${escapeHtml(a.sam_account_name || '')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eef2f5;font-size:13px;">${escapeHtml(a.display_name || '')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eef2f5;font-size:13px;">${escapeHtml(a.source_state === 'active' ? 'Activa' : a.source_state === 'disabled' ? 'Deshabilitada' : a.source_state === 'locked' ? 'Bloqueada' : 'Eliminada')}</td>
      </tr>`
    )
    .join('');
  const extra =
    accounts.length > 25
      ? `<div style="color:#6b7b8c;font-size:12px;margin-top:8px;">y ${accounts.length - 25} cuenta(s) mas en el portal.</div>`
      : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3eaf0;border-radius:8px;border-collapse:separate;">
    <tr style="background:${BRAND_SOFT};">
      <th align="left" style="padding:9px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#41586b;">Cuenta</th>
      <th align="left" style="padding:9px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#41586b;">Nombre</th>
      <th align="left" style="padding:9px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#41586b;">Estado en AD</th>
    </tr>${rows}
  </table>${extra}`;
}

/**
 * Correo de invitacion a validar.
 * @param {{admin:any, company:any, campaign:any, accounts:any[], url:string, dueAt:string}} data
 */
export function invitationEmail(data) {
  const { admin, company, campaign, accounts, url, dueAt } = data;
  const periodo = `${monthName(campaign.period_month)} ${campaign.period_year}`;
  const subject = sanitizeSubject(
    `[Accion requerida] Validacion de cuentas externas ${company.canonical_name} - ${periodo}`
  );

  const intro = `<p style="margin:0 0 12px 0;">Estimado/a <strong>${escapeHtml(admin.full_name)}</strong>,</p>
    <p style="margin:0 0 12px 0;">Como parte de la auditoria mensual de cuentas de acceso, le solicitamos validar las
    <strong>${accounts.length} cuenta(s) externa(s)</strong> asociadas a <strong>${escapeHtml(company.canonical_name)}</strong>${admin.site ? ` (${escapeHtml(admin.site)})` : ''}.</p>
    <p style="margin:0 0 12px 0;">Para cada cuenta debe indicar si <strong>se mantiene activa</strong> o <strong>debe darse de baja</strong>,
    y completar el numero de contrato, su vigencia y la fecha de termino del trabajador cuando corresponda.</p>
    <div style="background:#fff4e5;border-left:4px solid #d98324;padding:12px 14px;border-radius:4px;margin:16px 0;">
      <strong>Plazo de respuesta: ${escapeHtml(formatCl(dueAt))}</strong><br>
      <span style="font-size:13px;">Las cuentas sin respuesta dentro del plazo quedaran marcadas para deshabilitacion.</span>
    </div>`;

  const html = layout({
    title: `Validacion de cuentas externas - ${periodo}`,
    intro,
    bodyHtml: accountsTable(accounts),
    ctaUrl: url,
    ctaLabel: 'Validar cuentas ahora',
    footerNote: `<div><strong>Campana:</strong> ${escapeHtml(campaign.code)} &middot; <strong>Empresa:</strong> ${escapeHtml(company.canonical_name)}</div>`,
  });

  const text = [
    `Estimado/a ${admin.full_name},`,
    '',
    `Como parte de la auditoria mensual de cuentas de acceso, debe validar ${accounts.length} cuenta(s) externa(s) de ${company.canonical_name}.`,
    `Para cada cuenta indique si se mantiene activa o debe darse de baja.`,
    '',
    `PLAZO DE RESPUESTA: ${formatCl(dueAt)}`,
    'Las cuentas sin respuesta dentro del plazo quedaran marcadas para deshabilitacion.',
    '',
    `Ingrese aqui para validar: ${url}`,
    '',
    `Campana: ${campaign.code}`,
    'Este enlace es personal y queda registrado para auditoria. No lo reenvie.',
  ].join('\n');

  return { subject, html, text };
}

/** Recordatorio antes del vencimiento. */
export function reminderEmail(data) {
  const { admin, company, campaign, accounts, url, dueAt, daysLeft } = data;
  const periodo = `${monthName(campaign.period_month)} ${campaign.period_year}`;
  const plazo =
    daysLeft <= 0 ? 'vence hoy' : daysLeft === 1 ? 'vence manana' : `vence en ${daysLeft} dias`;
  const subject = sanitizeSubject(
    `[Recordatorio] Validacion de cuentas externas ${company.canonical_name} - ${plazo}`
  );

  const intro = `<p style="margin:0 0 12px 0;">Estimado/a <strong>${escapeHtml(admin.full_name)}</strong>,</p>
    <p style="margin:0 0 12px 0;">Aun no recibimos su validacion de las <strong>${accounts.length} cuenta(s) externa(s)</strong>
    de <strong>${escapeHtml(company.canonical_name)}</strong> correspondientes a la campana de ${escapeHtml(periodo)}.</p>
    <div style="background:#fdecea;border-left:4px solid #c0392b;padding:12px 14px;border-radius:4px;margin:16px 0;">
      <strong>El plazo ${escapeHtml(plazo)}: ${escapeHtml(formatCl(dueAt))}</strong><br>
      <span style="font-size:13px;">Transcurrido el plazo, las cuentas sin confirmacion se marcaran para deshabilitacion.</span>
    </div>`;

  const html = layout({
    title: `Recordatorio: validacion pendiente - ${periodo}`,
    intro,
    bodyHtml: accountsTable(accounts),
    ctaUrl: url,
    ctaLabel: 'Validar cuentas ahora',
    footerNote: `<div><strong>Campana:</strong> ${escapeHtml(campaign.code)}</div>`,
  });

  const text = [
    `Estimado/a ${admin.full_name},`,
    '',
    `Aun no recibimos su validacion de ${accounts.length} cuenta(s) externa(s) de ${company.canonical_name} (${periodo}).`,
    `El plazo ${plazo}: ${formatCl(dueAt)}.`,
    'Transcurrido el plazo, las cuentas sin confirmacion se marcaran para deshabilitacion.',
    '',
    `Ingrese aqui para validar: ${url}`,
  ].join('\n');

  return { subject, html, text };
}

/** Acuse de recibo enviado al administrador tras responder. */
export function confirmationEmail(data) {
  const { admin, company, campaign, keep, disable, respondedAt } = data;
  const periodo = `${monthName(campaign.period_month)} ${campaign.period_year}`;
  const subject = sanitizeSubject(
    `Confirmacion recibida - cuentas externas ${company.canonical_name} (${periodo})`
  );

  const intro = `<p style="margin:0 0 12px 0;">Estimado/a <strong>${escapeHtml(admin.full_name)}</strong>,</p>
    <p style="margin:0 0 12px 0;">Registramos su validacion de cuentas externas de
    <strong>${escapeHtml(company.canonical_name)}</strong> el ${escapeHtml(formatCl(respondedAt, true))} h.</p>`;

  const bodyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
      <tr>
        <td style="padding:14px;background:#eaf6ee;border-radius:8px;width:50%;">
          <div style="font-size:26px;font-weight:700;color:#1e7a43;">${keep}</div>
          <div style="font-size:13px;color:#31614a;">cuenta(s) se mantienen activas</div>
        </td>
        <td style="width:12px;"></td>
        <td style="padding:14px;background:#fdecea;border-radius:8px;width:50%;">
          <div style="font-size:26px;font-weight:700;color:#b03a2e;">${disable}</div>
          <div style="font-size:13px;color:#7d2e26;">cuenta(s) se daran de baja</div>
        </td>
      </tr>
    </table>
    <p style="font-size:13px;color:#41586b;margin:16px 0 0 0;">Las bajas seran ejecutadas por el equipo de administracion de identidades.
    Si detecta un error, responda este correo antes del cierre de la campana.</p>`;

  const html = layout({
    title: 'Validacion registrada',
    intro,
    bodyHtml,
    ctaUrl: null,
    ctaLabel: null,
    footerNote: `<div><strong>Campana:</strong> ${escapeHtml(campaign.code)} &middot; <strong>Empresa:</strong> ${escapeHtml(company.canonical_name)}</div>`,
  });

  const text = [
    `Estimado/a ${admin.full_name},`,
    '',
    `Registramos su validacion de cuentas externas de ${company.canonical_name} el ${formatCl(respondedAt, true)} h.`,
    `Se mantienen activas: ${keep}`,
    `Se daran de baja: ${disable}`,
    '',
    `Campana: ${campaign.code}`,
  ].join('\n');

  return { subject, html, text };
}

/** Aviso al administrador cuando su plazo vencio sin respuesta. */
export function expiryNoticeEmail(data) {
  const { admin, company, campaign, accounts, dueAt } = data;
  const periodo = `${monthName(campaign.period_month)} ${campaign.period_year}`;
  const subject = sanitizeSubject(
    `[Plazo vencido] Cuentas externas ${company.canonical_name} marcadas para baja`
  );

  const intro = `<p style="margin:0 0 12px 0;">Estimado/a <strong>${escapeHtml(admin.full_name)}</strong>,</p>
    <p style="margin:0 0 12px 0;">El plazo para validar las cuentas externas de <strong>${escapeHtml(company.canonical_name)}</strong>
    vencio el ${escapeHtml(formatCl(dueAt))} sin respuesta.</p>
    <p style="margin:0 0 12px 0;">En aplicacion de la politica de auditoria, <strong>${accounts.length} cuenta(s)</strong>
    quedaron marcadas para deshabilitacion.</p>
    <div style="background:#fdecea;border-left:4px solid #c0392b;padding:12px 14px;border-radius:4px;margin:16px 0;font-size:13px;">
      Si alguna de estas cuentas debe mantenerse, contacte a la mesa de ayuda indicando la campana ${escapeHtml(campaign.code)}.
    </div>`;

  const html = layout({
    title: `Plazo vencido - ${periodo}`,
    intro,
    bodyHtml: accountsTable(accounts),
    ctaUrl: null,
    ctaLabel: null,
    footerNote: `<div><strong>Campana:</strong> ${escapeHtml(campaign.code)}</div>`,
  });

  const text = [
    `Estimado/a ${admin.full_name},`,
    '',
    `El plazo para validar las cuentas externas de ${company.canonical_name} vencio el ${formatCl(dueAt)} sin respuesta.`,
    `${accounts.length} cuenta(s) quedaron marcadas para deshabilitacion.`,
    '',
    `Si alguna debe mantenerse, contacte a la mesa de ayuda indicando la campana ${campaign.code}.`,
  ].join('\n');

  return { subject, html, text };
}
