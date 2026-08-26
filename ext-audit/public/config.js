/**
 * Configuracion del frontend en tiempo de ejecucion.
 *
 * Por defecto la API vive en el mismo origen que el sitio (un unico Worker que
 * sirve los assets y /api). Si se despliega el frontend en Cloudflare Pages
 * apuntando a un Worker en otro dominio, se fija aqui la URL base y se agrega
 * ese origen a ALLOWED_ORIGINS en wrangler.toml.
 */
window.APP_CONFIG = {
  apiBase: '',
  appName: 'Auditoria de Cuentas Externas EXT',
  organization: 'Tres60',
};
