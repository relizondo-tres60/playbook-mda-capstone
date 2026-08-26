import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, sanitizeSubject, invitationEmail, reminderEmail, confirmationEmail, expiryNoticeEmail } from '../src/services/templates.js';
import { encodeHeaderValue, buildMime } from '../src/services/gmail.js';

const campaign = { code: 'EXT-2026-08', period_year: 2026, period_month: 8 };
const admin = { full_name: 'Juan Perez', site: 'Mantos Blancos' };
const company = { canonical_name: 'Servicios Integrales SPA' };
const accounts = [
  { sam_account_name: 'ext_jsoto', display_name: 'Jorge Soto', source_state: 'active' },
  { sam_account_name: 'ext_mrivas', display_name: 'Maria Rivas', source_state: 'disabled' },
];

test('escapeHtml neutraliza inyeccion de HTML en datos del origen', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('a & b "c"'), 'a &amp; b &quot;c&quot;');
  assert.equal(escapeHtml(null), '');
});

test('sanitizeSubject impide inyeccion de cabeceras de correo', () => {
  const s = sanitizeSubject('Asunto\r\nBcc: atacante@ejemplo.com');
  assert.ok(!s.includes('\r'));
  assert.ok(!s.includes('\n'));
});

test('el correo de invitacion lleva el enlace, el plazo y el conteo de cuentas', () => {
  const mail = invitationEmail({
    admin, company, campaign, accounts,
    url: 'https://ext-audit.tres60.cl/validar.html?t=TOKEN123',
    dueAt: '2026-08-20T12:00:00.000Z',
  });
  assert.ok(mail.subject.includes('Servicios Integrales SPA'));
  assert.ok(mail.html.includes('https://ext-audit.tres60.cl/validar.html?t=TOKEN123'));
  assert.ok(mail.text.includes('https://ext-audit.tres60.cl/validar.html?t=TOKEN123'));
  assert.ok(mail.html.includes('20-08-2026'), 'debe mostrar la fecha limite en formato chileno');
  assert.ok(mail.html.includes('2 cuenta(s) externa(s)'));
  assert.ok(mail.text.length > 100, 'debe existir version en texto plano');
});

test('los datos del origen se escapan dentro del cuerpo del correo', () => {
  const mail = invitationEmail({
    admin: { full_name: '<img src=x onerror=alert(1)>', site: null },
    company, campaign, accounts, url: 'https://x/validar.html?t=A', dueAt: '2026-08-20T12:00:00.000Z',
  });
  assert.ok(!mail.html.includes('<img src=x'));
  assert.ok(mail.html.includes('&lt;img src=x'));
});

test('el recordatorio refleja la urgencia segun los dias restantes', () => {
  assert.ok(reminderEmail({ admin, company, campaign, accounts, url: 'https://x', dueAt: '2026-08-20T12:00:00.000Z', daysLeft: 1 }).subject.includes('vence manana'));
  assert.ok(reminderEmail({ admin, company, campaign, accounts, url: 'https://x', dueAt: '2026-08-20T12:00:00.000Z', daysLeft: 0 }).subject.includes('vence hoy'));
  assert.ok(reminderEmail({ admin, company, campaign, accounts, url: 'https://x', dueAt: '2026-08-20T12:00:00.000Z', daysLeft: 7 }).subject.includes('7 dias'));
});

test('la confirmacion resume las dos decisiones posibles', () => {
  const mail = confirmationEmail({ admin, company, campaign, keep: 5, disable: 3, respondedAt: '2026-08-14T15:30:00.000Z' });
  assert.ok(mail.html.includes('>5<'));
  assert.ok(mail.html.includes('>3<'));
  assert.ok(mail.text.includes('Se mantienen activas: 5'));
  assert.ok(mail.text.includes('Se daran de baja: 3'));
});

test('el aviso de vencimiento explica la consecuencia y como revertirla', () => {
  const mail = expiryNoticeEmail({ admin, company, campaign, accounts, dueAt: '2026-08-20T12:00:00.000Z' });
  assert.ok(mail.subject.includes('Plazo vencido'));
  assert.ok(mail.text.includes('marcadas para deshabilitacion'));
  assert.ok(mail.text.includes('EXT-2026-08'));
});

test('encodeHeaderValue codifica acentos en RFC 2047 y deja ASCII intacto', () => {
  assert.equal(encodeHeaderValue('Validacion de cuentas'), 'Validacion de cuentas');
  const encoded = encodeHeaderValue('Validación de cuentas');
  assert.ok(encoded.startsWith('=?UTF-8?B?'));
  assert.ok(encoded.endsWith('?='));
});

test('buildMime arma un multipart valido y no permite inyectar cabeceras', () => {
  const mime = buildMime({
    from: 'relizondo@tres60.cl',
    fromName: 'Auditoria Tres60',
    to: 'juan@contratista.cl',
    cc: 'mesadeayuda@tres60.cl',
    replyTo: 'relizondo@tres60.cl',
    subject: 'Asunto\r\nBcc: atacante@ejemplo.com',
    text: 'hola',
    html: '<p>hola</p>',
  });
  assert.ok(mime.includes('From: "Auditoria Tres60" <relizondo@tres60.cl>'));
  assert.ok(mime.includes('To: juan@contratista.cl'));
  assert.ok(mime.includes('Cc: mesadeayuda@tres60.cl'));
  assert.ok(mime.includes('Content-Type: multipart/alternative'));
  assert.ok(!/^Bcc:/m.test(mime), 'no debe existir una cabecera Bcc inyectada');
  const headerBlock = mime.split('\r\n\r\n')[0];
  assert.ok(headerBlock.split('\r\n').every((line) => /^[A-Za-z-]+: /.test(line)));
});
