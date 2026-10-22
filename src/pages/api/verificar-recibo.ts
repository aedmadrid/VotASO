import type { APIRoute } from "astro";
import { getBindings, getConfig } from "../../lib/config";
import { computeVoteBlockHash, signVoteReceipt, timingSafeEqualHex } from "../../lib/crypto";
import { ensureSchema } from "../../lib/urna";
import { consumirCuota, obtenerIp } from "../../lib/ratelimit";

export const POST: APIRoute = async ({ request }) => {
  try {
    const cfg = getConfig();
    const { PADRON_KV, URNA_D1 } = getBindings();

    // Límite por IP: el verificador es público y sin sesión, así que sin este
    // control podría usarse para enumerar papeletas o saturar la base de datos.
    const limite = await consumirCuota(
      PADRON_KV,
      "verificar",
      obtenerIp(request),
      30,
      60,
    );
    if (!limite.permitido) {
      return new Response(
        JSON.stringify({
          error:
            "Demasiadas consultas en poco tiempo. Espera un minuto antes de volver a intentarlo.",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }

    const receipt = await request.json();

    const eleccionId = String(receipt.eleccion_id || "general");
    const fiabilidad = receipt.fiabilidad === "muy_fiable" ? "muy_fiable" : "ordinario";

    const expectedBlockHash = await computeVoteBlockHash({
      prev_hash: String(receipt.prev_hash || ""),
      eleccion_id: eleccionId,
      opcion: String(receipt.opcion || ""),
      fiabilidad,
      ticket_verificacion: String(receipt.ticket || ""),
      timestamp: Number(receipt.timestamp || 0),
    });

    const expectedSig = await signVoteReceipt(
      cfg.secretSalt,
      expectedBlockHash,
      String(receipt.ticket || ""),
      eleccionId,
      String(receipt.opcion || ""),
      fiabilidad,
      Number(receipt.timestamp || 0),
    );

    const firmaValida =
      timingSafeEqualHex(expectedBlockHash, String(receipt.block_hash || "")) &&
      timingSafeEqualHex(expectedSig, String(receipt.signature || ""));

    await ensureSchema(URNA_D1);
    const { results } = await URNA_D1.prepare(
      "SELECT id, opcion, fiabilidad, block_hash FROM urna WHERE ticket_verificacion = ? LIMIT 1",
    )
      .bind(String(receipt.ticket || ""))
      .all();
    const enUrna = results?.[0] || null;

    return new Response(
      JSON.stringify({
        valido_criptograficamente: firmaValida,
        presente_en_urna: Boolean(
          enUrna && timingSafeEqualHex(String(enUrna.block_hash || ""), String(receipt.block_hash || "")),
        ),
        registro_urna: enUrna,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch {
    return new Response(JSON.stringify({ error: "Recibo mal formado." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
};
