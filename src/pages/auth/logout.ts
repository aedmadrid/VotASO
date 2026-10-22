import type { APIRoute } from "astro";
import {
  nombreCookieEstado,
  nombreCookieSesion,
  SESSION_COOKIE,
  SESSION_COOKIE_INSEGURO,
} from "../../lib/session";

/**
 * Cierra la sesión.
 *
 * Se exportan GET y POST: el enlace «SALIR» de la portada es un `<a href>`,
 * que resuelve con GET. Con solo POST, el enlace devolvía un método no
 * permitido y la sesión no se cerraba.
 */
const cerrarSesion: APIRoute = async ({ url }) => {
    const isSecure = url.protocol === "https:";
    const secure = isSecure ? "; Secure" : "";
    const cabeceras = new Headers();
    cabeceras.set("Location", "/");
    // Se borran las dos variantes del nombre: la de producción y la de desarrollo.
    for (const nombre of [nombreCookieSesion(isSecure), SESSION_COOKIE, SESSION_COOKIE_INSEGURO]) {
        cabeceras.append(
            "Set-Cookie",
            `${nombre}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
        );
    }
    for (const nombre of [nombreCookieEstado(isSecure), "votaso_oauth"]) {
        cabeceras.append(
            "Set-Cookie",
            `${nombre}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
        );
    }
    return new Response(null, { status: 302, headers: cabeceras });
};

export const GET = cerrarSesion;
export const POST = cerrarSesion;
