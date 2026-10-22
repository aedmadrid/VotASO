/**
 * crypto.ts — Primitivas criptográficas puras usando Web Crypto API nativa.
 *
 * Incluye:
 *   - SHA-256 (para tickets de verificación, cegado de padrón y cadena de bloques)
 *   - HMAC-SHA256 (para cookies de sesión sin estado y firma de recibos P2P)
 *   - PKCE S256 (para el flujo OAuth 2.0)
 *   - Hash-Chain de bloques de la urna (`computeVoteBlockHash`)
 */

export const GENESIS_HASH = "0".repeat(64);

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(String(input));
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(String(message)));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Comparación en tiempo constante de dos cadenas hexadecimales.
 *
 * Se usa para validar firmas HMAC: un `===` normal filtra información por
 * tiempo de ejecución y permite reconstruir el valor esperado byte a byte.
 * La longitud se compara aparte (las firmas siempre tienen la misma longitud,
 * así que no filtra información útil).
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Comparación en tiempo constante de dos cadenas de cualquier longitud.
 *
 * A diferencia de `timingSafeEqualHex`, no asume que la entrada sea hexadecimal
 * y no filtra la longitud: recorre siempre el máximo de ambas longitudes.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function pkceChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export interface VoteBlockInput {
  prev_hash: string;
  eleccion_id: string;
  opcion: string;
  fiabilidad: "muy_fiable" | "ordinario";
  ticket_verificacion: string;
  timestamp: number;
}

/**
 * Calcula el hash inmutable de un bloque de la urna (Eslabón Hash-Chain).
 * Cualquier auditor puede recalcular `SHA-256(prev_hash|eleccion_id|opcion|fiabilidad|ticket|timestamp)`
 * sobre el JSON de `/auditoria-publica` y comprobar que ningún voto fue alterado ni eliminado.
 */
export async function computeVoteBlockHash(block: VoteBlockInput): Promise<string> {
  const canonical = `${block.prev_hash}|${block.eleccion_id}|${block.opcion}|${block.fiabilidad}|${block.ticket_verificacion}|${block.timestamp}`;
  return sha256Hex(canonical);
}

/**
 * Genera la firma del recibo criptográfico P2P emitido por la urna.
 */
export async function signVoteReceipt(
  secretSalt: string,
  blockHash: string,
  ticket: string,
  eleccionId: string,
  opcion: string,
  fiabilidad: "muy_fiable" | "ordinario",
  timestamp: number,
): Promise<string> {
  const payload = `RECEIPT_V1|${eleccionId}|${ticket}|${opcion}|${fiabilidad}|${timestamp}|${blockHash}`;
  return hmacSha256Hex(secretSalt, payload);
}

/**
 * Clave cegada e irreversible en el padrón KV (Cumplimiento RGPD Art. 5.1.c: minimización de datos).
 *
 * El identificador NO se normaliza a minúsculas: el `sub` de OAuth es opaco y
 * sensible a mayúsculas según la especificación, así que `AbC` y `abc` son
 * dos ELECTORES distintos y deben generar claves distintas. Los correos ya
 * llegan normalizados desde `normalizeVoterIdentity`.
 */
export async function buildPadronKey(
  eleccionId: string,
  voterIdentifier: string,
  secretSalt: string,
): Promise<string> {
  const blindedHash = await sha256Hex(
    `padron:v1:${eleccionId}:${String(voterIdentifier).trim()}:${secretSalt}`,
  );
  return `voto:${eleccionId}:${blindedHash}`;
}
