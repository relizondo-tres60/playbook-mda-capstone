import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../src/lib/validate.js';
import { HttpError } from '../src/lib/http.js';
import { b64url, fromB64, randomToken, sha256Hex, pbkdf2, hashPassword, timingSafeEqual } from '../src/lib/crypto.js';
import { validatePasswordStrength } from '../src/services/auth.js';
import { Router } from '../src/router.js';

const throwsBadRequest = (fn) => assert.throws(fn, (e) => e instanceof HttpError && e.status === 400);

test('str rechaza caracteres de control (inyeccion CRLF en cabeceras de correo)', () => {
  throwsBadRequest(() => v.str('Juan\r\nBcc: atacante@x.cl', 'nombre'));
  throwsBadRequest(() => v.str('nulo' + String.fromCharCode(0) + 'adentro', 'nombre'));
  throwsBadRequest(() => v.str('campana' + String.fromCharCode(7), 'nombre'));
  assert.equal(v.str('  Juan Perez  ', 'nombre'), 'Juan Perez');
});

test('str permite saltos de linea solo en campos multilinea', () => {
  throwsBadRequest(() => v.str('linea1\nlinea2', 'comentario'));
  assert.equal(v.str('linea1\nlinea2', 'comentario', { multiline: true }), 'linea1\nlinea2');
});

test('str aplica los limites de largo y obligatoriedad', () => {
  throwsBadRequest(() => v.str('x'.repeat(300), 'campo'));
  throwsBadRequest(() => v.str('', 'campo', { required: true }));
  assert.equal(v.str(undefined, 'campo'), null);
});

test('email valida el formato antes de intentar enviar', () => {
  assert.equal(v.email('Relizondo@Tres60.CL', 'email'), 'relizondo@tres60.cl');
  throwsBadRequest(() => v.email('sin-arroba', 'email'));
  throwsBadRequest(() => v.email('a@b', 'email'));
});

test('oneOf restringe la decision a los dos estados de negocio permitidos', () => {
  assert.equal(v.oneOf('keep', 'decision', ['keep', 'disable']), 'keep');
  throwsBadRequest(() => v.oneOf('borrar', 'decision', ['keep', 'disable']));
});

test('dateOnly exige AAAA-MM-DD y rechaza fechas inexistentes', () => {
  assert.equal(v.dateOnly('2026-08-15', 'fecha'), '2026-08-15');
  throwsBadRequest(() => v.dateOnly('15/08/2026', 'fecha'));
  throwsBadRequest(() => v.dateOnly('2026-02-31', 'fecha'));
});

test('id rechaza identificadores con caracteres de inyeccion', () => {
  assert.equal(v.id('a1b2c3d4-e5f6', 'id'), 'a1b2c3d4-e5f6');
  throwsBadRequest(() => v.id("' OR 1=1 --", 'id'));
  throwsBadRequest(() => v.id('../../etc/passwd', 'id'));
  throwsBadRequest(() => v.id('abc', 'id'));
});

test('array acota el tamano del lote de decisiones', () => {
  throwsBadRequest(() => v.array(new Array(10), 'decisions', 5));
  throwsBadRequest(() => v.array('no es lista', 'decisions'));
  assert.equal(v.array([1, 2], 'decisions').length, 2);
});

test('pagination acota limit y offset a rangos seguros', () => {
  assert.deepEqual(v.pagination(new URL('https://x/?limit=99999&offset=-5')), { limit: 500, offset: 0 });
  assert.deepEqual(v.pagination(new URL('https://x/')), { limit: 100, offset: 0 });
  assert.deepEqual(v.pagination(new URL('https://x/?limit=50&offset=10')), { limit: 50, offset: 10 });
});

test('b64url y fromB64 son inversas y evitan caracteres reservados en URL', () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  const encoded = b64url(bytes);
  assert.ok(!/[+/=]/.test(encoded), 'base64url no debe contener +, / ni =');
  assert.deepEqual([...fromB64(encoded)], [...bytes]);
});

test('randomToken produce 256 bits de entropia y no se repite', () => {
  const t = randomToken(32);
  assert.equal(fromB64(t).length, 32);
  const muestras = new Set(Array.from({ length: 500 }, () => randomToken(32)));
  assert.equal(muestras.size, 500);
});

test('el token del portal se guarda unicamente como hash', async () => {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  assert.equal(await sha256Hex(token), hash, 'el hash debe ser estable');
});

test('pbkdf2 deriva de forma estable y depende de la sal', async () => {
  const a = await pbkdf2('Clave.Segura.2026', 'c2FsdC1maWpvLTE2', 1000);
  const b = await pbkdf2('Clave.Segura.2026', 'c2FsdC1maWpvLTE2', 1000);
  const c = await pbkdf2('Clave.Segura.2026', 'b3RyYS1zYWwtMTIzNA', 1000);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('hashPassword genera sal distinta en cada llamada', async () => {
  const a = await hashPassword('Clave.Segura.2026', 1000);
  const b = await hashPassword('Clave.Segura.2026', 1000);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('timingSafeEqual compara sin cortocircuitar por contenido', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('abc', null), false);
});

test('validatePasswordStrength aplica la politica minima del panel interno', () => {
  assert.ok(validatePasswordStrength('corta'));
  assert.ok(validatePasswordStrength('solominusculasyya'));
  assert.equal(validatePasswordStrength('Clave.Segura.2026'), null);
});

test('el router distingue rutas literales de parametrizadas y valida el metodo', () => {
  const r = new Router();
  const dup = () => {};
  const byId = () => {};
  const create = () => {};
  r.get('/api/companies/duplicates', dup);
  r.get('/api/companies/:id', byId);
  r.post('/api/companies', create);

  assert.equal(r.match('GET', '/api/companies/duplicates').handler, dup);
  const m = r.match('GET', '/api/companies/abc123');
  assert.equal(m.handler, byId);
  assert.deepEqual(m.params, ['abc123']);
  assert.equal(r.match('GET', '/api/nope'), null);

  // Ruta existente con metodo incorrecto: debe resolverse como 405, no 404
  const wrongMethod = r.match('DELETE', '/api/companies');
  assert.notEqual(wrongMethod, null);
  assert.equal(wrongMethod.handler, null);
});
