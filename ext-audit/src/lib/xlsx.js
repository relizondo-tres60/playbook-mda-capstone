/**
 * Lector minimo de XLSX para Cloudflare Workers, sin dependencias.
 *
 * Un .xlsx es un ZIP con XML dentro. Se recorre el "central directory" del ZIP,
 * se descomprimen las entradas necesarias con DecompressionStream('deflate-raw')
 * -disponible en el runtime de Workers- y se parsea la primera hoja mas la
 * tabla de cadenas compartidas.
 *
 * Soporta lo que produce AD Manager: una hoja, cabecera en la fila 1, celdas de
 * texto/numero/fecha. No soporta formulas ni ZIP64 (archivos > 4 GB).
 */

const td = new TextDecoder('utf-8');

/** @param {DataView} dv @param {number} off */
const u16 = (dv, off) => dv.getUint16(off, true);
/** @param {DataView} dv @param {number} off */
const u32 = (dv, off) => dv.getUint32(off, true);

/**
 * Devuelve un mapa nombre -> {offset, compressedSize, size, method}.
 * @param {Uint8Array} bytes
 */
function readCentralDirectory(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of Central Directory: firma 0x06054b50, buscada desde el final.
  let eocd = -1;
  const minStart = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minStart; i--) {
    if (u32(dv, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('El archivo no es un XLSX valido (ZIP sin EOCD)');

  const entryCount = u16(dv, eocd + 10);
  let ptr = u32(dv, eocd + 16);
  /** @type {Record<string, {offset:number, compressedSize:number, size:number, method:number}>} */
  const entries = {};

  for (let n = 0; n < entryCount; n++) {
    if (u32(dv, ptr) !== 0x02014b50) break;
    const method = u16(dv, ptr + 10);
    const compressedSize = u32(dv, ptr + 20);
    const size = u32(dv, ptr + 24);
    const nameLen = u16(dv, ptr + 28);
    const extraLen = u16(dv, ptr + 30);
    const commentLen = u16(dv, ptr + 32);
    const localOffset = u32(dv, ptr + 42);
    const name = td.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    entries[name] = { offset: localOffset, compressedSize, size, method };
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * @param {Uint8Array} bytes @param {{offset:number,compressedSize:number,method:number}} entry
 * @returns {Promise<string>}
 */
async function readEntry(bytes, entry) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (u32(dv, entry.offset) !== 0x04034b50) throw new Error('Entrada ZIP corrupta');
  const nameLen = u16(dv, entry.offset + 26);
  const extraLen = u16(dv, entry.offset + 28);
  const start = entry.offset + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return td.decode(raw);
  if (entry.method !== 8) throw new Error(`Metodo de compresion ZIP no soportado: ${entry.method}`);

  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return td.decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** Decodifica entidades XML basicas. */
function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Extrae la tabla de cadenas compartidas (sharedStrings.xml). */
function parseSharedStrings(xml) {
  /** @type {string[]} */
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(m[1]))) text += unescapeXml(t[1]);
    out.push(text);
  }
  return out;
}

/** "BC12" -> 54 (indice de columna base 0) */
export function colIndex(ref) {
  const letters = (ref.match(/^[A-Z]+/) || [''])[0];
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

/**
 * Parsea un .xlsx a matriz de strings.
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<string[][]>}
 */
export async function parseXlsx(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entries = readCentralDirectory(bytes);

  let shared = [];
  if (entries['xl/sharedStrings.xml']) {
    shared = parseSharedStrings(await readEntry(bytes, entries['xl/sharedStrings.xml']));
  }

  const sheetName =
    Object.keys(entries)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort()[0] || null;
  if (!sheetName) throw new Error('El XLSX no contiene hojas de calculo');

  const sheetXml = await readEntry(bytes, entries[sheetName]);
  /** @type {string[][]} */
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(sheetXml))) {
    /** @type {string[]} */
    const row = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || '';
      const inner = cellMatch[2] || '';
      const refAttr = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      const idx = refAttr ? colIndex(refAttr) : row.length;

      let value = '';
      if (type === 'inlineStr') {
        const t = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        value = t ? unescapeXml(t[1]) : '';
      } else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        const rawValue = v ? unescapeXml(v[1]) : '';
        if (type === 's') value = shared[Number(rawValue)] ?? '';
        else if (type === 'b') value = rawValue === '1' ? 'TRUE' : 'FALSE';
        else value = rawValue;
      }
      while (row.length < idx) row.push('');
      row[idx] = value;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** Heuristica: ¿los bytes corresponden a un ZIP/XLSX? */
export function looksLikeXlsx(bytes) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
