import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, detectDelimiter, toRecords, toCsv, csvEscape } from '../src/lib/csv.js';
import { parseLooseDate, isValidDateOnly, addDays, daysBetween, campaignCode, formatCl } from '../src/lib/dates.js';
import { colIndex } from '../src/lib/xlsx.js';

test('detectDelimiter distingue coma, punto y coma y tabulador', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
});

test('parseDelimited respeta comillas, comas internas y saltos de linea', () => {
  const rows = parseDelimited('sam,nombre\next_1,"Perez, Juan"\next_2,"Dice ""hola"""');
  assert.deepEqual(rows[1], ['ext_1', 'Perez, Juan']);
  assert.deepEqual(rows[2], ['ext_2', 'Dice "hola"']);
});

test('parseDelimited soporta CRLF y descarta filas vacias', () => {
  const rows = parseDelimited('a,b\r\n1,2\r\n\r\n3,4\r\n');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2], ['3', '4']);
});

test('parseDelimited elimina el BOM de archivos exportados en Windows', () => {
  const rows = parseDelimited('﻿sam,nombre\next_1,Juan');
  assert.equal(rows[0][0], 'sam');
});

test('toRecords usa la primera fila como cabecera', () => {
  const { headers, records } = toRecords([['sam', 'nombre'], ['ext_1', ' Juan ']]);
  assert.deepEqual(headers, ['sam', 'nombre']);
  assert.deepEqual(records[0], { sam: 'ext_1', nombre: 'Juan' });
});

test('toCsv y csvEscape protegen separadores, comillas y saltos', () => {
  assert.equal(csvEscape('Perez, Juan'), '"Perez, Juan"');
  assert.equal(csvEscape('Dice "hola"'), '"Dice ""hola"""');
  assert.equal(csvEscape(null), '');
  const csv = toCsv(['a', 'b'], [['1', 'x;y']], ';');
  assert.equal(csv, 'a;b\r\n1;"x;y"');
});

test('parseLooseDate acepta los formatos que produce AD Manager', () => {
  assert.equal(parseLooseDate('2026-03-15').slice(0, 10), '2026-03-15');
  assert.equal(parseLooseDate('15/03/2026').slice(0, 10), '2026-03-15');
  assert.equal(parseLooseDate('15-03-2026').slice(0, 10), '2026-03-15');
  assert.equal(parseLooseDate('2026/03/15').slice(0, 10), '2026-03-15');
  assert.equal(parseLooseDate('15/03/2026 14:30').slice(11, 16), '14:30');
});

test('parseLooseDate convierte el serial de Excel', () => {
  // 46096 = 2026-03-15 en el calendario serial de Excel
  assert.equal(parseLooseDate('46096').slice(0, 10), '2026-03-15');
});

test('parseLooseDate devuelve null para valores no informados', () => {
  for (const v of ['', '   ', 'N/A', 'never', 'Nunca', '-', null, undefined]) {
    assert.equal(parseLooseDate(v), null, `deberia ser null para ${JSON.stringify(v)}`);
  }
});

test('isValidDateOnly rechaza fechas inexistentes', () => {
  assert.equal(isValidDateOnly('2026-02-28'), true);
  assert.equal(isValidDateOnly('2026-02-30'), false);
  assert.equal(isValidDateOnly('15/03/2026'), false);
  assert.equal(isValidDateOnly('2026-2-8'), false);
});

test('addDays y daysBetween sostienen el plazo de 14 dias', () => {
  const inicio = '2026-08-01T12:00:00.000Z';
  const limite = addDays(inicio, 14).toISOString();
  assert.equal(limite.slice(0, 10), '2026-08-15');
  assert.equal(daysBetween(inicio, limite), 14);
  assert.equal(daysBetween(limite, inicio), -14);
});

test('campaignCode genera el identificador canonico del periodo', () => {
  assert.equal(campaignCode(2026, 8), 'EXT-2026-08');
  assert.equal(campaignCode(2026, 12), 'EXT-2026-12');
});

test('formatCl presenta la fecha en horario de Chile', () => {
  assert.equal(formatCl('2026-08-15T12:00:00.000Z'), '15-08-2026');
  assert.equal(formatCl(''), '');
  assert.equal(formatCl('no es fecha'), '');
});

test('colIndex traduce referencias de columna de Excel', () => {
  assert.equal(colIndex('A1'), 0);
  assert.equal(colIndex('B2'), 1);
  assert.equal(colIndex('Z10'), 25);
  assert.equal(colIndex('AA1'), 26);
  assert.equal(colIndex('BC12'), 54);
});
