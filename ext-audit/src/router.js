/**
 * Router minimo con patrones ":param". Sin dependencias externas.
 */

/** @typedef {(ctx: any, ...params: string[]) => Promise<Response>} Handler */

export class Router {
  constructor() {
    /** @type {{method:string, parts:string[], handler:Handler}[]} */
    this.routes = [];
  }

  /** @param {string} method @param {string} pattern @param {Handler} handler */
  add(method, pattern, handler) {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  /**
   * Busca la ruta que corresponde al metodo y path.
   * @param {string} method @param {string} pathname
   * @returns {{handler:Handler, params:string[]}|null}
   */
  match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    let methodMismatch = false;

    for (const route of this.routes) {
      if (route.parts.length !== parts.length) continue;
      const params = [];
      let ok = true;
      for (let i = 0; i < route.parts.length; i++) {
        const rp = route.parts[i];
        if (rp.startsWith(':')) params.push(decodeURIComponent(parts[i]));
        else if (rp !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      if (route.method !== method) { methodMismatch = true; continue; }
      return { handler: route.handler, params };
    }
    return methodMismatch ? { handler: null, params: [] } : null;
  }
}
