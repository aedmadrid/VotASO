-- ============================================================================
-- schema.reset.sql — DESTRUCTIVO
--
-- Borra TODAS las tablas de la urna. Úsalo solo en entornos de prueba o cuando
-- quieras empezar de cero a propósito. NUNCA lo ejecutes contra una urna con
-- historial electoral real: el borrado no es reversible ni queda registrado en
-- la cadena de bloques.
--
--   npx wrangler d1 execute votaso-urna-db --remote --file=./schema.reset.sql
--   npx wrangler d1 execute votaso-urna-db --remote --file=./schema.sql
-- ============================================================================

DROP TABLE IF EXISTS urna;
DROP TABLE IF EXISTS elecciones;
DROP TABLE IF EXISTS admin_acciones;
