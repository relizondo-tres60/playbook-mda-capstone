# API

Base: `https://<dominio>/api`. Todas las respuestas son JSON salvo las exportaciones.

## Autenticacion

**Panel interno.** Cookie de sesion `ext_audit_session` (`HttpOnly`, `Secure`,
`SameSite=Strict`), emitida por `POST /api/auth/login`. En mutaciones se valida ademas
que el `Origin` sea el propio servicio o uno de `ALLOWED_ORIGINS`.

**Portal externo.** Token de un solo proposito en la ruta. No usa cookies ni lee la
sesion interna.

## Roles

| Rol | Puede |
|---|---|
| `auditor` | leer todo: campanas, cuentas, bitacora, exportaciones |
| `operator` | ademas: importar, reasignar, generar y enviar campanas |
| `admin` | ademas: usuarios, configuracion y ejecucion manual de los jobs |

## Errores

```json
{ "error": "bad_request", "message": "El campo \"email\" no es un correo valido", "requestId": "..." }
```

| HTTP | `error` | Cuando |
|---|---|---|
| 400 | `bad_request` | validacion de entrada |
| 401 | `unauthorized` | sin sesion o credenciales invalidas |
| 403 | `forbidden` | rol insuficiente, origen no permitido, plazo cerrado |
| 404 | `not_found` | recurso o enlace inexistente |
| 405 | `method_not_allowed` | ruta valida, metodo incorrecto |
| 409 | `conflict` | duplicado o estado incompatible |
| 429 | `rate_limited` | demasiados intentos de acceso |
| 500 | `internal_error` | error no controlado (sin filtrar stack traces) |

---

## Publicas

### `GET /api/health`
Estado del servicio. Lo usa el workflow de despliegue.
```json
{ "status": "ok", "time": "2026-08-26T12:00:00.000Z", "db": "ok", "mailProvider": "gmail_service_account", "version": "1.0.0" }
```

### `POST /api/setup`
Crea el primer usuario administrador. Solo funciona si **no existe ningun usuario** y se
presenta el `SETUP_TOKEN` configurado como secreto.
```json
{ "setupToken": "...", "email": "relizondo@tres60.cl", "name": "Rodrigo Elizondo", "password": "..." }
```

### `POST /api/auth/login`
```json
{ "email": "relizondo@tres60.cl", "password": "..." }
```
Responde `{ "user": {...} }` y emite la cookie de sesion. Cinco fallos consecutivos
bloquean la cuenta 15 minutos.

---

## Sesion interna

| Metodo | Ruta | Rol | Descripcion |
|---|---|---|---|
| `POST` | `/api/auth/logout` | cualquiera | revoca la sesion |
| `GET` | `/api/auth/me` | cualquiera | usuario y rol actual |
| `POST` | `/api/auth/password` | cualquiera | cambia la propia contrasena (reautentica) |
| `GET` | `/api/users` | admin | lista usuarios internos |
| `POST` | `/api/users` | admin | crea usuario interno |

## Campanas

| Metodo | Ruta | Rol | Descripcion |
|---|---|---|---|
| `GET` | `/api/campaigns` | auditor | listado con contadores |
| `POST` | `/api/campaigns` | operator | crea la campana del periodo |
| `GET` | `/api/campaigns/:id` | auditor | detalle |
| `GET` | `/api/campaigns/:id/dashboard` | auditor | KPIs, distribucion, solicitudes, importaciones |
| `POST` | `/api/campaigns/:id/close` | operator | cierra y congela decisiones |

**`POST /api/campaigns`**
```json
{ "year": 2026, "month": 8, "responseDays": 14, "notes": "opcional" }
```

## Importacion

### `POST /api/imports/preview` — `multipart/form-data`, campo `file`
Analiza el archivo **sin persistir nada**. Devuelve columnas reconocidas, conteo de
cuentas EXT, empresas detectadas y una muestra de 20 filas. Rol: `operator`.

### `POST /api/campaigns/:id/import` — `multipart/form-data`, campo `file`
Importa, guarda el original en R2 y ejecuta el cruce automatico. Rol: `operator`.
```json
{
  "import": { "importId": "...", "checksum": "...", "rowCount": 412, "extCount": 287, "skipped": 3 },
  "assignments": { "total": 287, "autoAssigned": 231, "manualReview": 41, "unassigned": 15 }
}
```
Formatos: `.csv`, `.tsv`, `.xlsx`. Maximo 15 MB y 20.000 filas.

### `POST /api/campaigns/:id/rebuild-assignments`
Recalcula el cruce. `{"force": true}` reprocesa tambien las ya confirmadas manualmente
(por defecto las respeta). Rol: `operator`.

## Cuentas y asignaciones

### `GET /api/campaigns/:id/accounts`
Filtros por query string: `search`, `companyId`, `administratorId`, `reviewStatus`,
`decision`, `requestStatus`, `sourceState`, `overdue=true`, `limit`, `offset`.
```json
{ "rows": [ /* v_campaign_accounts */ ], "total": 287, "limit": 200, "offset": 0 }
```

### `PATCH /api/assignments/:id`
Correccion manual del cruce. Rol: `operator`.
```json
{ "companyId": "...", "administratorId": "...", "contractNumber": "CTR-2026-0011", "site": "Mantoverde", "reviewStatus": "confirmed" }
```

### `POST /api/assignments/:id/decision`
Decision interna documentada (excepcion). Exige `reason`. Rol: `operator`.
```json
{ "decision": "keep", "reason": "Confirmado telefonicamente con el administrador el 20-08" }
```

## Solicitudes y envio

| Metodo | Ruta | Rol | Descripcion |
|---|---|---|---|
| `POST` | `/api/campaigns/:id/generate-requests` | operator | una solicitud por administrador con cuentas asignadas |
| `POST` | `/api/campaigns/:id/send` | operator | envia las invitaciones |
| `GET` | `/api/requests/:id` | auditor | detalle, cuentas y correos de una solicitud |
| `POST` | `/api/requests/:id/resend` | operator | reenvia **rotando el token** |

**`POST /api/campaigns/:id/send`**
```json
{ "resend": false, "requestIds": ["...", "..."] }
```
`resend: true` incluye a quienes ya recibieron el correo y aun no responden; rota sus
tokens, invalidando el enlace anterior. `requestIds` acota el envio.

## Catalogo maestro

| Metodo | Ruta | Rol | Descripcion |
|---|---|---|---|
| `GET` | `/api/companies` | auditor | listado (`search`, `limit`, `offset`) |
| `POST` | `/api/companies` | operator | crea empresa |
| `GET` | `/api/companies/duplicates` | auditor | pares con similitud >= 0.82 |
| `GET` | `/api/companies/:id` | auditor | detalle con alias y administradores |
| `PATCH` | `/api/companies/:id` | operator | edita |
| `POST` | `/api/companies/:id/aliases` | operator | agrega alias |
| `POST` | `/api/companies/:id/merge` | operator | fusiona en `targetId` |
| `GET` | `/api/administrators` | auditor | listado (`companyId`, `search`) |
| `POST` | `/api/administrators` | operator | crea administrador de contrato |
| `PATCH` | `/api/administrators/:id` | operator | edita |
| `DELETE` | `/api/administrators/:id` | operator | desactiva (conserva historial) |

**`POST /api/administrators`**
```json
{
  "companyId": "...", "fullName": "Juan Perez", "email": "juan.perez@servintegrales.cl",
  "site": "Mantos Blancos", "contractNumber": "CTR-2026-0011",
  "contractValidFrom": "2026-01-01", "contractValidTo": "2026-12-31", "isDefault": true
}
```

## Exportaciones

`GET /api/campaigns/:id/export/:kind` — rol `auditor`. CSV con separador `;` y BOM UTF-8
(abre bien en Excel en Windows).

| `kind` | Contenido |
|---|---|
| `bajas` | cola de bajas a ejecutar en AD |
| `bajas.ps1` | script PowerShell de apoyo (con `-WhatIf`) |
| `completo` | toda la campana: evidencia de auditoria |
| `sin-administrador` | cola de revision manual |
| `auditoria` | bitacora de la campana |

## Operacion y auditoria

| Metodo | Ruta | Rol | Descripcion |
|---|---|---|---|
| `GET` | `/api/audit` | auditor | bitacora (`campaignId`, `action`, `actorType`, `entityId`, `from`, `to`) |
| `GET` | `/api/emails` | auditor | envios (`campaignId`, `status`) |
| `GET` | `/api/settings` | auditor | parametros y estado del correo |
| `PUT` | `/api/settings` | admin | ajusta parametros configurables |
| `GET` | `/api/mail/status` | auditor | diagnostico del proveedor de correo |
| `POST` | `/api/jobs/daily` | admin | ejecuta la rutina diaria completa |
| `POST` | `/api/jobs/expire` | admin | solo vencimientos |
| `POST` | `/api/jobs/reminders` | admin | solo recordatorios |

---

## Portal externo

### `GET /api/portal/:token`
Devuelve la vista del administrador. Registra la apertura en la bitacora.
```json
{
  "state": "open",
  "request": { "dueAt": "2026-09-09T...", "daysLeft": 11, "status": "sent" },
  "campaign": { "code": "EXT-2026-08", "year": 2026, "month": 8 },
  "administrator": { "name": "Juan Perez", "email": "...", "site": "Mantos Blancos" },
  "company": { "name": "Servicios Integrales SPA" },
  "defaultContractNumber": "CTR-2026-0011",
  "accounts": [
    {
      "assignmentId": "...", "samAccountName": "ext_jsoto", "displayName": "Jorge Soto Vera",
      "department": "Mantencion", "lastLogonAt": "2026-07-15T...", "sourceState": "active",
      "contractNumber": null, "decision": null
    }
  ]
}
```

`state`: `open` (acepta respuestas), `responded`, `expired`, `cancelled`, `closed`.

### `POST /api/portal/:token/submit`
```json
{
  "decisions": [
    { "assignmentId": "...", "decision": "keep",
      "contractNumber": "CTR-2026-0011", "contractValidTo": "2026-12-31" },
    { "assignmentId": "...", "decision": "disable",
      "workerEndDate": "2026-07-31", "comment": "Termino de faena" }
  ]
}
```

El portal captura `contractNumber` y `contractValidTo` una sola vez, en el bloque
*Datos del contrato*, porque son atributos del contrato y no del trabajador; los
replica en cada decision al enviar. La API los acepta por cuenta, de modo que un
integrador puede informarlos distintos si su caso lo requiere.

Reglas que aplica el servidor:
- Deben venir **todas** las cuentas de la solicitud; faltar alguna es error 400.
- `decision` solo acepta `keep` o `disable`.
- Una cuenta que no pertenece a la solicitud es error 403.
- Dar de baja exige `workerEndDate` **o** `comment`.
- Enviar dos veces es error 409: la respuesta es definitiva.
- Fuera de plazo es error 403.

Respuesta: `{ "ok": true, "keep": 12, "disable": 3, "total": 15, "respondedAt": "..." }`.
Dispara el correo de confirmacion al administrador.
