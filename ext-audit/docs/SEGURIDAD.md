# Seguridad

## Modelo de amenazas

| Amenaza | Control |
|---|---|
| Un tercero adivina o intercepta un enlace de validacion | 256 bits de entropia, expiracion, un solo proposito, rotacion en cada reenvio |
| Un administrador externo alcanza datos de otra empresa | El token resuelve una unica solicitud; el servidor verifica pertenencia por cuenta |
| Un administrador externo alcanza el panel interno | Rutas y autenticacion separadas; `/api/portal/*` nunca lee la cookie de sesion |
| Inyeccion SQL | Sentencias preparadas con parametros ligados, sin excepcion |
| Inyeccion de cabeceras de correo (CRLF) | Rechazo de caracteres de control en toda entrada; asuntos saneados |
| XSS en el panel o en los correos | Escape de todo dato del origen antes de HTML |
| CSRF sobre el panel | Cookie `SameSite=Strict` + verificacion de `Origin` en mutaciones |
| Fuerza bruta de contrasenas | PBKDF2 210k iteraciones + bloqueo tras 5 intentos |
| Enumeracion de usuarios por tiempo de respuesta | Se deriva el hash aunque el usuario no exista |
| Robo de la base de datos | Contrasenas y tokens solo como hash; IPs hasheadas con sal secreta |
| Alteracion de la evidencia | Bitacora append-only, SHA-256 del archivo importado, original inmutable en R2 |

## Enlaces del portal externo

```
token = 32 bytes de crypto.getRandomValues()  ->  base64url  (256 bits)
en D1 se guarda:  SHA-256(token)  +  los 8 primeros caracteres (solo para soporte)
```

- **El token en claro nunca se persiste.** Existe en memoria durante el envio y despues
  solo en el correo del administrador. Ni siquiera un operador del panel puede recuperarlo:
  la unica accion posible es reenviar, que genera uno nuevo.
- **Un solo proposito.** Autoriza exactamente una solicitud (una campana, un administrador).
  No sirve para nada mas.
- **Expira.** En `due_at + TOKEN_GRACE_DAYS`. Pasado el plazo el portal pasa a modo lectura.
- **Se rota.** Cada reenvio y cada recordatorio genera un token nuevo e invalida el anterior.
  Un enlace filtrado de un correo viejo deja de servir.
- **Deja rastro.** Aperturas, intentos con token invalido (por prefijo) y el envio de la
  respuesta quedan en `audit_log` con IP hasheada y user agent.

Ademas, al enviar la respuesta el servidor verifica que **cada** `assignmentId` pertenezca a
esa solicitud (error 403 si no) y que **ninguna** cuenta quede sin decidir (error 400).
Reenviar una respuesta ya entregada es error 409.

## Panel interno

**Contrasenas.** PBKDF2-HMAC-SHA256, 210.000 iteraciones (recomendacion OWASP 2023), sal de
16 bytes por usuario, iteraciones almacenadas por usuario para poder subirlas sin invalidar
las claves existentes. Politica minima: 12 caracteres y 3 de 4 clases de caracteres.

**Sesiones.** Token aleatorio de 32 bytes; en D1 vive solo su SHA-256. Cookie `HttpOnly`,
`Secure`, `SameSite=Strict`, vigencia 1 dia, revocable. Comparaciones en tiempo constante.

**Bloqueo.** Cinco fallos consecutivos bloquean la cuenta 15 minutos. Tanto los exitos como
los fallos quedan en la bitacora.

**Roles.**

| Rol | Alcance |
|---|---|
| `auditor` | solo lectura: campanas, cuentas, bitacora, exportaciones |
| `operator` | ademas: importar, corregir asignaciones, generar y enviar campanas |
| `admin` | ademas: usuarios, configuracion, ejecucion manual de los jobs |

### Migracion a SSO (recomendada para produccion)

Lo natural en Tres60 es delegar la autenticacion en **Cloudflare Access** con Google
Workspace como proveedor, y eliminar las contrasenas locales:

1. Cloudflare Zero Trust → **Access → Applications → Add a self-hosted application**.
2. Dominio: `ext-audit.tres60.cl`, ruta `/panel` y `/api/*`.
3. **Importante:** excluir `/validar`, `/api/portal/*`, `/css/*`, `/js/*` y
   `/config.js`, que deben seguir siendo publicos para los administradores externos.
4. Politica: grupo de Google Workspace del equipo de identidades.
5. En el Worker, reemplazar `resolveSession` por la validacion del JWT `Cf-Access-Jwt-Assertion`
   contra el JWKS del equipo, y mapear el correo del token al rol de `internal_users`.

El cambio queda acotado a `src/services/auth.js`: el resto de la aplicacion consume
`ctx.user` sin saber de donde salio.

## Validacion de entrada

Todo dato externo pasa por `src/lib/validate.js` antes de tocar D1:

- Tipo, largo maximo y obligatoriedad por campo.
- **Rechazo de caracteres de control** (C0 y DEL). Es la defensa contra inyeccion CRLF en
  cabeceras de correo: un nombre de empresa venido de AD Manager termina en un asunto.
- Correos validados contra un patron estricto antes de intentar enviar.
- Fechas exigidas en `AAAA-MM-DD` y verificadas contra el calendario (`2026-02-31` se rechaza).
- Identificadores restringidos a `[A-Za-z0-9_-]{6,64}`: bloquea comillas y `../`.
- Enumeraciones cerradas: `decision` solo acepta `keep` o `disable`.
- Paginacion acotada (`limit` maximo 500) y lotes acotados (maximo 2.000 decisiones).
- Cargas limitadas a 15 MB y 20.000 filas.

## Base de datos

Todas las consultas usan `db.prepare(sql).bind(...)`. **En ningun punto se concatena input
de usuario dentro de una sentencia SQL.** Los filtros dinamicos del panel construyen la
clausula `WHERE` a partir de fragmentos definidos en el servidor, con los valores siempre
como parametros ligados.

## Cabeceras HTTP

Toda respuesta de la API incluye:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()
Cross-Origin-Opener-Policy: same-origin
Cache-Control: no-store
```

`X-Frame-Options: DENY` impide montar el portal en un iframe para inducir clics. El portal
externo declara ademas `<meta name="referrer" content="no-referrer">` para que el token no
viaje en el `Referer` hacia terceros.

## CORS

Por defecto **no se emite ninguna cabecera CORS**: frontend y API comparten origen. Si el
frontend se despliega aparte en Pages, se listan los origenes en `ALLOWED_ORIGINS` y solo
esos reciben `Access-Control-Allow-Origin`. No existe el comodin `*`.

## Datos personales

El sistema procesa nombres, correos y cargos de trabajadores de empresas contratistas.

- **Las IPs se guardan hasheadas** con el secreto de la aplicacion (`hashWithSecret`):
  permiten correlacionar accesos para la auditoria sin almacenar el dato en claro.
- Los mensajes de error nunca devuelven stack traces ni SQL al cliente; el detalle va a los
  logs del Worker con un `requestId` para correlacionar.
- La planilla original en R2 contiene datos personales: el bucket debe permanecer privado
  y con una regla de retencion acorde a la politica de la auditoria.
- La bitacora es la evidencia del proceso; su retencion debe alinearse con la exigencia del
  cliente (habitualmente el periodo auditado mas un ano).

## Manejo de secretos

Ningun secreto vive en el repositorio. `.dev.vars` esta en `.gitignore` y solo se versiona
`.dev.vars.example` con valores de relleno. En produccion se cargan con
`wrangler secret put`, y en CI viajan como secretos de GitHub Actions.

`SETUP_TOKEN` debe eliminarse una vez creado el primer usuario:
`npx wrangler secret delete SETUP_TOKEN --env production`.

## Lo que el sistema deliberadamente no hace

**No se conecta a Active Directory ni ejecuta bajas.** No tiene credenciales de dominio.
Produce la cola de bajas y un script PowerShell de apoyo (que trae `-WhatIf`), y la
ejecucion queda en manos del equipo de identidades con revision humana. Un sistema que
envia correos automaticos a terceros no deberia ademas poder deshabilitar cuentas.

**No da de baja cuentas sin administrador identificado.** El vencimiento automatico solo
alcanza a cuentas que efectivamente fueron notificadas a alguien. Las que no se pudieron
asignar quedan en cola de revision manual.

**No permite corregir una respuesta ya enviada desde el portal.** La correccion pasa por la
mesa de ayuda y queda registrada como decision interna con su justificacion.

## Pruebas de seguridad

`test/security.test.js` (17 casos) cubre el rechazo de caracteres de control y CRLF, la
validacion de correos, fechas e identificadores, el acotamiento de lotes y paginacion, la
entropia y unicidad de los tokens, que el token solo se guarde hasheado, el comportamiento
de PBKDF2 y de la comparacion en tiempo constante, y que el router no confunda rutas
literales con parametrizadas.

`test/templates.test.js` verifica que el escape de HTML y el saneo de asuntos impidan
inyeccion en los correos.
