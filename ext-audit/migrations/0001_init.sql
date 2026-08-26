-- ===========================================================================
-- Auditoria mensual de cuentas externas (EXT) de Active Directory
-- Motor: Cloudflare D1 (SQLite)
-- Migracion 0001 - esquema inicial
-- ===========================================================================
PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------------------
-- Usuarios internos (panel de seguimiento y auditoria)
-- --------------------------------------------------------------------------
CREATE TABLE internal_users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin','operator','auditor')),
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  password_iter  INTEGER NOT NULL DEFAULT 210000,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES internal_users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  ip_hash     TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- --------------------------------------------------------------------------
-- Empresas y sus alias (normalizacion de nombres inconsistentes)
-- --------------------------------------------------------------------------
CREATE TABLE companies (
  id              TEXT PRIMARY KEY,
  canonical_name  TEXT NOT NULL,
  normalized_key  TEXT NOT NULL UNIQUE,
  tax_id          TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','archived')),
  merged_into_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_companies_status ON companies(status);

CREATE TABLE company_aliases (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias           TEXT NOT NULL,
  normalized_key  TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','merge')),
  created_at      TEXT NOT NULL,
  UNIQUE (normalized_key)
);
CREATE INDEX idx_aliases_company ON company_aliases(company_id);

-- --------------------------------------------------------------------------
-- Administradores de contrato.
-- Una empresa puede tener varios: se discrimina por sede/faena y contrato.
-- --------------------------------------------------------------------------
CREATE TABLE contract_administrators (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name            TEXT NOT NULL,
  email                TEXT NOT NULL,
  email_normalized     TEXT NOT NULL,
  phone                TEXT,
  site                 TEXT,               -- Mantos Blancos | Mantoverde | Santiago | ...
  contract_number      TEXT,
  contract_valid_from  TEXT,
  contract_valid_to    TEXT,
  is_default           INTEGER NOT NULL DEFAULT 0,   -- fallback de la empresa
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes                TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (company_id, email_normalized, site)
);
CREATE INDEX idx_admins_company ON contract_administrators(company_id);
CREATE INDEX idx_admins_email ON contract_administrators(email_normalized);

-- --------------------------------------------------------------------------
-- Campanas mensuales
-- --------------------------------------------------------------------------
CREATE TABLE campaigns (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,     -- EXT-2026-08
  name           TEXT NOT NULL,
  period_year    INTEGER NOT NULL,
  period_month   INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','imported','ready','sent','closed','cancelled')),
  response_days  INTEGER NOT NULL DEFAULT 14,
  sent_at        TEXT,
  due_at         TEXT,
  closed_at      TEXT,
  created_by     TEXT REFERENCES internal_users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (period_year, period_month)
);
CREATE INDEX idx_campaigns_status ON campaigns(status);

-- --------------------------------------------------------------------------
-- Importaciones desde AD Manager
-- --------------------------------------------------------------------------
CREATE TABLE imports (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,
  content_type   TEXT,
  size_bytes     INTEGER,
  checksum       TEXT,                     -- SHA-256 del archivo original
  r2_key         TEXT,                     -- respaldo inmutable en R2
  source_system  TEXT NOT NULL DEFAULT 'ad_manager',
  row_count      INTEGER NOT NULL DEFAULT 0,
  ext_count      INTEGER NOT NULL DEFAULT 0,
  skipped_count  INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'processed'
                 CHECK (status IN ('processing','processed','failed')),
  error          TEXT,
  column_map     TEXT,                     -- JSON: cabecera origen -> campo canonico
  imported_by    TEXT REFERENCES internal_users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_imports_campaign ON imports(campaign_id);

-- --------------------------------------------------------------------------
-- Cuentas importadas (fila cruda + campos normalizados)
-- --------------------------------------------------------------------------
CREATE TABLE imported_accounts (
  id                   TEXT PRIMARY KEY,
  import_id            TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  campaign_id          TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  row_number           INTEGER,
  raw_json             TEXT NOT NULL,      -- fila original completa (evidencia)
  sam_account_name     TEXT,
  display_name         TEXT,
  upn                  TEXT,
  email                TEXT,
  department           TEXT,
  job_title            TEXT,
  company_raw          TEXT,
  manager_raw          TEXT,
  manager_email        TEXT,
  ou_path              TEXT,
  site_raw             TEXT,
  ad_enabled           INTEGER,            -- 1 habilitada, 0 deshabilitada
  ad_locked            INTEGER,
  ad_deleted           INTEGER,
  password_expired     INTEGER,
  last_logon_at        TEXT,
  created_at_source    TEXT,
  expires_at_source    TEXT,
  is_ext               INTEGER NOT NULL DEFAULT 0,
  ext_reason           TEXT,
  source_state         TEXT NOT NULL DEFAULT 'active'
                       CHECK (source_state IN ('active','disabled','locked','deleted')),
  normalized_company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  UNIQUE (campaign_id, sam_account_name)
);
CREATE INDEX idx_accounts_campaign ON imported_accounts(campaign_id);
CREATE INDEX idx_accounts_ext ON imported_accounts(campaign_id, is_ext);
CREATE INDEX idx_accounts_company ON imported_accounts(normalized_company_id);

-- --------------------------------------------------------------------------
-- Asignacion cuenta -> empresa / administrador de contrato
-- --------------------------------------------------------------------------
CREATE TABLE account_assignments (
  id                   TEXT PRIMARY KEY,
  campaign_id          TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  imported_account_id  TEXT NOT NULL REFERENCES imported_accounts(id) ON DELETE CASCADE,
  company_id           TEXT REFERENCES companies(id) ON DELETE SET NULL,
  administrator_id     TEXT REFERENCES contract_administrators(id) ON DELETE SET NULL,
  contract_number      TEXT,
  site                 TEXT,
  assignment_source    TEXT NOT NULL DEFAULT 'auto'
                       CHECK (assignment_source IN ('auto','manual','inherited','none')),
  match_rule           TEXT,               -- regla que produjo el match (trazabilidad)
  confidence           REAL NOT NULL DEFAULT 0,
  review_status        TEXT NOT NULL DEFAULT 'pending'
                       CHECK (review_status IN ('pending','auto_assigned','manual_review','confirmed','unassigned','excluded')),
  final_decision       TEXT CHECK (final_decision IN ('keep','disable')),
  decision_source      TEXT CHECK (decision_source IN ('administrator','timeout','internal','source_state')),
  decided_at           TEXT,
  assigned_by          TEXT REFERENCES internal_users(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (campaign_id, imported_account_id)
);
CREATE INDEX idx_assign_campaign ON account_assignments(campaign_id);
CREATE INDEX idx_assign_admin ON account_assignments(campaign_id, administrator_id);
CREATE INDEX idx_assign_review ON account_assignments(campaign_id, review_status);
CREATE INDEX idx_assign_decision ON account_assignments(campaign_id, final_decision);

-- --------------------------------------------------------------------------
-- Solicitudes de validacion (una por administrador y campana)
-- --------------------------------------------------------------------------
CREATE TABLE validation_requests (
  id                TEXT PRIMARY KEY,
  campaign_id       TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  administrator_id  TEXT NOT NULL REFERENCES contract_administrators(id) ON DELETE CASCADE,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL UNIQUE,  -- SHA-256 del token; el token NO se persiste
  token_prefix      TEXT NOT NULL,         -- primeros 8 chars, solo para soporte
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','opened','responded','expired','cancelled','failed')),
  accounts_count    INTEGER NOT NULL DEFAULT 0,
  sent_at           TEXT,
  first_opened_at   TEXT,
  last_opened_at    TEXT,
  responded_at      TEXT,
  due_at            TEXT NOT NULL,
  expires_at        TEXT NOT NULL,         -- due_at + TOKEN_GRACE_DAYS
  reminder_count    INTEGER NOT NULL DEFAULT 0,
  last_reminder_at  TEXT,
  open_count        INTEGER NOT NULL DEFAULT 0,
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (campaign_id, administrator_id)
);
CREATE INDEX idx_vr_campaign ON validation_requests(campaign_id, status);
CREATE INDEX idx_vr_due ON validation_requests(due_at);

-- --------------------------------------------------------------------------
-- Respuestas del administrador (una fila por cuenta decidida)
-- --------------------------------------------------------------------------
CREATE TABLE validation_responses (
  id                     TEXT PRIMARY KEY,
  validation_request_id  TEXT NOT NULL REFERENCES validation_requests(id) ON DELETE CASCADE,
  account_assignment_id  TEXT NOT NULL REFERENCES account_assignments(id) ON DELETE CASCADE,
  decision               TEXT NOT NULL CHECK (decision IN ('keep','disable')),
  contract_number        TEXT,
  contract_valid_to      TEXT,
  worker_end_date        TEXT,
  comment                TEXT,
  responded_at           TEXT NOT NULL,
  responder_ip_hash      TEXT,
  responder_ua           TEXT,
  UNIQUE (validation_request_id, account_assignment_id)
);
CREATE INDEX idx_vresp_request ON validation_responses(validation_request_id);

-- --------------------------------------------------------------------------
-- Envios de correo
-- --------------------------------------------------------------------------
CREATE TABLE email_deliveries (
  id                     TEXT PRIMARY KEY,
  campaign_id            TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  validation_request_id  TEXT REFERENCES validation_requests(id) ON DELETE CASCADE,
  kind                   TEXT NOT NULL
                         CHECK (kind IN ('invitation','reminder','expiry_notice','confirmation','internal_summary')),
  to_email               TEXT NOT NULL,
  cc_email               TEXT,
  subject                TEXT NOT NULL,
  body_preview           TEXT,
  provider               TEXT NOT NULL,
  provider_message_id    TEXT,
  status                 TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued','sent','failed')),
  error                  TEXT,
  attempts               INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL,
  sent_at                TEXT
);
CREATE INDEX idx_email_campaign ON email_deliveries(campaign_id, status);
CREATE INDEX idx_email_request ON email_deliveries(validation_request_id);

-- --------------------------------------------------------------------------
-- Bitacora de auditoria (append-only)
-- --------------------------------------------------------------------------
CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('internal_user','external_admin','system')),
  actor_id     TEXT,
  actor_label  TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  before_json  TEXT,
  after_json   TEXT,
  ip_hash      TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_audit_campaign ON audit_log(campaign_id, created_at);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- --------------------------------------------------------------------------
-- Acciones de usuarios internos (trazabilidad de operacion del panel)
-- --------------------------------------------------------------------------
CREATE TABLE user_actions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES internal_users(id) ON DELETE SET NULL,
  campaign_id  TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  payload_json TEXT,
  ip_hash      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_uactions_user ON user_actions(user_id, created_at);

-- --------------------------------------------------------------------------
-- Configuracion parametrizable en runtime
-- --------------------------------------------------------------------------
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
