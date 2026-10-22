import type { APIRoute } from "astro";
import { censusSociosDisponible, getBindings, getConfig } from "../../../lib/config";
import { resolveAuthenticatedVoter } from "../../../lib/session";
import { ensureSchema, purgarPadron, registrarAccionAdmin } from "../../../lib/urna";
import { consumirCuota, obtenerIp } from "../../../lib/ratelimit";

export const POST: APIRoute = async ({ request }) => {
  const cfg = getConfig();
  const { PADRON_KV, URNA_D1 } = getBindings();
  await ensureSchema(URNA_D1);

  const voter = await resolveAuthenticatedVoter(request, cfg);
  if (!voter || !voter.isAdmin) {
    return new Response(
      JSON.stringify({ error: "No autorizado: Tu correo no figura en ADMIN_EMAILS." }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // Límite por IP para las acciones de administración, que son las de mayor
  // impacto: crear, modificar y borrar votaciones.
  const limite = await consumirCuota(
    PADRON_KV,
    "admin",
    obtenerIp(request),
    60,
    60,
  );
  if (!limite.permitido) {
    return new Response(
      JSON.stringify({
        error:
          "Demasiadas acciones de administración en poco tiempo. Espera un minuto antes de volver a intentarlo.",
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  const actor = voter.email || voter.sub;

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Cuerpo JSON inválido." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const action = body.action || "create";

  if (action === "purgar_padron") {
    // Elimina las marcas de participación de votaciones cerradas que han
    // superado el plazo de conservación. Es la operación de mantenimiento que
    // suple la caducidad automática que KV sí ofrece y D1 no.
    const purgadas = await purgarPadron(URNA_D1, cfg.padronTtlSeconds);
    await registrarAccionAdmin(URNA_D1, {
      eleccionId: null,
      accion: "purgar_padron",
      actor,
      detalle: `Purgadas ${purgadas} marcas de participación caducadas`,
    });
    return new Response(JSON.stringify({ success: true, purgadas }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (action === "toggle_estado") {
    const id = String(body.id || "").trim();
    const nuevoEstado = body.estado === "cerrada" ? "cerrada" : "abierta";
    await URNA_D1.prepare("UPDATE elecciones SET estado = ? WHERE id = ?")
      .bind(nuevoEstado, id)
      .run();
    await registrarAccionAdmin(URNA_D1, {
      eleccionId: id,
      accion: `toggle_estado:${nuevoEstado}`,
      actor,
      detalle: `Votación ${id} pasa a ${nuevoEstado}`,
    });
    return new Response(JSON.stringify({ success: true, id, estado: nuevoEstado }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (action === "delete") {
    const id = String(body.id || "").trim();
    if (!id) {
      return new Response(
        JSON.stringify({ error: "Falta el ID de la votación a eliminar." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    // ⚠️  Esta operación destruye el historial electoral y no es reversible.
    //     Requiere confirmación explícita para evitar un borrado accidental.
    if (body.confirmar !== true) {
      const { results } = await URNA_D1.prepare(
        "SELECT COUNT(*) AS n FROM urna WHERE eleccion_id = ?",
      )
        .bind(id)
        .all<{ n: number }>();
      const papeletas = Number(results?.[0]?.n || 0);
      return new Response(
        JSON.stringify({
          error:
            "Eliminar una votación con papeletas depositadas destruye el historial electoral y no puede deshacerse.",
          requiere_confirmacion: true,
          papeletas,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    // Borra tanto la elección como las papeletas asociadas en la urna
    await URNA_D1.prepare("DELETE FROM urna WHERE eleccion_id = ?").bind(id).run();
    await URNA_D1.prepare("DELETE FROM elecciones WHERE id = ?").bind(id).run();
    await registrarAccionAdmin(URNA_D1, {
      eleccionId: id,
      accion: "delete",
      actor,
      detalle: `Votación ${id} eliminada con sus papeletas`,
    });
    return new Response(JSON.stringify({ success: true, id }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (action === "update_context") {
    const id = String(body.id || "").trim();
    const titulo = String(body.titulo || "").trim();
    const descripcion = String(body.descripcion || "").trim();
    const censoSolicitado = body.censo_tipo === "registrados" ? "registrados" : "solo_socios";
    const puedeSocios = censusSociosDisponible(cfg, voter.tieneClaimsDePertenencia);
    const censoTipo = censoSolicitado === "solo_socios" && !puedeSocios ? "registrados" : censoSolicitado;
    const ponderarNoVerificados =
      body.ponderar_no_verificados === false ||
      body.ponderar_no_verificados === "0" ||
      body.ponderar_no_verificados === 0
        ? 0
        : 1;
    if (!id || !titulo) {
      return new Response(
        JSON.stringify({ error: "El ID y el título de la votación son obligatorios." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    await URNA_D1.prepare(
      "UPDATE elecciones SET titulo = ?, descripcion = ?, censo_tipo = ?, ponderar_no_verificados = ? WHERE id = ?",
    )
      .bind(titulo, descripcion, censoTipo, ponderarNoVerificados, id)
      .run();
    return new Response(JSON.stringify({ success: true, id }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const titulo = String(body.titulo || "").trim();
  const descripcion = String(body.descripcion || "").trim();
  const censoSolicitado = body.censo_tipo === "registrados" ? "registrados" : "solo_socios";

  // Si el proveedor OAuth no distingue socios, el censo `solo_socios` no es
  // una opción válida: se degrada a `registrados` en lugar de crear una
  // votación a la que nadie podría participar en silencio.
  const puedeSocios = censusSociosDisponible(cfg, voter.tieneClaimsDePertenencia);
  const censoTipo = censoSolicitado === "solo_socios" && !puedeSocios ? "registrados" : censoSolicitado;

  const opcionesRaw: string[] = Array.isArray(body.opciones)
    ? body.opciones.map((s: unknown) => String(s).trim()).filter(Boolean)
    : String(body.opciones || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

  if (!titulo || opcionesRaw.length < 2) {
    return new Response(
      JSON.stringify({ error: "Debes indicar un título y al menos 2 opciones de voto." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const slugBase = titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const id = `${slugBase || "votacion"}-${Date.now().toString(36)}`;
  const now = Date.now();
  const fechaFin = body.fecha_fin ? Number(new Date(body.fecha_fin).getTime()) || null : null;

  const ponderarNoVerificados =
    body.ponderar_no_verificados === false ||
    body.ponderar_no_verificados === "0" ||
    body.ponderar_no_verificados === 0
      ? 0
      : 1;

  await URNA_D1.prepare(
    `INSERT INTO elecciones (id, titulo, descripcion, opciones_json, censo_tipo, ponderar_no_verificados, estado, fecha_inicio, fecha_fin, creada_por, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'abierta', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      titulo,
      descripcion,
      JSON.stringify(opcionesRaw),
      censoTipo,
      ponderarNoVerificados,
      now,
      fechaFin,
      voter.email,
      now,
    )
    .run();

  await registrarAccionAdmin(URNA_D1, {
    eleccionId: id,
    accion: "create",
    actor,
    detalle: `Votación creada: ${titulo} (censo ${censoTipo})`,
  });

  return new Response(JSON.stringify({ success: true, id }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};
