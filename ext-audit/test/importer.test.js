import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeRow } from '../src/services/importer.js';
import { mapColumns } from '../src/lib/normalize.js';
import { parseDelimited, toRecords } from '../src/lib/csv.js';
import { parseXlsx, looksLikeXlsx } from '../src/lib/xlsx.js';

const CSV = await readFile(new URL('../samples/admanager_export_sample.csv', import.meta.url), 'utf8');

function loadSample() {
  const { headers, records } = toRecords(parseDelimited(CSV));
  const { map } = mapColumns(headers);
  return records.map((r, i) => normalizeRow(r, map, i + 2));
}

test('la planilla de ejemplo se parsea completa', () => {
  const rows = loadSample();
  assert.ok(rows.length >= 15, `se esperaban al menos 15 filas, hay ${rows.length}`);
});

test('solo las cuentas EXT quedan marcadas para la campana', () => {
  const rows = loadSample();
  const ext = rows.filter((r) => r.is_ext);
  const noExt = rows.filter((r) => !r.is_ext);
  assert.ok(ext.length > 0, 'debe detectar cuentas EXT');
  assert.ok(noExt.length > 0, 'la muestra incluye cuentas internas que no deben entrar');
  for (const r of ext) assert.ok(r.ext_reason, 'cada deteccion debe registrar su regla');
  for (const r of noExt) {
    assert.ok(!/(^|[^a-z0-9])ext/i.test(String(r.sam_account_name)), `falso positivo: ${r.sam_account_name}`);
  }
});

test('el manager se resuelve desde DN, correo o texto libre', () => {
  const rows = loadSample().filter((r) => r.is_ext);
  const conCorreo = rows.filter((r) => r.manager_email);
  assert.ok(conCorreo.length > 0, 'al menos una cuenta debe resolver el correo del administrador');
  for (const r of conCorreo) {
    assert.match(r.manager_email, /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
    assert.equal(r.manager_email, r.manager_email.toLowerCase());
  }
});

test('el estado en origen se deriva y las cuentas ya inactivas se distinguen', () => {
  const rows = loadSample().filter((r) => r.is_ext);
  const estados = new Set(rows.map((r) => r.source_state));
  assert.ok(estados.has('active'));
  assert.ok(estados.has('disabled') || estados.has('deleted') || estados.has('locked'),
    'la muestra debe incluir cuentas ya inactivas en AD');
  for (const r of rows) {
    assert.ok(['active', 'disabled', 'locked', 'deleted'].includes(r.source_state));
  }
});

test('las fechas heterogeneas del origen se normalizan a ISO', () => {
  const rows = loadSample().filter((r) => r.last_logon_at);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.match(r.last_logon_at, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test('la faena se detecta desde oficina, OU o departamento', () => {
  const rows = loadSample().filter((r) => r.is_ext);
  const faenas = new Set(rows.map((r) => r.site_raw).filter(Boolean));
  assert.ok(faenas.size >= 2, `se esperaban varias faenas, se detectaron: ${[...faenas].join(', ')}`);
});

test('normalizeRow conserva la fila cruda intacta para evidencia', () => {
  const { headers, records } = toRecords(parseDelimited(CSV));
  const { map } = mapColumns(headers);
  const original = { ...records[0] };
  normalizeRow(records[0], map, 2);
  assert.deepEqual(records[0], original, 'no debe mutar el registro de origen');
});

test('el lector XLSX interpreta un libro real con cadenas compartidas', async () => {
  const bytes = new Uint8Array(await readFile(new URL('../samples/admanager_export_sample.xlsx', import.meta.url)));
  assert.equal(looksLikeXlsx(bytes), true);
  const rows = await parseXlsx(bytes);
  assert.ok(rows.length >= 3, 'debe leer cabecera y filas');
  assert.equal(rows[0][0], 'SamAccountName');
  const { headers, records } = toRecords(rows);
  const { map } = mapColumns(headers);
  const parsed = records.map((r, i) => normalizeRow(r, map, i + 2));
  assert.ok(parsed.some((r) => r.is_ext), 'debe detectar cuentas EXT tambien desde XLSX');
});
