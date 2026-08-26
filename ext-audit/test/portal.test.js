import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalUrl, portalState } from '../src/services/requests.js';

const FUTURO = '2099-01-01T00:00:00.000Z';
const PASADO = '2020-01-01T00:00:00.000Z';

test('portalUrl emite el enlace sin extension .html', () => {
  const url = portalUrl({ APP_BASE_URL: 'https://ext-audit.tres60.cl' }, 'TOKEN123');
  // Con el manejo de assets por defecto de Cloudflare, /validar.html responde
  // un redirect 307 hacia /validar. El enlace del correo debe resolver de una
  // sola vez, asi que se emite ya sin la extension.
  assert.equal(url, 'https://ext-audit.tres60.cl/validar?t=TOKEN123');
  assert.ok(!url.includes('.html'));
});

test('portalUrl normaliza la barra final de APP_BASE_URL', () => {
  assert.equal(
    portalUrl({ APP_BASE_URL: 'https://ext-audit.tres60.cl///' }, 'ABC'),
    'https://ext-audit.tres60.cl/validar?t=ABC'
  );
});

test('portalUrl codifica el token para que sea seguro en una URL', () => {
  const url = portalUrl({ APP_BASE_URL: 'https://x.cl' }, 'a+b/c=d&e');
  assert.ok(!url.includes('&e'), 'un & sin codificar partiria la query string');
  assert.equal(url, 'https://x.cl/validar?t=a%2Bb%2Fc%3Dd%26e');
});

test('portalState abre el portal solo dentro del plazo y con la campana viva', () => {
  const base = { status: 'sent', due_at: FUTURO, expires_at: FUTURO, campaign_status: 'sent' };
  assert.equal(portalState(base), 'open');
  assert.equal(portalState({ ...base, status: 'opened' }), 'open');
});

test('portalState cierra el portal cuando corresponde', () => {
  const base = { status: 'sent', due_at: FUTURO, expires_at: FUTURO, campaign_status: 'sent' };
  assert.equal(portalState({ ...base, status: 'responded' }), 'responded',
    'una respuesta ya enviada no se puede rehacer desde el enlace');
  assert.equal(portalState({ ...base, status: 'cancelled' }), 'cancelled');
  assert.equal(portalState({ ...base, campaign_status: 'closed' }), 'closed');
  assert.equal(portalState({ ...base, due_at: PASADO }), 'expired',
    'pasado el plazo de 14 dias el portal queda en solo lectura');
  assert.equal(portalState({ ...base, expires_at: PASADO }), 'expired');
});

test('la respuesta ya enviada prevalece sobre el vencimiento', () => {
  // Quien respondio a tiempo debe seguir viendo su confirmacion despues del plazo.
  assert.equal(
    portalState({ status: 'responded', due_at: PASADO, expires_at: PASADO, campaign_status: 'closed' }),
    'responded'
  );
});
