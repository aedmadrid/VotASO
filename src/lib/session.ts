/**
 * session.ts — Sesiones OAuth2 firmadas con HMAC-SHA256 y resolución de identidad.
 */
import { base64UrlEncode, hmacSha256Hex, timingSafeEqual } from "./crypto";
import { normalizeVoterIdentity, type VotasoConfig } from "./config";
import type { VoterIdentity } from "../env";

export const SESSION_COOKIE = "__Host-votaso_session";
export const OAUTH_STATE_COOKIE = "__Host-votaso_oauth";

/**
 * Nombres alternativos sin el prefijo `__Host-`.
 *
 * El prefijo `__Host-` obliga a que la cookie sea `Secure`, tenga `Path=/` y
 * no lleve `Domain`, lo que impide que un subdominio comprometido inyecte una
 * cookie con el mismo nombre (*cookie tossing*). En desarrollo sobre HTTP sin
 * TLS el navegador rechazaría esas cookies, así que se usan estos nombres
 * alternativos únicamente cuando la conexión no es segura.
 */
export const SESSION_COOKIE_INSEGURO = "votaso_session";
export const OAUTH_STATE_COOKIE_INSEGURO = "votaso_oauth";

/**
 * Devuelve el nombre de la cookie de sesión adecuado al contexto.
 */
export function nombreCookieSesion(isSecure: boolean): string {
  return isSecure ? SESSION_COOKIE : SESSION_COOKIE_INSEGURO;
}

/**
 * Devuelve el nombre de la cookie de estado OAuth adecuado al contexto.
 */
export function nombreCookieEstado(isSecure: boolean): string {
  return isSecure ? OAUTH_STATE_COOKIE : OAUTH_STATE_COOKIE_INSEGURO;
}

/**
 * Comprueba que una ruta de redirección sea estrictamente interna.
 *
 * Rechaza los redirect abiertos: `//evil.com` y `https://evil.com` empiezan
 * por `/` o son URL absolutas, y el navegador los navegaría fuera del sitio.
 */
export function isSafeInternalPath(path: string): boolean {
  if (typeof path !== "string") return false;
  if (!path.startsWith("/")) return false;
  // `//` o `/\` son URLs protocol-relativas: apuntan a otro host.
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  // Cualquier barra invertida puede ser interpretada como separador por el navegador.
  if (path.includes("\\")) return false;
  // Caracteres de control (incluye \r y \n, que permitirían inyectar cabeceras).
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return true;
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function createSignedToken(
  payloadObj: Record<string, any>,
  secretSalt: string,
  ttlSeconds = 7200,
): Promise<string> {
  const data = { ...payloadObj, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const jsonStr = JSON.stringify(data);
  const b64 = base64UrlEncode(new TextEncoder().encode(jsonStr));
  const sig = await hmacSha256Hex(secretSalt, b64);
  return `${b64}.${sig}`;
}

export async function verifySignedToken<T = Record<string, any>>(
  token: string | undefined | null,
  secretSalt: string,
): Promise<(T & { exp: number }) | null> {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  const expectedSig = await hmacSha256Hex(secretSalt, b64);
  if (!timingSafeEqual(sig, expectedSig)) return null;
  try {
    const pad = b64.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + "===".slice((pad.length + 3) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resuelve el votante autenticado desde:
 *   1) La cookie de sesión firmada (`votaso_session`), o
 *   2) Cabeceras inyectadas por un middleware OAuth externo (`X-User-Email`),
 *      para despliegues detrás de Cloudflare Access.
 *
 * ⚠️  La ruta (2) es una vía de suplantación si el Worker es publicly accesible:
 *     cualquier cliente puede enviar `X-User-Email: admin@...` y suplantar a un
 *     administrador. Por eso SOLO se activa de forma explícita con
 *     `TRUST_IDENTITY_HEADERS=true` y, si se define `IDENTITY_HEADERS_SECRET`,
 *     exige además que la cabecera `X-Identity-Secret` coincida con ella.
 *     En el despliegue por defecto (OAuth propio) la vía está desactivada.
 */
export async function resolveAuthenticatedVoter(
  request: Request,
  cfg: VotasoConfig,
): Promise<VoterIdentity | null> {
  const cookies = parseCookies(request);
  // Se aceptan ambos nombres: el prefijo `__Host-` en producción y el simple
  // en desarrollo. Si ambos estuvieran presentes, manda el prefijo seguro.
  const tokenSesion =
    cookies[SESSION_COOKIE] || cookies[SESSION_COOKIE_INSEGURO];
  if (tokenSesion) {
    const session = await verifySignedToken<{ voter: VoterIdentity }>(
      tokenSesion,
      cfg.secretSalt,
    );
    if (session?.voter) return session.voter;
  }

  if (!cfg.trustIdentityHeaders) return null;

  const headerEmail = request.headers.get("X-User-Email")?.trim().toLowerCase();
  if (!headerEmail) return null;

  // Si hay secreto configurado, la cabecera debe presentarlo: sin esto,
  // cualquier cliente podría inyectar `X-User-Email` y suplantar a un admin.
  if (cfg.identityHeadersSecret) {
    const presented = request.headers.get("X-Identity-Secret")?.trim() || "";
    if (!timingSafeEqual(presented, cfg.identityHeadersSecret)) return null;
  }

  if (cfg.allowedEmailDomain && !dominioCoincide(headerEmail, cfg.allowedEmailDomain)) {
    return null;
  }
  const headerSub = request.headers.get("X-User-Id")?.trim() || headerEmail;
  const headerSocio = request.headers.get("X-User-Socio");
  const headerDouble = request.headers.get("X-User-Double-Verified");
  return normalizeVoterIdentity(
    {
      [cfg.claimId]: headerSub,
      [cfg.claimEmail]: headerEmail,
      // La ausencia de la cabecera NO concede la condición de socio: solo la
      // concede un valor explícito. Antes, `X-User-Socio` ausente implicaba
      // socio, lo que convertía la vía de cabeceras en una escalada de
      // privilegios trivial.
      [cfg.claimIsMember]: headerSocio === "true",
      [cfg.claimDoubleVerified]: headerDouble === "true",
    },
    cfg,
  );
}

/**
 * Comprueba que un correo pertenezca a un dominio.
 *
 * No basta con `endsWith`: `atacante-esdmadrid.es` termina en `esdmadrid.es`
 * y pasaría esa comprobación. El dominio se compara sobre la parte posterior a
 * la última arroba, con normalización de mayúsculas.
 */
export function dominioCoincide(email: string, dominioConfigurado: string): boolean {
  const correo = String(email || "").trim().toLowerCase();
  const arroba = correo.lastIndexOf("@");
  if (arroba < 0) return false;
  const dominioCorreo = correo.slice(arroba + 1);
  // Se admite tanto `esdmadrid.es` como `@esdmadrid.es`.
  const dominio = String(dominioConfigurado || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  if (!dominio) return true;
  return dominioCorreo === dominio;
}
