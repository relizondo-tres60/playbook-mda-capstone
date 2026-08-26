-- ===========================================================================
-- Migracion 0002 - vistas operativas y configuracion por defecto
-- ===========================================================================

-- Vista consolidada de cuentas EXT con su empresa/administrador y decision.
CREATE VIEW v_campaign_accounts AS
SELECT
  aa.id                    AS assignment_id,
  aa.campaign_id           AS campaign_id,
  c.code                   AS campaign_code,
  ia.id                    AS account_id,
  ia.sam_account_name      AS sam_account_name,
  ia.display_name          AS display_name,
  ia.upn                   AS upn,
  ia.email                 AS email,
  ia.department            AS department,
  ia.job_title             AS job_title,
  ia.company_raw           AS company_raw,
  ia.manager_raw           AS manager_raw,
  ia.manager_email         AS manager_email,
  ia.ou_path               AS ou_path,
  ia.last_logon_at         AS last_logon_at,
  ia.source_state          AS source_state,
  ia.ext_reason            AS ext_reason,
  co.id                    AS company_id,
  co.canonical_name        AS company_name,
  ca.id                    AS administrator_id,
  ca.full_name             AS administrator_name,
  ca.email                 AS administrator_email,
  ca.site                  AS administrator_site,
  aa.contract_number       AS contract_number,
  aa.site                  AS site,
  aa.review_status         AS review_status,
  aa.assignment_source     AS assignment_source,
  aa.match_rule            AS match_rule,
  aa.confidence            AS confidence,
  aa.final_decision        AS final_decision,
  aa.decision_source       AS decision_source,
  aa.decided_at            AS decided_at,
  vr.id                    AS validation_request_id,
  vr.status                AS request_status,
  vr.sent_at               AS request_sent_at,
  vr.due_at                AS request_due_at,
  vr.responded_at          AS request_responded_at,
  vres.contract_valid_to   AS response_contract_valid_to,
  vres.worker_end_date     AS response_worker_end_date,
  vres.comment             AS response_comment
FROM account_assignments aa
JOIN imported_accounts ia       ON ia.id = aa.imported_account_id
JOIN campaigns c                ON c.id = aa.campaign_id
LEFT JOIN companies co          ON co.id = aa.company_id
LEFT JOIN contract_administrators ca ON ca.id = aa.administrator_id
LEFT JOIN validation_requests vr
       ON vr.campaign_id = aa.campaign_id AND vr.administrator_id = aa.administrator_id
LEFT JOIN validation_responses vres
       ON vres.account_assignment_id = aa.id;

-- Cola de bajas: lo que el equipo operativo debe ejecutar en AD.
CREATE VIEW v_disable_queue AS
SELECT *
FROM v_campaign_accounts
WHERE final_decision = 'disable'
  AND source_state IN ('active','locked');

INSERT INTO settings (key, value, updated_at) VALUES
  ('ext_match_mode',        'token',   datetime('now')),
  ('auto_assign_threshold', '0.75',    datetime('now')),
  ('response_days',         '14',      datetime('now')),
  ('reminder_days',         '7,3,1',   datetime('now')),
  ('token_grace_days',      '7',       datetime('now'));
