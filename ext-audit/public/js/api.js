/**
 * Cliente de la API. Unico punto donde el frontend habla con el Worker.
 *
 * Si el frontend se despliega en Cloudflare Pages separado del Worker, basta
 * definir window.APP_CONFIG.apiBase en config.js; por defecto usa el mismo
 * origen (Workers Static Assets).
 */
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '';

/**
 * @param {string} path @param {RequestInit & {query?: Record<string, any>}} [options]
 */
export async function api(path, options = {}) {
  const { query, ...init } = options;
  let url = `${API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, val] of Object.entries(query)) {
      if (val !== undefined && val !== null && val !== '') params.set(k, String(val));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = { ...(init.headers || {}) };
  if (init.body && !(init.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { credentials: 'include', ...init, headers });
  const contentType = res.headers.get('Content-Type') || '';

  if (!contentType.includes('application/json')) {
    if (!res.ok) throw new ApiError(`Error ${res.status}`, res.status, null);
    return res;
  }

  const data = await res.json();
  if (!res.ok) throw new ApiError(data.message || `Error ${res.status}`, res.status, data);
  return data;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const get = (path, query) => api(path, { method: 'GET', query });
export const post = (path, body) => api(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
export const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = (path) => api(path, { method: 'DELETE' });

/** Subida de archivo (multipart). */
export function upload(path, file) {
  const form = new FormData();
  form.append('file', file);
  return api(path, { method: 'POST', body: form });
}

/** Descarga un endpoint que devuelve CSV o texto plano. */
export async function download(path, filename) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const data = await res.json();
      message = data.message || message;
    } catch { /* respuesta no JSON */ }
    throw new ApiError(message, res.status, null);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// --- Utilidades de presentacion --------------------------------------------

/** Escapa texto antes de insertarlo en el DOM via innerHTML. */
export function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TZ = 'America/Santiago';

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-CL', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

export function daysUntil(iso) {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
}

/** Mensaje flotante de retroalimentacion. */
export function toast(message, kind = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4000);
}

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export const LABELS = {
  reviewStatus: {
    pending: 'Pendiente', auto_assigned: 'Auto asignada', manual_review: 'Revision manual',
    confirmed: 'Confirmada', unassigned: 'Sin administrador', excluded: 'Excluida',
  },
  requestStatus: {
    pending: 'Por enviar', sent: 'Enviada', opened: 'Abierta', responded: 'Respondida',
    expired: 'Vencida', cancelled: 'Cancelada', failed: 'Error de envio',
  },
  sourceState: { active: 'Activa', disabled: 'Deshabilitada', locked: 'Bloqueada', deleted: 'Eliminada' },
  decision: { keep: 'Mantener activa', disable: 'Dar de baja' },
  decisionSource: {
    administrator: 'Administrador', timeout: 'Vencimiento', internal: 'Interna', source_state: 'Estado en origen',
  },
  campaignStatus: {
    draft: 'Borrador', imported: 'Importada', ready: 'Lista para enviar',
    sent: 'Enviada', closed: 'Cerrada', cancelled: 'Cancelada',
  },
};

/** Clase CSS de la etiqueta segun el estado. */
export function tagClass(kind, value) {
  const map = {
    reviewStatus: { auto_assigned: 'ok', confirmed: 'ok', manual_review: 'warn', unassigned: 'danger', excluded: 'muted', pending: 'muted' },
    requestStatus: { responded: 'ok', sent: 'info', opened: 'info', expired: 'danger', failed: 'danger', pending: 'muted', cancelled: 'muted' },
    sourceState: { active: 'ok', disabled: 'muted', locked: 'warn', deleted: 'muted' },
    decision: { keep: 'ok', disable: 'danger' },
    campaignStatus: { sent: 'info', closed: 'muted', ready: 'ok', imported: 'warn', draft: 'muted' },
  };
  return (map[kind] && map[kind][value]) || 'muted';
}

/** <span class="tag ..."> listo para innerHTML. */
export function tag(kind, value) {
  if (!value) return '<span class="tag muted">-</span>';
  return `<span class="tag ${tagClass(kind, value)}">${esc(LABELS[kind]?.[value] || value)}</span>`;
}
