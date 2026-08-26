# Arquitectura

## Resumen

Aplicacion **independiente** (sitio propio, no una extension del playbook MDA) para
automatizar la auditoria mensual de cuentas externas `EXT` de Active Directory.

Todo corre serverless en Cloudflare: un unico Worker sirve el frontend estatico y la
API, D1 guarda el estado relacional y R2 guarda los archivos importados como evidencia.
No hay servidores que mantener ni dependencias de terceros en tiempo de ejecucion.

```
                      GitHub (codigo + CI/CD)
                               |
                        GitHub Actions
                     (pruebas -> migraciones -> deploy)
                               |
   +---------------------------v-----------------------------+
   |                  Cloudflare Worker                       |
   |                                                          |
   |  /            -> assets estaticos (frontend)             |
   |  /api/portal/* -> superficie externa (token de un uso)   |
   |  /api/*        -> superficie interna (sesion + rol)      |
   |  scheduled     -> cron diario 08:00 UTC                  |
   +----+------------------+-------------------+--------------+
        |                  |                   |
        v                  v                   v
   +---------+       +-----------+      +---------------------+
   |  D1     |       |    R2     |      |  API de Gmail       |
   | (SQLite)|       | (archivos |      |  (Google Workspace) |
   |         |       |  y respal-|      |                     |
   |         |       |  dos)     |      |                     |
   +---------+       +-----------+      +----------+----------+
                                                   |
                                                   v
                                    Administradores de contrato
                                    (empresas externas)
```

## Componentes

| Componente | Tecnologia | Rol |
|---|---|---|
| Frontend | HTML/CSS/JS estatico, sin framework ni build | Panel interno y portal externo |
| API | Cloudflare Worker (JS modules, sin dependencias) | Logica de negocio y persistencia |
| Base de datos | Cloudflare D1 (SQLite) | Campanas, cuentas, decisiones, bitacora |
| Archivos | Cloudflare R2 | Planillas originales de AD Manager (evidencia) |
| Correo | API de Gmail (Google Workspace) | Invitaciones, recordatorios, acuses |
| Programacion | Cron Triggers de Cloudflare | Recordatorios y vencimiento a los 14 dias |
| CI/CD | GitHub Actions + Wrangler | Pruebas, migraciones y despliegue |

## Pages vs Workers Static Assets

El requerimiento original planteaba Cloudflare Pages para el frontend y Workers para la
API. La implementacion usa **Workers Static Assets** (`[assets]` en `wrangler.toml`), que
es la evolucion oficial de Pages y hoy la via recomendada por Cloudflare para sitios con
backend. Se decidio asi por tres razones concretas:

1. **Un solo origen.** El portal externo y la API comparten dominio: no hay CORS, y la
   cookie de sesion interna puede ser `SameSite=Strict`, que es el ajuste mas seguro.
2. **Un solo despliegue atomico.** Frontend y API viajan en el mismo `wrangler deploy`;
   no existe la ventana en que el frontend nuevo habla con una API vieja.
3. **Un solo dominio que gestionar** en DNS, WAF y certificados.

Detalle operativo de esa decision: los assets se sirven con el manejo por
defecto de Cloudflare, en el que `/validar` entrega `validar.html` de forma
directa mientras que `/validar.html` responde con un redirect 307 hacia
`/validar`. Por eso **todos los enlaces que emite la aplicacion se generan sin la
extension** (`portalUrl()` en `src/services/requests.js`): el enlace que el
administrador recibe por correo debe resolver en un solo salto.

El frontend igual quedo **100% estatico y desacoplado**: si en el futuro se prefiere
Pages, se publica la carpeta `public/` en un proyecto Pages, se define
`window.APP_CONFIG.apiBase` en `public/config.js` con la URL del Worker y se agrega ese
origen a `ALLOWED_ORIGINS`. El Worker ya trae el manejo de CORS y preflight para ese caso.
No requiere cambios de codigo.

## Segregacion interna / externa

Es el limite de seguridad mas importante del sistema y esta explicito en el router:

| | Panel interno | Portal externo |
|---|---|---|
| Ruta | `/panel`, `/api/*` | `/validar`, `/api/portal/*` |
| Autenticacion | Sesion (cookie HttpOnly + PBKDF2) | Token de un solo proposito en la URL |
| Alcance | Todas las campanas y empresas | Una solicitud: una campana, un administrador |
| Permisos | Por rol: `admin`, `operator`, `auditor` | Solo leer y responder sus propias cuentas |
| Cookie de sesion | Se lee | **Nunca se lee** (`index.js`, `isPortalRoute`) |

Un administrador externo con su enlace no puede alcanzar ningun endpoint interno, y una
sesion interna no cambia lo que ve el portal. Las dos superficies no se cruzan.

## Flujo mensual

```
1. Crear campana del periodo            -> campaigns (status: draft)
2. Importar planilla de AD Manager      -> imports + imported_accounts (status: imported)
      filtra EXT, guarda fila cruda y archivo original en R2
3. Cruce automatico empresa/administrador -> account_assignments
      ~80% auto_assigned, el resto a revision manual
4. Corregir asignaciones en el panel     -> review_status: confirmed
5. Generar solicitudes                   -> validation_requests (status: ready)
      una por administrador de contrato
6. Enviar correos                        -> email_deliveries (status: sent)
      cada correo lleva un enlace unico, firmado y con vencimiento
7. El administrador responde en el portal -> validation_responses
      decide por cuenta: mantener activa | dar de baja
8. Cron diario                            -> recordatorios D-7, D-3, D-1
9. A los 14 dias sin respuesta            -> final_decision = disable (timeout)
10. Exportar cola de bajas                -> CSV + script PowerShell
11. Cerrar campana                        -> congela decisiones
```

## Decisiones de diseno

**Cero dependencias en tiempo de ejecucion.** El Worker no usa ningun paquete npm: ni
router, ni ORM, ni cliente de Google, ni parser de XLSX. Todo se apoya en APIs del
runtime (Web Crypto, `fetch`, `DecompressionStream`). El beneficio operativo es concreto
para un sistema que corre una vez al mes: no hay cadena de suministro que auditar, no hay
`npm audit` que atender, y el despliegue no puede romperse por una version transitiva.
El costo es mas codigo propio, acotado y cubierto por pruebas.

**La fila cruda se conserva siempre.** `imported_accounts.raw_json` guarda el registro
original completo ademas de los campos normalizados. Si manana se descubre que una regla
de normalizacion estaba mal, se puede reprocesar sin volver a pedir la planilla.

**Las decisiones son inmutables hacia atras.** `account_assignments.final_decision` se
escribe con su origen (`administrator`, `timeout`, `internal`, `source_state`) y su fecha.
La bitacora `audit_log` es append-only y registra el antes y el despues de cada cambio.

**El sistema nunca ejecuta bajas en AD.** Produce la cola de bajas y un script PowerShell
de apoyo; la ejecucion la hace el equipo de identidades con revision humana. Un sistema
que envia correos automaticos no deberia ademas tener credenciales para deshabilitar
cuentas en el directorio.

**Las cuentas sin administrador nunca se dan de baja solas.** Quedan en cola de revision
manual (`review_status = 'unassigned'`). El vencimiento automatico solo aplica a cuentas
que efectivamente le fueron notificadas a alguien: castigar por un dato que el sistema no
supo resolver seria un error operativo.

## Estructura del repositorio

```
ext-audit/
  wrangler.toml              configuracion de Cloudflare (dev y produccion)
  package.json               scripts de desarrollo; unica devDependency: wrangler
  migrations/                esquema versionado de D1
  src/
    index.js                 entrada del Worker: fetch + scheduled
    router.js                router minimo con parametros
    lib/                     crypto, http, fechas, csv, xlsx, normalizacion, validacion
    services/                logica de negocio (auth, importacion, cruce, correo, ...)
    routes/                  handlers HTTP por area
  public/                    frontend estatico
  test/                      pruebas con node:test, sin dependencias
  samples/                   planilla de ejemplo (CSV y XLSX)
  scripts/                   verificaciones de sintaxis y esquema, seed de demo
  docs/                      esta documentacion
```
