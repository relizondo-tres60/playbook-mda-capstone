# Integracion con Google Workspace

## Por que API de Gmail y no SMTP

El runtime de Cloudflare Workers **no permite abrir conexiones TCP a un servidor SMTP**:
solo hay `fetch` sobre HTTP/HTTPS. Por lo tanto `smtp.gmail.com:587` no es alcanzable
desde el Worker, y la integracion se hace contra la API REST de Gmail
(`gmail.googleapis.com`), que ademas evita administrar contrasenas de aplicacion.

Si en el futuro se decidiera usar SMTP, habria que interponer un relay HTTP (un servicio
externo o un pequeno proceso propio). No es necesario hoy y agregaria una pieza mas que
mantener.

## Modos disponibles

La variable `MAIL_PROVIDER` decide el modo. Cambiar de modo o de casilla remitente **no
requiere tocar codigo**.

| `MAIL_PROVIDER` | Cuando usarlo |
|---|---|
| `console` | desarrollo y pruebas: registra el envio sin enviar nada |
| `gmail_oauth` | primera etapa: pruebas reales desde `relizondo@tres60.cl` |
| `gmail_service_account` | produccion: casilla institucional, sin depender de una persona |

---

## Etapa 1 — pruebas con `relizondo@tres60.cl` (`gmail_oauth`)

Sirve para validar el flujo real sin pedir cambios al administrador del dominio.

### 1. Crear las credenciales OAuth

1. Google Cloud Console → crear (o elegir) un proyecto.
2. **APIs y servicios → Biblioteca** → habilitar **Gmail API**.
3. **Pantalla de consentimiento OAuth** → tipo **Interno** (solo el dominio tres60.cl).
4. **Credenciales → Crear credenciales → ID de cliente de OAuth** → tipo
   **Aplicacion de escritorio**. Anotar `client_id` y `client_secret`.

### 2. Obtener el `refresh_token`

En el navegador, ya con sesion de `relizondo@tres60.cl`:

```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=<CLIENT_ID>
  &redirect_uri=http://localhost
  &response_type=code
  &scope=https://www.googleapis.com/auth/gmail.send
  &access_type=offline
  &prompt=consent
```

Autorizar. El navegador redirige a `http://localhost/?code=XXXX` (mostrara un error de
conexion: es normal, el codigo esta en la URL). Canjear el codigo:

```bash
curl -s https://oauth2.googleapis.com/token \
  -d client_id=<CLIENT_ID> \
  -d client_secret=<CLIENT_SECRET> \
  -d code=<CODE> \
  -d grant_type=authorization_code \
  -d redirect_uri=http://localhost
```

Guardar el `refresh_token` de la respuesta.

### 3. Configurar

```bash
npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
npx wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
```

Y en `wrangler.toml`:

```toml
MAIL_PROVIDER = "gmail_oauth"
MAIL_FROM = "relizondo@tres60.cl"
MAIL_FROM_NAME = "Auditoria de Cuentas Externas - Tres60"
MAIL_REPLY_TO = "relizondo@tres60.cl"
```

El `refresh_token` esta ligado a la cuenta personal: si esa cuenta se desactiva, los
envios se detienen. Por eso es una etapa de prueba, no el destino final.

---

## Etapa 2 — produccion con Service Account (`gmail_service_account`)

Desacopla el envio de cualquier persona: el remitente pasa a ser una casilla
institucional y cambiarlo es editar una variable.

### 1. Crear la Service Account

1. Google Cloud Console → **IAM y administracion → Cuentas de servicio → Crear**.
2. Nombre sugerido: `ext-audit-mailer`.
3. **Claves → Agregar clave → Crear clave nueva → JSON**. Descargar.
4. Anotar el **Client ID numerico** de la cuenta de servicio (lo pide el paso 2).

### 2. Autorizar la delegacion a nivel de dominio

En **admin.google.com** (se requiere un superadministrador del dominio tres60.cl):

**Seguridad → Control de acceso y datos → Controles de API → Delegacion de dominio →
Anadir**

| Campo | Valor |
|---|---|
| ID de cliente | el Client ID numerico de la cuenta de servicio |
| Ambitos OAuth | `https://www.googleapis.com/auth/gmail.send` |

Solo se concede `gmail.send`: la aplicacion puede enviar, **no puede leer** correo.

### 3. Configurar

Del JSON descargado se usan dos campos: `client_email` y `private_key`.

```bash
npx wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env production
# ext-audit-mailer@<proyecto>.iam.gserviceaccount.com

npx wrangler secret put GOOGLE_SA_PRIVATE_KEY --env production
# pegar la clave completa, incluyendo -----BEGIN PRIVATE KEY----- y -----END PRIVATE KEY-----
# Se aceptan tanto saltos de linea reales como la forma escapada \n del JSON.

npx wrangler secret put GOOGLE_IMPERSONATE_USER --env production
# relizondo@tres60.cl  (mas adelante: auditoria-cuentas@tres60.cl)
```

Y en `wrangler.toml`, `[env.production.vars]`:

```toml
MAIL_PROVIDER = "gmail_service_account"
MAIL_FROM = "relizondo@tres60.cl"
MAIL_FROM_NAME = "Auditoria de Cuentas Externas - Tres60"
MAIL_REPLY_TO = "relizondo@tres60.cl"
MAIL_CC_HELPDESK = "mesadeayuda@tres60.cl"
```

## Cambiar la casilla remitente

Es el escenario previsto desde el diseno. Con `gmail_service_account`:

1. Crear la casilla nueva (por ejemplo `auditoria-cuentas@tres60.cl`).
2. `npx wrangler secret put GOOGLE_IMPERSONATE_USER --env production` con el nuevo valor.
3. Cambiar `MAIL_FROM` y `MAIL_REPLY_TO` en `wrangler.toml`.
4. `npx wrangler deploy --env production`.

No hay cambios de codigo, ni de esquema, ni de plantillas. La delegacion de dominio ya
cubre a cualquier usuario del dominio.

## Verificar la configuracion

Sin enviar correo: panel interno → **Configuracion**, o `GET /api/mail/status`.

```json
{ "provider": "gmail_service_account", "from": "relizondo@tres60.cl",
  "ccHelpdesk": "mesadeayuda@tres60.cl", "ready": true, "issues": [] }
```

Envio real de prueba: crear una campana de prueba con un unico administrador cuyo correo
sea el propio, importar la planilla de ejemplo y enviar.

## Plantillas

Estan en `src/services/templates.js`, en HTML con version en texto plano:

| Plantilla | Cuando |
|---|---|
| `invitationEmail` | inicio de la campana |
| `reminderEmail` | D-7, D-3 y D-1 (configurable con `REMINDER_DAYS`) |
| `confirmationEmail` | acuse tras responder |
| `expiryNoticeEmail` | plazo vencido sin respuesta |

Todo dato dinamico pasa por `escapeHtml`, y los asuntos por `sanitizeSubject`, que elimina
CR/LF para impedir inyeccion de cabeceras. Los correos llevan `Auto-Submitted:
auto-generated` para no gatillar respuestas automaticas en cadena.

Si se cambia el diseno, conviene ajustar tambien `test/templates.test.js`, que verifica
que el enlace, la fecha limite y el escape del contenido sigan presentes.

## Entregabilidad

El dominio tres60.cl ya envia por Google Workspace, asi que SPF, DKIM y DMARC estan
resueltos. Al enviar a decenas de dominios externos conviene, antes de la primera campana
real, mandar un envio de prueba a una casilla externa y revisar que no caiga en correo no
deseado. Si ocurre, revisar que `MAIL_FROM` corresponda a una casilla real del dominio
(nunca un `no-reply@` inexistente) y que el `Reply-To` apunte a una casilla atendida.

## Limites

La API de Gmail permite 2.000 mensajes diarios por usuario en Workspace. Una campana
mensual envia un correo por administrador de contrato (decenas), mas recordatorios y
acuses: muy por debajo del limite. Si alguna vez se acercara, el envio ya esta hecho
solicitud por solicitud y podria distribuirse en varias corridas del cron sin rediseno.

## Diagnostico

| Error | Causa habitual |
|---|---|
| `unauthorized_client` | falta la delegacion de dominio, o el ambito no coincide exactamente |
| `invalid_grant` | reloj desfasado, `GOOGLE_IMPERSONATE_USER` no existe en el dominio, o `refresh_token` revocado |
| `Precondition check failed` | la casilla suplantada no tiene Gmail habilitado |
| `Invalid JWT Signature` | la `private_key` se pego truncada o sin los delimitadores BEGIN/END |

Cada intento fallido queda en `email_deliveries` con su mensaje de error, visible en el
panel bajo **Envios y seguimiento**.
