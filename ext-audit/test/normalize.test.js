import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectExt, companyKey, canonicalCompanyName, companySimilarity, parseManager,
  detectSite, parseBool, deriveSourceState, mapColumns, applyColumnMap, isValidEmail,
} from '../src/lib/normalize.js';

test('detectExt reconoce los patrones habituales de cuentas externas', () => {
  const casos = [
    { sam_account_name: 'ext_jperez' },
    { sam_account_name: 'EXT-1234' },
    { sam_account_name: 'jperez.ext' },
    { sam_account_name: 'EXTJPEREZ' },
    { sam_account_name: 'jperez', upn: 'ext.jperez@capstone.cl' },
    { sam_account_name: 'jperez', ou_path: 'OU=EXTERNOS,OU=Usuarios,DC=capstone,DC=local' },
  ];
  for (const c of casos) {
    const r = detectExt(c);
    assert.equal(r.isExt, true, `deberia detectar ${JSON.stringify(c)}`);
    assert.ok(r.reason, 'debe registrar la regla que produjo el match');
  }
});

test('detectExt en modo token no marca falsos positivos', () => {
  const noExt = [
    { sam_account_name: 'mtexto' },
    { sam_account_name: 'jextra' },
    { sam_account_name: 'sextante' },
    { sam_account_name: 'aponte', display_name: 'Alberto Ponte' },
  ];
  for (const c of noExt) {
    assert.equal(detectExt(c).isExt, false, `no deberia detectar ${JSON.stringify(c)}`);
  }
});

test('detectExt en modo substring es mas laxo, como pide el modo alternativo', () => {
  assert.equal(detectExt({ sam_account_name: 'mtexto' }, 'substring').isExt, true);
  assert.equal(detectExt({ sam_account_name: 'mtexto' }, 'token').isExt, false);
});

test('companyKey unifica variantes de escritura de la misma empresa', () => {
  const variantes = [
    'Servicios Integrales S.p.A.',
    'SERVICIOS INTEGRALES SPA',
    'servicios integrales  spa',
    'Serv. Integrales SpA',
    'SERVICIOS INTEGRALES LTDA',
  ];
  const claves = new Set(variantes.map(companyKey));
  assert.equal(claves.size, 1, `deberian colapsar a una sola clave, se obtuvo: ${[...claves].join(' | ')}`);
});

test('companyKey distingue empresas realmente distintas', () => {
  assert.notEqual(companyKey('Montajes Andinos SpA'), companyKey('Montajes Australes SpA'));
});

test('canonicalCompanyName produce un nombre presentable', () => {
  assert.equal(canonicalCompanyName('SERVICIOS INTEGRALES SPA'), 'Servicios Integrales SPA');
});

test('companySimilarity detecta errores de tipeo y no confunde empresas distintas', () => {
  assert.ok(companySimilarity(companyKey('Montajes Andinos'), companyKey('Montajes Andino')) >= 0.82);
  assert.ok(companySimilarity(companyKey('Montajes Andinos'), companyKey('Transportes Nortinos')) < 0.6);
});

test('parseManager entiende DN de AD, correo y "Apellido, Nombre"', () => {
  assert.deepEqual(
    parseManager('CN=Juan Perez,OU=Usuarios,DC=capstone,DC=local'),
    { name: 'Juan Perez', email: null }
  );
  assert.deepEqual(
    parseManager('Juan Perez <juan.perez@contratista.cl>'),
    { name: 'Juan Perez', email: 'juan.perez@contratista.cl' }
  );
  assert.deepEqual(parseManager('Perez, Juan'), { name: 'Juan Perez', email: null });
  assert.deepEqual(
    parseManager('maria.soto@contratista.cl'),
    { name: 'Maria Soto', email: 'maria.soto@contratista.cl' }
  );
  assert.deepEqual(parseManager(''), { name: null, email: null });
});

test('detectSite reconoce las faenas y sus variantes', () => {
  assert.equal(detectSite('Mantos Blancos'), 'Mantos Blancos');
  assert.equal(detectSite('MANTOSBLANCOS'), 'Mantos Blancos');
  assert.equal(detectSite('Mantos Verdes'), 'Mantoverde');
  assert.equal(detectSite('mantoverde'), 'Mantoverde');
  assert.equal(detectSite('Oficina Stgo'), 'Santiago');
  assert.equal(detectSite('OU=Caserones,DC=capstone'), 'Caserones');
  assert.equal(detectSite('Sin dato relevante'), null);
});

test('detectSite no confunde palabras cortas dentro de otras palabras', () => {
  assert.equal(detectSite('embalaje'), null);
});

test('parseBool interpreta los formatos que llegan desde AD Manager', () => {
  assert.equal(parseBool('TRUE'), true);
  assert.equal(parseBool('Si'), true);
  assert.equal(parseBool('Habilitado'), true);
  assert.equal(parseBool('0'), false);
  assert.equal(parseBool('Deshabilitado'), false);
  assert.equal(parseBool(''), null);
  assert.equal(parseBool('quizas'), null);
});

test('deriveSourceState prioriza eliminada > deshabilitada > bloqueada', () => {
  assert.equal(deriveSourceState({ ad_deleted: 'true', ad_enabled: 'true' }), 'deleted');
  assert.equal(deriveSourceState({ ad_enabled: 'false' }), 'disabled');
  assert.equal(deriveSourceState({ ad_enabled: 'true', ad_locked: 'true' }), 'locked');
  assert.equal(deriveSourceState({ ad_enabled: 'true' }), 'active');
});

test('mapColumns reconoce cabeceras en ingles y espanol', () => {
  const headers = ['SamAccountName', 'Display Name', 'Empresa', 'Manager', 'Enabled', 'Ultimo inicio de sesion'];
  const { map } = mapColumns(headers);
  assert.equal(map['SamAccountName'], 'sam_account_name');
  assert.equal(map['Display Name'], 'display_name');
  assert.equal(map['Empresa'], 'company_raw');
  assert.equal(map['Manager'], 'manager_raw');
  assert.equal(map['Enabled'], 'ad_enabled');
  assert.equal(map['Ultimo inicio de sesion'], 'last_logon_at');
});

test('applyColumnMap proyecta la fila cruda a campos canonicos', () => {
  const { map } = mapColumns(['SamAccountName', 'Empresa']);
  const out = applyColumnMap({ SamAccountName: ' ext_jperez ', Empresa: 'Servicios SpA' }, map);
  assert.equal(out.sam_account_name, 'ext_jperez');
  assert.equal(out.company_raw, 'Servicios SpA');
});

test('isValidEmail acepta correos validos y rechaza los que romperian el envio', () => {
  assert.equal(isValidEmail('relizondo@tres60.cl'), true);
  assert.equal(isValidEmail('sin-arroba.cl'), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(isValidEmail(''), false);
});
