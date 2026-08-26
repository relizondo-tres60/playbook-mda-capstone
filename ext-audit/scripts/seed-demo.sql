-- ===========================================================================
-- Datos de demostracion para probar el flujo completo en local.
-- Ejecutar con:  npm run db:seed:local
--
-- Solo carga el catalogo maestro (empresas y administradores de contrato).
-- Las cuentas se cargan importando samples/admanager_export_sample.csv desde
-- el panel, que es exactamente el flujo real.
--
-- Los correos son de ejemplo. Antes de enviar una campana real, reemplacelos
-- por los correos verdaderos de cada administrador de contrato.
-- ===========================================================================

INSERT OR IGNORE INTO companies (id, canonical_name, normalized_key, status, created_at, updated_at) VALUES
  ('demo-co-1', 'Servicios Integrales SPA',      'servicios integrales',        'active', datetime('now'), datetime('now')),
  ('demo-co-2', 'Montajes Andinos Ltda',         'montajes andinos',            'active', datetime('now'), datetime('now')),
  ('demo-co-3', 'Transportes Nortinos SA',       'transportes nortinos',        'active', datetime('now'), datetime('now')),
  ('demo-co-4', 'Aseo Industrial del Norte SpA', 'aseo industrial del norte',   'active', datetime('now'), datetime('now')),
  ('demo-co-5', 'Seguridad Austral Ltda',        'seguridad austral',           'active', datetime('now'), datetime('now'));

-- Alias que aparecen mal escritos en las planillas de AD Manager.
INSERT OR IGNORE INTO company_aliases (id, company_id, alias, normalized_key, source, created_at) VALUES
  ('demo-al-1', 'demo-co-2', 'MONTAJES ANDINO LTDA', 'montajes andino', 'manual', datetime('now')),
  ('demo-al-2', 'demo-co-4', 'ASEO INDUSTRIAL DEL NORTE', 'aseo industrial del norte spa', 'manual', datetime('now'));

-- Una misma empresa con varios administradores segun faena: es el caso que
-- obliga a desambiguar por sede y no solo por nombre de empresa.
INSERT OR IGNORE INTO contract_administrators
  (id, company_id, full_name, email, email_normalized, site, contract_number,
   contract_valid_from, contract_valid_to, is_default, status, created_at, updated_at) VALUES
  ('demo-ad-1', 'demo-co-1', 'Juan Perez',      'juan.perez@servintegrales.cl',        'juan.perez@servintegrales.cl',        'Mantos Blancos', 'CTR-2026-0011', '2026-01-01', '2026-12-31', 1, 'active', datetime('now'), datetime('now')),
  ('demo-ad-2', 'demo-co-1', 'Andrea Soto',     'andrea.soto@servintegrales.cl',       'andrea.soto@servintegrales.cl',       'Mantoverde',     'CTR-2026-0012', '2026-01-01', '2026-12-31', 0, 'active', datetime('now'), datetime('now')),
  ('demo-ad-3', 'demo-co-2', 'Rodrigo Munoz',   'rodrigo.munoz@montajesandinos.cl',    'rodrigo.munoz@montajesandinos.cl',    'Santiago',       'CTR-2026-0033', '2026-03-01', '2027-02-28', 1, 'active', datetime('now'), datetime('now')),
  ('demo-ad-4', 'demo-co-2', 'Claudia Bravo',   'claudia.bravo@montajesandinos.cl',    'claudia.bravo@montajesandinos.cl',    'Mantoverde',     'CTR-2026-0034', '2026-03-01', '2027-02-28', 0, 'active', datetime('now'), datetime('now')),
  ('demo-ad-5', 'demo-co-3', 'Patricia Nunez',  'patricia.nunez@transportesnortinos.cl','patricia.nunez@transportesnortinos.cl','Mantos Blancos','CTR-2026-0050', '2025-07-01', '2026-06-30', 1, 'active', datetime('now'), datetime('now')),
  ('demo-ad-6', 'demo-co-4', 'Marcela Fuentes', 'marcela.fuentes@aseoindustrialdelnorte.cl','marcela.fuentes@aseoindustrialdelnorte.cl','Mantoverde','CTR-2026-0077','2026-04-01','2027-03-31',1,'active', datetime('now'), datetime('now')),
  ('demo-ad-7', 'demo-co-5', 'Hector Salas',    'hector.salas@seguridadaustral.cl',    'hector.salas@seguridadaustral.cl',    'Santiago',       'CTR-2026-0090', '2026-07-01', '2027-06-30', 1, 'active', datetime('now'), datetime('now'));
