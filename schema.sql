-- ============================================================================
-- schema.sql — Estructura de la Base de Datos Transparente en Cloudflare D1
--
-- INICIALIZAR (idempotente: se puede reejecutar sin perder datos):
--   npx wrangler d1 execute votaso-urna-db --remote --file=./schema.sql
--
-- ⚠️  PARA BORRAR TODO Y EMPEZAR DE CERO usa schema.reset.sql, que es
--     DESTRUCTIVO. Este fichero NO borra nada a propósito: en un despliegue
--     real contiene el historial electoral, que debe conservarse.
-- ============================================================================

-- 1. Tabla de procesos electorales / votaciones (gestionada desde /admin)
CREATE TABLE IF NOT EXISTS elecciones (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    -- Opciones válidas en formato JSON array, ej: '["Candidatura A","Candidatura B","Voto en Blanco"]'
    opciones_json TEXT NOT NULL,
    -- Censo requerido:
    --   'solo_socios' -> exige ser miembro de pleno derecho según OAuth (es_socio / pleno_derecho)
    --   'registrados' -> permite votar a cualquier usuario verificado en el OAuth (ej. toda la escuela)
    censo_tipo TEXT NOT NULL DEFAULT 'solo_socios' CHECK (censo_tipo IN ('solo_socios', 'registrados')),
    -- Si los votos con verificación estándar (1 cuenta) valen la mitad o igual que los de doble cuenta
    ponderar_no_verificados INTEGER NOT NULL DEFAULT 1 CHECK (ponderar_no_verificados IN (0, 1)),
    -- Estado de la urna: 'abierta' o 'cerrada'
    estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
    fecha_inicio INTEGER NOT NULL,
    fecha_fin INTEGER,
    creada_por TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- 2. La Urna Electoral Anónima con Cadena Criptográfica (Hash-Chain / Blockchain ligero)
-- GARANTÍA DE ANONIMATO (MINIMIZACIÓN DE DATOS + RGPD):
-- En esta tabla JAMÁS se guarda el correo, ni el nombre, ni el ID de usuario (sub).
-- Solo entra el voto anónimo, su nivel de fiabilidad ('muy_fiable' si tiene las 2 cuentas
-- Google ESD + EducaMadrid vinculadas, u 'ordinario' si solo tiene 1), el ticket de
-- verificación y el eslabón criptográfico SHA-256 (prev_hash -> block_hash) + firma digital.
CREATE TABLE IF NOT EXISTS urna (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eleccion_id TEXT NOT NULL DEFAULT 'general',
    opcion TEXT NOT NULL,
    fiabilidad TEXT NOT NULL DEFAULT 'ordinario' CHECK (fiabilidad IN ('muy_fiable', 'ordinario')),
    ticket_verificacion TEXT NOT NULL UNIQUE,
    timestamp INTEGER NOT NULL,
    prev_hash TEXT NOT NULL,
    block_hash TEXT NOT NULL UNIQUE,
    signature TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_urna_eleccion_time ON urna (eleccion_id, id ASC);

-- 1.b. Padrón de participación (fuente de verdad ATÓMICA del «un voto por elector»).
--
-- La clave primaria compuesta (eleccion_id, votante_hash) hace que un INSERT
-- sobre un elector que ya votó no inserte nada: es la barrera de integridad real.
-- `votante_hash` es un SHA-256 cegado con el SECRET_SALT, irreversible, por lo que
-- esta tabla NO contiene datos personales (RGPD Art. 5.1.c: minimización).
CREATE TABLE IF NOT EXISTS padron (
    eleccion_id TEXT NOT NULL,
    votante_hash TEXT NOT NULL,
    creado_en INTEGER NOT NULL,
    PRIMARY KEY (eleccion_id, votante_hash)
);

CREATE INDEX IF NOT EXISTS idx_padron_creado ON padron (creado_en);

-- 3. Bitácora de acciones de administración.
-- Cada alta, edición, cierre o eliminación de una votación queda registrada con
-- su actor, para que el historial de la urna sea auditable también en su
-- vertiente de gobernanza (quién tocó qué y cuándo).
CREATE TABLE IF NOT EXISTS admin_acciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eleccion_id TEXT,
    accion TEXT NOT NULL,
    actor TEXT NOT NULL,
    detalle TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_acciones_eleccion ON admin_acciones (eleccion_id, id ASC);
