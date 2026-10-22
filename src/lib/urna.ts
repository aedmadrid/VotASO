/**
 * urna.ts — Lógica nuclear de VotASO (Barrera de participación, Anonimato y Hash-Chain).
 *
 * Toda la lógica electoral crítica está concentrada en este módulo TypeScript
 * para que cualquier votante o auditor pueda inspeccionarla en menos de 5 minutos.
 */
import {
  GENESIS_HASH,
  buildPadronKey,
  computeVoteBlockHash,
  sha256Hex,
  signVoteReceipt,
} from "./crypto";
import type { VotasoConfig } from "./config";
import { censusSociosDisponible } from "./config";
import type { D1DatabaseBinding, KVNamespaceBinding, VoterIdentity } from "../env";

export interface EleccionRow {
  id: string;
  titulo: string;
  descripcion: string;
  opciones_json: string;
  censo_tipo: "solo_socios" | "registrados";
  ponderar_no_verificados?: number | boolean;
  estado: "abierta" | "cerrada";
  fecha_inicio: number;
  fecha_fin: number | null;
  creada_por: string;
  created_at: number;
}

export interface UrnaRow {
  id: number;
  eleccion_id: string;
  opcion: string;
  fiabilidad: "muy_fiable" | "ordinario";
  ticket_verificacion: string;
  timestamp: number;
  prev_hash: string;
  block_hash: string;
  signature: string;
}

export async function ensureSchema(db: D1DatabaseBinding | undefined): Promise<void> {
  if (!db || typeof db.prepare !== "function") return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS elecciones (
          id TEXT PRIMARY KEY,
          titulo TEXT NOT NULL,
          descripcion TEXT NOT NULL DEFAULT '',
          opciones_json TEXT NOT NULL,
          censo_tipo TEXT NOT NULL DEFAULT 'solo_socios',
          ponderar_no_verificados INTEGER NOT NULL DEFAULT 1,
          estado TEXT NOT NULL DEFAULT 'abierta',
          fecha_inicio INTEGER NOT NULL,
          fecha_fin INTEGER,
          creada_por TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
      )
      .run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS urna (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          eleccion_id TEXT NOT NULL DEFAULT 'general',
          opcion TEXT NOT NULL,
          fiabilidad TEXT NOT NULL DEFAULT 'ordinario',
          ticket_verificacion TEXT NOT NULL UNIQUE,
          timestamp INTEGER NOT NULL,
          prev_hash TEXT NOT NULL DEFAULT '${GENESIS_HASH}',
          block_hash TEXT NOT NULL DEFAULT '',
          signature TEXT NOT NULL DEFAULT ''
        )`,
      )
      .run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS padron (
          eleccion_id TEXT NOT NULL,
          votante_hash TEXT NOT NULL,
          creado_en INTEGER NOT NULL,
          PRIMARY KEY (eleccion_id, votante_hash)
        )`,
      )
      .run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS admin_acciones (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          eleccion_id TEXT,
          accion TEXT NOT NULL,
          actor TEXT NOT NULL,
          detalle TEXT,
          created_at INTEGER NOT NULL
        )`,
      )
      .run();
  } catch {
    /* Esquema ya inicializado */
  }
}

/**
 * Registra la participación de un elector en la tabla `padron` de D1.
 *
 * La clave primaria compuesta `(eleccion_id, votante_hash)` hace que el
 * `INSERT` sea ATÓMICO: si ese elector ya votó en esa votación, la operación
 * no inserta nada y se detecta en `meta.changes`. Es la garantía real de
 * «un voto por elector»: a diferencia de un `get`+`put` sobre KV, no existe
 * ventana de carrera entre dos peticiones simultáneas del mismo elector.
 *
 * Devuelve `true` si el elector queda registrado, `false` si ya había votado.
 */
export async function registrarEnPadron(
  db: D1DatabaseBinding | undefined,
  eleccionId: string,
  votanteHash: string,
): Promise<boolean> {
  if (!db) return true;
  try {
    const result = await db
      .prepare(
        "INSERT INTO padron (eleccion_id, votante_hash, creado_en) VALUES (?, ?, ?) " +
          "ON CONFLICT (eleccion_id, votante_hash) DO NOTHING",
      )
      .bind(eleccionId, votanteHash, Date.now())
      .run();
    // `changes === 0` significa que la fila ya existía: el elector ya había voted.
    return Number(result?.meta?.changes ?? 1) > 0;
  } catch {
    return false;
  }
}

/**
 * Indica si un elector ya consta como participante en la votación.
 */
export async function yaVotoEnPadron(
  db: D1DatabaseBinding | undefined,
  eleccionId: string,
  votanteHash: string,
): Promise<boolean> {
  if (!db) return false;
  try {
    const { results } = await db
      .prepare("SELECT COUNT(*) AS n FROM padron WHERE eleccion_id = ? AND votante_hash = ?")
      .bind(eleccionId, votanteHash)
      .all<{ n: number }>();
    return Number(results?.[0]?.n || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Devuelve la configuración de censo y ponderación de cada votación, indexado por `eleccion_id`.
 */
export async function obtenerConfiguracionPorEleccion(
  db: D1DatabaseBinding | undefined,
): Promise<Record<string, { censo_tipo: string; ponderar: boolean }>> {
  const out: Record<string, { censo_tipo: string; ponderar: boolean }> = {};
  if (!db) return out;
  try {
    const { results } = await db
      .prepare("SELECT id, censo_tipo, ponderar_no_verificados FROM elecciones")
      .all<{ id: string; censo_tipo: string; ponderar_no_verificados?: number | boolean }>();
    for (const el of results || []) {
      const ponderar =
        el.ponderar_no_verificados === undefined ||
        el.ponderar_no_verificados === null ||
        el.ponderar_no_verificados === 1 ||
        el.ponderar_no_verificados === true ||
        String(el.ponderar_no_verificados) === "1";
      out[el.id] = { censo_tipo: el.censo_tipo, ponderar };
    }
  } catch {
    /* Fallback si la columna aún no existiera */
  }
  return out;
}

/**
 * Devuelve el tipo de censo de cada votación, indexado por `eleccion_id`.
 */
export async function obtenerCensoPorEleccion(
  db: D1DatabaseBinding | undefined,
): Promise<Record<string, string>> {
  const conf = await obtenerConfiguracionPorEleccion(db);
  const out: Record<string, string> = {};
  for (const [id, c] of Object.entries(conf)) {
    out[id] = c.censo_tipo;
  }
  return out;
}

/**
 * Purga las filas del padrón que han superado el plazo de conservación.
 *
 * La barrera de participación vive en D1 (fuente de verdad atómica) y, a
 * diferencia de KV, D1 no tiene caducidad automática. Sin esta limpieza, la
 * tabla crecería indefinidamente y conservaría rastros de participación más
 * allá del plazo declarado, lo que choca con el principio de minimización del
 * RGPD.
 *
 * Solo se purgan las filas de votaciones **cerradas**: mientras una votación
 * está abierta, su padrón es necesario para impedir el doble voto.
 *
 * @returns el número de filas eliminadas.
 */
export async function purgarPadron(
  db: D1DatabaseBinding | undefined,
  ttlSeconds: number,
): Promise<number> {
  if (!db) return 0;
  try {
    const limite = Date.now() - Math.max(86400, ttlSeconds) * 1000;
    const result = await db
      .prepare(
        `DELETE FROM padron
          WHERE creado_en < ?
            AND eleccion_id IN (SELECT id FROM elecciones WHERE estado = 'cerrada')`,
      )
      .bind(limite)
      .run();
    return Number(result?.meta?.changes ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Registra una acción de administración en la bitácora `admin_acciones`.
 */
export async function registrarAccionAdmin(
  db: D1DatabaseBinding | undefined,
  datos: { eleccionId?: string | null; accion: string; actor: string; detalle?: string },
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        "INSERT INTO admin_acciones (eleccion_id, accion, actor, detalle, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(
        datos.eleccionId || null,
        datos.accion,
        datos.actor,
        datos.detalle || null,
        Date.now(),
      )
      .run();
  } catch {
    /* La bitácora es best-effort: no debe impedir la acción administrativa. */
  }
}

export async function listarElecciones(db: D1DatabaseBinding | undefined): Promise<EleccionRow[]> {
  if (!db) return [];
  await ensureSchema(db);
  try {
    const { results } = await db
      .prepare("SELECT * FROM elecciones ORDER BY created_at DESC")
      .all<EleccionRow>();
    return results || [];
  } catch {
    return [];
  }
}

/**
 * Procesa la emisión de un voto aplicando:
 *   1. Verificación de pertenencia al censo (`solo_socios` vs `registrados`).
 *   2. Barrera de Integridad Atómica en `PADRON_KV` (imposible votar 2 veces).
 *   3. Ruptura total del vínculo de identidad (el correo/sub jamás entra en `URNA_D1`).
 *   4. Eslabón Hash-Chain (`prev_hash` -> `block_hash`) + Recibo firmado P2P.
 */
export async function procesarVoto(params: {
  voter: VoterIdentity | null;
  eleccionId: string;
  opcionSeleccionada: string;
  cfg: VotasoConfig;
  PADRON_KV: KVNamespaceBinding;
  URNA_D1: D1DatabaseBinding;
}): Promise<{ status: number; body: Record<string, any> }> {
  const { voter, eleccionId, opcionSeleccionada, cfg, PADRON_KV, URNA_D1 } = params;

  if (!voter || (!voter.email && !voter.sub)) {
    return {
      status: 403,
      body: { error: "No autorizado: Debes iniciar sesión con el correo institucional." },
    };
  }

  await ensureSchema(URNA_D1);

  let opcionesValidas = ["Candidato A", "Candidato B", "Voto en Blanco"];
  let censoTipo: "solo_socios" | "registrados" = "registrados";
  let eleccionRow: EleccionRow | null = null;

  try {
    const { results } = await URNA_D1.prepare("SELECT * FROM elecciones WHERE id = ? LIMIT 1")
      .bind(eleccionId)
      .all<EleccionRow>();
    eleccionRow = results?.[0] || null;
  } catch {
    eleccionRow = null;
  }

  if (eleccionRow) {
    if (eleccionRow.estado !== "abierta") {
      return {
        status: 400,
        body: { error: "Esta votación ya está cerrada y no admite nuevas papeletas." },
      };
    }
    if (eleccionRow.fecha_fin && Date.now() > Number(eleccionRow.fecha_fin)) {
      return {
        status: 400,
        body: { error: "El plazo de esta votación ha finalizado." },
      };
    }
    opcionesValidas = JSON.parse(eleccionRow.opciones_json);
    censoTipo = eleccionRow.censo_tipo;
  }

  // Censo efectivo. Si el proveedor OAuth no distingue socios, el censo
  // `solo_socios` no es sostenible: todos los votos quedarían rechazados. Se
  // degrada a `registrados` en lugar de dejar la votación vacía sin explicación.
  const censoEfectivo =
    censoTipo === "solo_socios" && !censusSociosDisponible(cfg, voter.tieneClaimsDePertenencia)
      ? "registrados"
      : censoTipo;

  if (censoEfectivo === "solo_socios" && !voter.esSocio) {
    return {
      status: 403,
      body: {
        error:
          "Esta votación es exclusiva para socios de pleno derecho de la organización. Tu cuenta está verificada como usuario registrado pero no figura como socio activo.",
      },
    };
  }

  if (!opcionesValidas.includes(opcionSeleccionada)) {
    return {
      status: 400,
      body: { error: "Opción de voto no válida." },
    };
  }

  // --- BARRERA DE INTEGRIDAD (MINIMIZACIÓN DE DATOS + RGPD) ---
  // Usamos `sub` (ID único en OAuth) para que aunque un usuario tenga 2 correos
  // vinculados en VerificASO, su identificador sea único e invariable.
  const uniqueVoterId = voter.sub || voter.email;
  const padronKey = await buildPadronKey(eleccionId, uniqueVoterId, cfg.secretSalt);

  // Comprobación rápida en KV (que además permite el descarte por TTL, RGPD).
  const yaVoto = await PADRON_KV.get(padronKey);
  if (yaVoto !== null) {
    return {
      status: 400,
      body: { error: "Error: Tu voto ya ha sido registrado previamente." },
    };
  }

  // Barrera ATÓMICA en D1: la clave primaria compuesta (eleccion_id, votante_hash)
  // hace que el INSERT falle si el elector ya votó, sin ventana de carrera entre
  // peticiones simultáneas. Esta es la garantía real de «un voto por elector».
  const votanteHash = await sha256Hex(`votante:v1:${eleccionId}:${uniqueVoterId}:${cfg.secretSalt}`);
  const registrado = await registrarEnPadron(URNA_D1, eleccionId, votanteHash);
  if (!registrado) {
    return {
      status: 400,
      body: { error: "Error: Tu voto ya ha sido registrado previamente." },
    };
  }

  // Reflejo del registro en KV para el descarte automático por TTL.
  await PADRON_KV.put(padronKey, "VOTÓ", { expirationTtl: cfg.padronTtlSeconds });
  // ---------------------------------------------------------------

  // --- ROMPER EL VÍNCULO DE IDENTIDAD (ANONIMATO) + CADENA CRIPTOGRÁFICA ---
  const uuidAleatorio = crypto.randomUUID();
  const ticketHash = await sha256Hex(`${uuidAleatorio}|${cfg.secretSalt}`);
  const ticketAuditoria = ticketHash.substring(0, 16);
  const timestamp = Date.now();
  const fiabilidad: "muy_fiable" | "ordinario" =
    voter.fiabilidad === "muy_fiable" ? "muy_fiable" : "ordinario";

  // Encadenamiento optimista con reintento: se calcula el eslabón sobre la
  // cabeza vigente y, justo antes de insertar, se revalida que la cabeza no
  // haya cambiado. Si otro elector votó en paralelo, se recalcula y se reintenta.
  // Sin esta revalidación, dos votos simultáneos partirían de la misma cabeza
  // y bifurcarían la cadena (la auditoría lo detectaría como `cadena_integra: false`).
  const MAX_INTENTOS = 5;
  let blockHash = "";
  let prevHash = GENESIS_HASH;
  let signature = "";

  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    try {
      const lastBlockRes = await URNA_D1.prepare(
        "SELECT block_hash FROM urna WHERE eleccion_id = ? ORDER BY id DESC LIMIT 1",
      )
        .bind(eleccionId)
        .all<{ block_hash: string }>();
      if (lastBlockRes?.results?.[0]?.block_hash) {
        prevHash = lastBlockRes.results[0].block_hash;
      } else {
        prevHash = GENESIS_HASH;
      }
    } catch {
      prevHash = GENESIS_HASH;
    }

    blockHash = await computeVoteBlockHash({
      prev_hash: prevHash,
      eleccion_id: eleccionId,
      opcion: opcionSeleccionada,
      fiabilidad,
      ticket_verificacion: ticketAuditoria,
      timestamp,
    });

    signature = await signVoteReceipt(
      cfg.secretSalt,
      blockHash,
      ticketAuditoria,
      eleccionId,
      opcionSeleccionada,
      fiabilidad,
      timestamp,
    );

    // Revalidación: si la cabeza ha cambiado entre la lectura y ahora, el
    // eslabón calculado ya no encadena y hay que repetir el cálculo.
    let cabezaActual = GENESIS_HASH;
    try {
      const recheck = await URNA_D1.prepare(
        "SELECT block_hash FROM urna WHERE eleccion_id = ? ORDER BY id DESC LIMIT 1",
      )
        .bind(eleccionId)
        .all<{ block_hash: string }>();
      cabezaActual = recheck?.results?.[0]?.block_hash || GENESIS_HASH;
    } catch {
      cabezaActual = prevHash;
    }

    if (cabezaActual === prevHash) break;

    if (intento === MAX_INTENTOS - 1) {
      return {
        status: 503,
        body: {
          error:
            "La urna está recibiendo demasiadas papeletas simultáneas. Inténtalo de nuevo en unos segundos.",
        },
      };
    }
  }

  // Guardar el voto en la urna D1 (SQLite) sin asociar jamás el correo ni el ID del elector
  await URNA_D1.prepare(
    "INSERT INTO urna (eleccion_id, opcion, fiabilidad, ticket_verificacion, timestamp, prev_hash, block_hash, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      eleccionId,
      opcionSeleccionada,
      fiabilidad,
      ticketAuditoria,
      timestamp,
      prevHash,
      blockHash,
      signature,
    )
    .run();

  return {
    status: 200,
    body: {
      success: true,
      ticket: ticketAuditoria,
      eleccion_id: eleccionId,
      opcion: opcionSeleccionada,
      fiabilidad,
      timestamp,
      prev_hash: prevHash,
      block_hash: blockHash,
      signature,
      mensaje: !cfg.enableDoubleVerification
        ? "Voto depositado de forma anónima. Guarda tu ticket para auditar el escrutinio final."
        : fiabilidad === "muy_fiable"
          ? "Voto Muy Fiable (doble cuenta verificada) depositado de forma anónima. Guarda tu ticket para auditar el escrutinio final."
          : `Voto Ordinario depositado de forma anónima. Recuerda que puedes vincular tus dos cuentas en ${cfg.orgProfileUrl} para que tu voto tenga más peso en el escrutinio.`,
    },
  };
}

/**
 * Obtiene los registros de la urna y calcula la verificación de la cadena de bloques
 * y el recuento desglosado (si aplica).
 *
 * El recuento distingue siempre dos magnitudes:
 * - **Papeletas**: número bruto de votos depositados. Es el dato bruto y auditable.
 * - **Puntos**: valor electoral de cada papeleta tras aplicar el peso. Un voto
 *   «muy fiable» (doble cuenta verificada) vale `pesoVotoFiable` y uno
 *   «ordinario» vale `pesoVotoOrdinario`.
 *
 * En las votaciones con censo `solo_socios` NO se pondera: el censo ya está
 * acotado a socios de pleno derecho, así que todos los votos valen lo mismo.
 */
export async function auditarUrna(params: {
  URNA_D1: D1DatabaseBinding;
  cfg: VotasoConfig;
  eleccionId?: string | null;
}) {
  const { URNA_D1, cfg, eleccionId } = params;
  await ensureSchema(URNA_D1);

  const baseSql =
    "SELECT id, eleccion_id, opcion, fiabilidad, ticket_verificacion, timestamp, prev_hash, block_hash, signature FROM urna";
  const stmt = eleccionId
    ? URNA_D1.prepare(`${baseSql} WHERE eleccion_id = ? ORDER BY id ASC`).bind(eleccionId)
    : URNA_D1.prepare(`${baseSql} ORDER BY id ASC`);

  const { results } = await stmt.all<UrnaRow>();
  const rows = results || [];

  // Configuración de censo y ponderación de cada votación
  const configPorEleccion = await obtenerConfiguracionPorEleccion(URNA_D1);

  const conteo: Record<
    string,
    { total: number; muy_fiable: number; ordinario: number; puntos: number }
  > = {};
  let totalMuyFiables = 0;
  let totalOrdinarios = 0;
  let totalPuntos = 0;
  let chainIntact = true;
  const lastHashByElection: Record<string, string> = {};

  for (const r of rows) {
    const elId = r.eleccion_id || "general";
    const expectedPrev = lastHashByElection[elId] || GENESIS_HASH;
    const expectedBlockHash = await computeVoteBlockHash({
      prev_hash: expectedPrev,
      eleccion_id: elId,
      opcion: r.opcion,
      fiabilidad: r.fiabilidad || "ordinario",
      ticket_verificacion: r.ticket_verificacion,
      timestamp: r.timestamp,
    });
    if (r.prev_hash && r.block_hash && (r.prev_hash !== expectedPrev || r.block_hash !== expectedBlockHash)) {
      chainIntact = false;
    }
    lastHashByElection[elId] = r.block_hash || expectedBlockHash;

    if (!conteo[r.opcion]) {
      conteo[r.opcion] = { total: 0, muy_fiable: 0, ordinario: 0, puntos: 0 };
    }
    conteo[r.opcion]!.total += 1;
    if (r.fiabilidad === "muy_fiable") {
      conteo[r.opcion]!.muy_fiable += 1;
      totalMuyFiables += 1;
    } else {
      conteo[r.opcion]!.ordinario += 1;
      totalOrdinarios += 1;
    }

    // Valor electoral de la papeleta. En votaciones de socios no se pondera.
    // Además, se respeta la opción elegida por el administrador al crear la votación.
    const cfgEleccion = configPorEleccion[elId];
    const pondera =
      cfgEleccion?.censo_tipo !== "solo_socios" &&
      cfgEleccion?.ponderar !== false;
    const peso = pondera
      ? r.fiabilidad === "muy_fiable"
        ? cfg.pesoVotoFiable
        : cfg.pesoVotoOrdinario
      : 1;
    conteo[r.opcion]!.puntos = redondearPuntos(conteo[r.opcion]!.puntos + peso);
    totalPuntos += peso;
  }

  return {
    rows,
    resumen: {
      verificacion_blockchain: {
        cadena_integra: chainIntact,
        genesis_hash: GENESIS_HASH,
        cabezas_por_eleccion: lastHashByElection,
        total_papeletas: rows.length,
        total_puntos: redondearPuntos(totalPuntos),
        ...(cfg.enableDoubleVerification
          ? {
              votos_muy_fiables_doble_cuenta: totalMuyFiables,
              votos_ordinarios_una_cuenta: totalOrdinarios,
            }
          : {}),
      },
      escrutinio: conteo,
      papeletas: rows,
    },
  };
}

/**
 * Redondea un valor de puntos a tres decimales para evitar ruido de coma
 * flotante en el JSON público (p. ej. 1.7999999999999998).
 */
function redondearPuntos(n: number): number {
  return Math.round(n * 1000) / 1000;
}
