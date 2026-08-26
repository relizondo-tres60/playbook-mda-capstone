# Modelo de datos

Motor: **Cloudflare D1** (SQLite). Todas las fechas se guardan en ISO-8601 UTC y se
presentan en `America/Santiago`. Todos los identificadores son UUID v4.

## Diagrama de relaciones

```
                      +-------------+
                      |  campaigns  |  una por periodo (ano/mes)
                      +------+------+
                             |
        +--------------------+---------------------+
        |                    |                     |
        v                    v                     v
   +---------+     +-------------------+   +---------------------+
   | imports |---->| imported_accounts |   | validation_requests |
   +---------+     +---------+---------+   +----------+----------+
   R2: archivo               |                        |
   original                  v                        v
                  +---------------------+   +----------------------+
                  | account_assignments |<--| validation_responses |
                  +----+-----------+----+   +----------------------+
                       |           |         una fila por cuenta decidida
        +--------------+           +--------------+
        v                                         v
  +-----------+                    +-------------------------+
  | companies |<-------------------| contract_administrators |
  +-----+-----+                    +-------------------------+
        |                          varios por empresa: se discrimina
        v                          por faena y contrato
  +-----------------+
  | company_aliases |  nombres mal escritos que apuntan a la empresa correcta
  +-----------------+

  Transversales: email_deliveries · audit_log · user_actions · internal_users
                 sessions · settings
```

## Entidades

### `campaigns` — campana mensual
Contiene el periodo, el plazo de respuesta y el estado del ciclo.

| Campo | Tipo | Notas |
|---|---|---|
| `code` | TEXT unico | `EXT-2026-08` |
| `period_year`, `period_month` | INTEGER | unicos en conjunto: una campana por mes |
| `status` | TEXT | `draft` → `imported` → `ready` → `sent` → `closed` |
| `response_days` | INTEGER | 14 por defecto |
| `sent_at`, `due_at`, `closed_at` | TEXT | hitos del ciclo |

### `imports` — carga de planilla
Una fila por archivo procesado. Deja la evidencia de la importacion.

| Campo | Notas |
|---|---|
| `checksum` | SHA-256 del archivo original: prueba de integridad |
| `r2_key` | ubicacion del archivo en R2 |
| `column_map` | JSON con el mapeo cabecera-origen → campo canonico |
| `row_count`, `ext_count`, `skipped_count` | trazabilidad del filtrado |

### `imported_accounts` — cuenta EXT detectada
Guarda **la fila cruda y los campos normalizados** en la misma tabla.

| Campo | Notas |
|---|---|
| `raw_json` | fila original completa, sin transformar |
| `sam_account_name`, `upn`, `display_name`, `email` | identidad |
| `company_raw`, `manager_raw`, `manager_email` | datos del origen, tal como vienen |
| `ou_path`, `site_raw`, `department` | insumos para detectar la faena |
| `ad_enabled`, `ad_locked`, `ad_deleted` | estado crudo en AD |
| `source_state` | derivado: `active` / `disabled` / `locked` / `deleted` |
| `is_ext`, `ext_reason` | resultado del filtro y la regla que lo produjo |
| `normalized_company_id` | FK a la empresa canonica |

Unico por `(campaign_id, sam_account_name)`: reimportar la planilla actualiza en vez de duplicar.

### `companies` y `company_aliases` — normalizacion de empresas
`normalized_key` es la clave canonica (sin acentos, sin puntuacion, sin sufijo societario):
`"Servicios Integrales S.p.A."` y `"SERV. INTEGRALES SPA"` comparten clave. Los alias
capturan las variantes que la clave no alcanza a unificar, para que la proxima importacion
se resuelva sola. Una empresa fusionada queda con `status = 'merged'` y `merged_into_id`.

### `contract_administrators` — administrador de contrato
Modela el caso central del negocio: **una empresa puede tener varios administradores**
segun `site` (Mantos Blancos, Mantoverde, Santiago) y `contract_number`. `is_default`
marca al responsable a usar cuando el cruce no logra desambiguar.
Unico por `(company_id, email_normalized, site)`.

### `account_assignments` — cruce cuenta ↔ administrador
Es la tabla central del proceso: une la cuenta con su empresa y responsable, y guarda la
decision final.

| Campo | Valores | Notas |
|---|---|---|
| `assignment_source` | `auto` / `manual` / `inherited` / `none` | como se asigno |
| `match_rule` | texto | la regla exacta que produjo el match (auditable) |
| `confidence` | 0..1 | umbral de auto-asignacion configurable (0.75) |
| `review_status` | `pending` / `auto_assigned` / `manual_review` / `confirmed` / `unassigned` / `excluded` | |
| `final_decision` | `keep` / `disable` | **los dos unicos estados de negocio** |
| `decision_source` | `administrator` / `timeout` / `internal` / `source_state` | por que se decidio asi |

`excluded` es el caso "ya deshabilitada o eliminada en origen": se refleja sin volver a
accionarla.

### `validation_requests` — solicitud enviada a un administrador
Una por `(campana, administrador)`.

| Campo | Notas |
|---|---|
| `token_hash` | SHA-256 del token; **el token en claro nunca se persiste** |
| `token_prefix` | primeros 8 caracteres, solo para soporte telefonico |
| `status` | `pending` → `sent` → `opened` → `responded` / `expired` / `failed` |
| `due_at` | fecha limite (envio + 14 dias) |
| `expires_at` | `due_at` + gracia del token |
| `open_count`, `first_opened_at`, `reminder_count` | trazabilidad de contacto |
| `failed_attempts` | intentos con token invalido |

### `validation_responses` — respuesta por cuenta
Una fila por cuenta decidida. Es el dato de negocio que el administrador informa:
`decision`, `contract_number`, `contract_valid_to`, `worker_end_date` y `comment`.
Unico por `(validation_request_id, account_assignment_id)`.

### `email_deliveries` — trazabilidad del envio
`kind` (`invitation` / `reminder` / `expiry_notice` / `confirmation` / `internal_summary`),
`to_email`, `cc_email`, `subject`, `provider`, `provider_message_id`, `status`, `error`,
`attempts`, `created_at`, `sent_at`. Registra tanto los exitos como los fallos.

### `audit_log` — bitacora append-only
`actor_type` (`internal_user` / `external_admin` / `system`), `action`, `entity_type`,
`entity_id`, `before_json`, `after_json`, `ip_hash`, `user_agent`, `created_at`.
La IP se guarda **hasheada con el secreto de la aplicacion**: permite correlacionar
accesos sin almacenar el dato personal en claro.

### `user_actions` — acciones del panel interno
Registro paralelo, orientado a "quien hizo que" dentro del equipo, separado de la
bitacora de negocio.

### `internal_users`, `sessions`, `settings`
Usuarios del panel (roles `admin` / `operator` / `auditor`, hash PBKDF2 con sal e
iteraciones por usuario), sesiones (token hasheado, expiracion, revocacion) y parametros
configurables en runtime.

## Vistas

**`v_campaign_accounts`** consolida cuenta + empresa + administrador + solicitud +
respuesta + decision. Es la fuente de la vista de cuentas, los filtros del panel y las
exportaciones.

**`v_disable_queue`** filtra la anterior por `final_decision = 'disable'` y
`source_state IN ('active','locked')`: exactamente lo que el equipo operativo debe
ejecutar en AD, sin las cuentas que ya estaban inactivas.

## Indices

Se indexaron los accesos reales del panel, no todas las columnas:
`imported_accounts(campaign_id, is_ext)`, `account_assignments(campaign_id, review_status)`,
`account_assignments(campaign_id, final_decision)`, `validation_requests(campaign_id, status)`,
`validation_requests(due_at)` (lo usa el cron diario), `audit_log(campaign_id, created_at)`.
