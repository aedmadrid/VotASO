import type { APIRoute } from "astro";
import { getBindings, getConfig } from "../lib/config";
import { resolveAuthenticatedVoter } from "../lib/session";
import { procesarVoto } from "../lib/urna";
import { consumirCuota, obtenerIp } from "../lib/ratelimit";

export const POST: APIRoute = async ({ request }) => {
  try {
    const cfg = getConfig();
    const { PADRON_KV, URNA_D1 } = getBindings();
    const voter = await resolveAuthenticatedVoter(request, cfg);

    // Límite por IP: un elector legítimo vota una vez por votación, así que
    // un cupo amplio no molesta, pero frena el envío automatizado.
    const limite = await consumirCuota(
      PADRON_KV,
      "votar",
      obtenerIp(request),
      30,
      60,
    );
    if (!limite.permitido) {
      return new Response(
        JSON.stringify({
          error:
            "Demasiadas peticiones en poco tiempo. Espera un minuto antes de volver a intentarlo.",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: { eleccionId?: string; opcionSeleccionada?: string };
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Cuerpo JSON inválido." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const eleccionId = String(body.eleccionId || "general").trim();
    const opcionSeleccionada = String(body.opcionSeleccionada || "").trim();

    const result = await procesarVoto({
      voter,
      eleccionId,
      opcionSeleccionada,
      cfg,
      PADRON_KV,
      URNA_D1,
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    // No se filtran detalles internos al cliente: el mensaje de error puede
    // contener nombres de tablas, consultas o rutas del servidor.
    console.error("[votar] Error interno:", err);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
