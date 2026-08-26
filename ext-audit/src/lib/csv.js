/**
 * Parser CSV/TSV tolerante (RFC 4180 + separador autodetectado + BOM).
 * AD Manager exporta con coma o punto y coma segun el locale del servidor.
 */

/** @param {string} text @returns {string} */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Detecta el delimitador contando ocurrencias fuera de comillas en la 1a linea.
 * @param {string} text
 */
export function detectDelimiter(text) {
  const firstLine = stripBom(text).split(/\r?\n/)[0] || '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Parsea texto delimitado a matriz de strings.
 * @param {string} text @param {string} [delimiter]
 * @returns {string[][]}
 */
export function parseDelimited(text, delimiter) {
  const src = stripBom(text);
  const d = delimiter || detectDelimiter(src);
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // se ignora; el \n siguiente cierra la fila
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Convierte la matriz en objetos usando la primera fila como cabecera.
 * @param {string[][]} rows
 * @returns {{headers: string[], records: Record<string,string>[]}}
 */
export function toRecords(rows) {
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    /** @type {Record<string,string>} */
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });
  return { headers, records };
}

/** Escapa un valor para salida CSV. */
export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serializa filas a CSV.
 * @param {string[]} headers @param {any[][]} rows @param {string} [delimiter]
 */
export function toCsv(headers, rows, delimiter = ',') {
  const lines = [headers.map(csvEscape).join(delimiter)];
  for (const r of rows) lines.push(r.map(csvEscape).join(delimiter));
  return lines.join('\r\n');
}
