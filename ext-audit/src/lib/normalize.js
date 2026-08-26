/**
 * Normalizacion y cruce de datos de AD Manager.
 *
 * Tres problemas del origen que este modulo resuelve:
 *  1. Las cabeceras varian entre exportaciones (ingles/espanol, con o sin espacios).
 *  2. Los nombres de empresa vienen inconsistentes ("SERV. INTEGRALES SPA",
 *     "Servicios Integrales S.p.A.", "servicios integrales spa").
 *  3. El campo `manager` a veces trae un DN de AD, a veces un nombre, a veces
 *     un correo, y en ~20% de los casos esta vacio o es incorrecto.
 */

// ---------------------------------------------------------------------------
// Mapeo de cabeceras del origen -> campos canonicos
// ---------------------------------------------------------------------------

/** @type {Record<string, string[]>} */
export const COLUMN_ALIASES = {
  sam_account_name: ['samaccountname', 'sam account name', 'logon name', 'nombre de inicio de sesion', 'username', 'user name', 'usuario', 'login', 'account name', 'cuenta'],
  display_name: ['displayname', 'display name', 'nombre para mostrar', 'nombre completo', 'full name', 'name', 'nombre'],
  upn: ['userprincipalname', 'user principal name', 'upn', 'logon name (upn)', 'nombre principal de usuario'],
  email: ['email', 'e-mail', 'mail', 'emailaddress', 'email address', 'correo', 'correo electronico', 'direccion de correo'],
  department: ['department', 'departamento', 'area', 'dept'],
  job_title: ['title', 'job title', 'cargo', 'puesto', 'titulo'],
  company_raw: ['company', 'empresa', 'organization', 'organizacion', 'compania', 'contratista', 'razon social'],
  manager_raw: ['manager', 'jefe', 'supervisor', 'reports to', 'administrador', 'administrador de contrato', 'jefatura', 'responsable'],
  manager_email: ['manager email', 'manageremail', 'correo jefe', 'email jefe', 'manager mail', 'correo administrador', 'email administrador'],
  ou_path: ['ou', 'organizational unit', 'unidad organizativa', 'distinguishedname', 'distinguished name', 'dn', 'canonicalname', 'canonical name', 'container'],
  site_raw: ['office', 'oficina', 'physicaldeliveryofficename', 'location', 'ubicacion', 'faena', 'sede', 'site', 'city', 'ciudad'],
  ad_enabled: ['enabled', 'habilitado', 'account enabled', 'estado', 'status', 'account status', 'activo'],
  ad_locked: ['locked', 'lockedout', 'locked out', 'bloqueado', 'account locked'],
  ad_deleted: ['deleted', 'eliminado', 'is deleted', 'borrado'],
  password_expired: ['password expired', 'passwordexpired', 'clave expirada'],
  last_logon_at: ['lastlogon', 'last logon', 'last logon time', 'ultimo inicio de sesion', 'ultimo logon', 'lastlogontimestamp'],
  created_at_source: ['whencreated', 'when created', 'created', 'creation date', 'fecha de creacion', 'created on'],
  expires_at_source: ['accountexpires', 'account expires', 'expiration date', 'fecha de expiracion', 'expira', 'expiry date'],
  contract_number: ['contract', 'contrato', 'contract number', 'numero de contrato', 'n contrato', 'nro contrato'],
};

/**
 * Normaliza una cabecera para compararla: minusculas, sin acentos ni signos.
 * @param {string} s
 */
export function normalizeHeader(s) {
  return stripAccents(String(s || ''))
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {string} s */
export function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Construye el mapa cabecera-origen -> campo canonico.
 * @param {string[]} headers
 * @returns {{map: Record<string,string>, unmapped: string[]}}
 */
export function mapColumns(headers) {
  /** @type {Record<string,string>} */
  const map = {};
  /** @type {string[]} */
  const unmapped = [];
  const taken = new Set();

  for (const header of headers) {
    const norm = normalizeHeader(header);
    let matched = null;
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (taken.has(field)) continue;
      if (aliases.some((a) => normalizeHeader(a) === norm)) {
        matched = field;
        break;
      }
    }
    if (matched) {
      map[header] = matched;
      taken.add(matched);
    } else {
      unmapped.push(header);
    }
  }
  return { map, unmapped };
}

/**
 * Aplica el mapa a una fila cruda.
 * @param {Record<string,string>} record @param {Record<string,string>} map
 */
export function applyColumnMap(record, map) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const [header, field] of Object.entries(map)) {
    const v = record[header];
    if (v !== undefined && v !== '') out[field] = String(v).trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deteccion de cuentas EXT
// ---------------------------------------------------------------------------

/** Token EXT delimitado: ext_juan, juan.ext, EXT-1234, ext123, CN=OU=EXT */
const EXT_TOKEN = /(^|[^A-Z0-9])EXT([^A-Z0-9]|$)/;
const EXT_PREFIX = /^EXT[._\-]?[A-Z0-9]/;
const EXT_SUFFIX = /[A-Z0-9][._\-]?EXT$/;
const EXT_OU = /(OU|CN)=\s*(EXT[^,]*|EXTERNOS?|EXTERNAL[^,]*)/;

/**
 * Determina si una cuenta es externa y por que regla.
 * `mode` = 'token' (por defecto, evita falsos positivos como "TEXTO"/"EXTRA")
 * o 'substring' (cualquier aparicion de EXT).
 *
 * @param {{sam_account_name?:string, display_name?:string, upn?:string, email?:string, ou_path?:string, department?:string}} acc
 * @param {'token'|'substring'} mode
 * @returns {{isExt: boolean, reason: string|null}}
 */
export function detectExt(acc, mode = 'token') {
  const sam = String(acc.sam_account_name || '').toUpperCase();
  const upnLocal = String(acc.upn || '').split('@')[0].toUpperCase();
  const mailLocal = String(acc.email || '').split('@')[0].toUpperCase();
  const display = String(acc.display_name || '').toUpperCase();
  const ou = String(acc.ou_path || '').toUpperCase();

  if (mode === 'substring') {
    const fields = [
      ['sam_account_name', sam], ['upn', upnLocal], ['email', mailLocal],
      ['display_name', display], ['ou_path', ou],
    ];
    for (const [name, value] of fields) {
      if (value.includes('EXT')) return { isExt: true, reason: `substring:${name}` };
    }
    return { isExt: false, reason: null };
  }

  if (EXT_PREFIX.test(sam)) return { isExt: true, reason: 'prefijo_sam:EXT*' };
  if (EXT_SUFFIX.test(sam)) return { isExt: true, reason: 'sufijo_sam:*EXT' };
  if (EXT_TOKEN.test(sam)) return { isExt: true, reason: 'token_sam:EXT' };
  if (EXT_PREFIX.test(upnLocal) || EXT_SUFFIX.test(upnLocal) || EXT_TOKEN.test(upnLocal)) {
    return { isExt: true, reason: 'token_upn:EXT' };
  }
  if (EXT_PREFIX.test(mailLocal) || EXT_SUFFIX.test(mailLocal) || EXT_TOKEN.test(mailLocal)) {
    return { isExt: true, reason: 'token_email:EXT' };
  }
  if (EXT_OU.test(ou)) return { isExt: true, reason: 'ou_externos' };
  if (EXT_TOKEN.test(display)) return { isExt: true, reason: 'token_display:EXT' };
  return { isExt: false, reason: null };
}

// ---------------------------------------------------------------------------
// Normalizacion de empresas
// ---------------------------------------------------------------------------

/** Sufijos societarios que no aportan a la identidad de la empresa. */
const LEGAL_SUFFIXES = [
  'spa', 's p a', 'sa', 's a', 'sac', 'ltda', 'limitada', 'ltd', 'eirl', 'e i r l',
  'inc', 'llc', 'srl', 's r l', 'cia', 'y cia', 'chile', 'de chile', 'sociedad anonima',
];

const NOISE_WORDS = ['servicios', 'servicio', 'serv', 'ingenieria', 'ing', 'comercial', 'contratista', 'empresa'];

/**
 * Clave canonica de empresa: sin acentos, sin puntuacion, sin sufijo societario.
 * "Servicios Integrales S.p.A." y "SERV INTEGRALES SPA" comparten clave.
 * @param {string} name
 */
export function companyKey(name) {
  let s = stripAccents(String(name || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';

  // Quita sufijos societarios repetidamente ("x ltda spa" -> "x")
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of LEGAL_SUFFIXES) {
      if (s === suf) return s;
      if (s.endsWith(' ' + suf)) {
        s = s.slice(0, -(suf.length + 1)).trim();
        changed = true;
      }
    }
  }
  // Expande abreviaturas frecuentes antes de comparar.
  s = s.replace(/\bserv\b/g, 'servicios').replace(/\bing\b/g, 'ingenieria').replace(/\btec\b/g, 'tecnica');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Nombre canonico presentable: Title Case conservando siglas.
 * @param {string} name
 */
export function canonicalCompanyName(name) {
  const cleaned = String(name || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((w) => {
      if (w.length <= 3 && w === w.toUpperCase()) return w; // SPA, SA, LTD
      if (/^[A-ZÁÉÍÓÚÑ]{4,}$/.test(w)) return w.charAt(0) + w.slice(1).toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/**
 * Distancia de Levenshtein con corte temprano.
 * Devuelve Infinity cuando la distancia real supera `maxDist`: asi quien llama
 * distingue "muy distintas" de "distancia exactamente maxDist + 1".
 * @param {string} a @param {string} b @param {number} maxDist
 */
export function levenshtein(a, b, maxDist = 4) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxDist) return Infinity;
    prev = cur;
  }
  const dist = prev[b.length];
  return dist > maxDist ? Infinity : dist;
}

/**
 * Similitud 0..1 entre dos nombres de empresa ya normalizados.
 *
 * Combina dos senales:
 *  - Levenshtein acotado, que captura errores de tipeo ("Andinos" / "Andino").
 *  - Jaccard sobre palabras significativas, que captura reordenamientos y
 *    abreviaturas ("Montajes Andinos" / "Andinos Montajes").
 * Si ambos nombres tienen palabras significativas y no comparten ninguna, se
 * trata de empresas distintas aunque el string se parezca por casualidad.
 *
 * @param {string} a @param {string} b
 */
export function companySimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const significant = (s) => new Set(s.split(' ').filter((w) => w.length > 2 && !NOISE_WORDS.includes(w)));
  const wa = significant(a);
  const wb = significant(b);
  let jaccard = 0;
  if (wa.size && wb.size) {
    const inter = [...wa].filter((w) => wb.has(w)).length;
    jaccard = inter / (wa.size + wb.size - inter);
    if (inter === 0) return 0;
  }

  const maxLen = Math.max(a.length, b.length);
  const cap = Math.max(2, Math.ceil(maxLen * 0.3));
  const dist = levenshtein(a, b, cap);
  const lev = dist === Infinity ? 0 : 1 - dist / maxLen;

  return Math.max(lev, jaccard * 0.95);
}

// ---------------------------------------------------------------------------
// Manager / administrador de contrato
// ---------------------------------------------------------------------------

/**
 * Extrae nombre y correo desde el campo `manager`, que puede venir como:
 *  - DN de AD:  "CN=Juan Perez,OU=Usuarios,DC=capstone,DC=local"
 *  - "Juan Perez <juan.perez@empresa.cl>"
 *  - "juan.perez@empresa.cl"
 *  - "Perez, Juan"
 * @param {string} raw
 * @returns {{name: string|null, email: string|null}}
 */
export function parseManager(raw) {
  const s = String(raw || '').trim();
  if (!s) return { name: null, email: null };

  const emailMatch = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  const email = emailMatch ? emailMatch[0].toLowerCase() : null;

  let name = null;
  const cn = s.match(/CN=([^,]+)/i);
  if (cn) {
    name = cn[1].replace(/\\,/g, ',').trim();
  } else {
    let cleaned = s.replace(/<[^>]*>/g, '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '').trim();
    cleaned = cleaned.replace(/[",;]+$/g, '').trim();
    if (cleaned.includes(',') && !/=/.test(cleaned)) {
      const [last, first] = cleaned.split(',').map((p) => p.trim());
      if (first) cleaned = `${first} ${last}`;
    }
    name = cleaned || null;
  }

  // Si solo hay correo, se deriva un nombre presentable de la parte local.
  if (!name && email) {
    name = email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return { name: name || null, email };
}

/** @param {string} email */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Validacion de correo suficientemente estricta para envio. */
export function isValidEmail(email) {
  const s = normalizeEmail(email);
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s) && s.length <= 254;
}

// ---------------------------------------------------------------------------
// Faenas / sedes
// ---------------------------------------------------------------------------

/** Catalogo de faenas conocidas y sus variantes de escritura. */
export const KNOWN_SITES = [
  { canonical: 'Mantos Blancos', patterns: ['mantos blancos', 'mantosblancos', 'mb', 'mantos b'] },
  { canonical: 'Mantoverde', patterns: ['mantoverde', 'mantos verde', 'mantos verdes', 'mv', 'manto verde'] },
  { canonical: 'Santiago', patterns: ['santiago', 'stgo', 'casa matriz', 'corporativo', 'oficina central'] },
  { canonical: 'Caserones', patterns: ['caserones', 'cas'] },
  { canonical: 'Pinto Valley', patterns: ['pinto valley', 'pintovalley', 'pv'] },
  { canonical: 'Antofagasta', patterns: ['antofagasta', 'anf'] },
  { canonical: 'Copiapo', patterns: ['copiapo', 'chanaral'] },
];

/**
 * Detecta la faena a partir de office/OU/departamento.
 * @param {...(string|undefined|null)} candidates
 * @returns {string|null}
 */
export function detectSite(...candidates) {
  const haystack = stripAccents(candidates.filter(Boolean).join(' ').toLowerCase());
  if (!haystack) return null;
  for (const site of KNOWN_SITES) {
    for (const p of site.patterns) {
      // Palabras cortas ("mb", "mv") solo con limites de palabra.
      const re = new RegExp(`(^|[^a-z0-9])${p.replace(/\s+/g, '\\s*')}([^a-z0-9]|$)`);
      if (re.test(haystack)) return site.canonical;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Estado de la cuenta en el origen
// ---------------------------------------------------------------------------

/** Interpreta booleanos escritos de multiples formas. */
export function parseBool(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = stripAccents(String(value).trim().toLowerCase());
  if (['true', '1', 'si', 'yes', 'y', 'enabled', 'habilitado', 'activo', 'active', 'verdadero'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'disabled', 'deshabilitado', 'inactivo', 'inactive', 'falso', 'bloqueado', 'locked'].includes(s)) return false;
  return null;
}

/**
 * Deriva el estado de la cuenta en AD. Una cuenta ya eliminada o bloqueada en
 * el origen no debe volver a accionarse.
 * @param {{ad_enabled?:any, ad_locked?:any, ad_deleted?:any}} acc
 * @returns {'active'|'disabled'|'locked'|'deleted'}
 */
export function deriveSourceState(acc) {
  if (parseBool(acc.ad_deleted) === true) return 'deleted';
  const enabled = parseBool(acc.ad_enabled);
  if (enabled === false) return 'disabled';
  if (parseBool(acc.ad_locked) === true) return 'locked';
  return 'active';
}
