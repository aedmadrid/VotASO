import type { APIRoute } from "astro";
import { getBindings, getConfig } from "../lib/config";
import { auditarUrna } from "../lib/urna";

export const GET: APIRoute = async ({ url }) => {
  const cfg = getConfig();
  const { URNA_D1 } = getBindings();
  const eleccionId = url.searchParams.get("eleccion_id");
  const { rows, resumen } = await auditarUrna({ URNA_D1, cfg, eleccionId });

  const payload = url.searchParams.get("resumen") === "1" ? resumen : rows;

  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
