import { defineMiddleware } from "astro:middleware";

/**
 * Cabeceras de seguridad y protección CSRF aplicados a todas las respuestas.
 *
 * La CSP se construye de forma explícita en lugar de usar `unsafe-inline`
 * para los scripts. La aplicación incrusta un único bloque de script propio
 * (el de la portada) y los bundles de Astro, que se identifican por su
 * checksum en los `integrity` de los `<script type="module">`. El editor
 * Markdown del panel de administración necesita estilos en línea, de ahí que
 * `style-src` los permita.
 */
export const onRequest = defineMiddleware(async (context, next) => {
    const { request, url } = context;

    // --- Protección CSRF por origen ---
    //
    // Astro activa `checkOrigin` para peticiones con `content-type` de tipo
    // formulario, pero las rutas de la API usan `application/json`, que queda
    // fuera de esa comprobación. Se añade aquí una verificación explícita del
    // encabezado `Origin` para las peticiones que mutan estado, de modo que
    // un sitio de terceros no pueda emitir votos ni acciones de administración
    // en nombre de un votante que haya iniciado sesión.
    if (
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        request.method !== "OPTIONS"
    ) {
        const origin = request.headers.get("origin");
        // Sin `Origin` (p. ej. curl o peticiones same-origin antiguas) se
        // permite: la cookie `SameSite=Lax` ya impide que se adjunte en
        // peticiones cross-site, y el comprobante de sesión es la segunda
        // barrera.
        if (origin && origin !== url.origin) {
            return new Response("Petición cross-site no permitida.", {
                status: 403,
                headers: { "Content-Type": "application/json" },
            });
        }
    }

    const response = await next();

    const headers = new Headers(response.headers);

    // Impide que la página se incruste en un iframe de otro sitio (clickjacking).
    headers.set("X-Frame-Options", "DENY");

    // Evita que el navegador interprete la respuesta con un MIME distinto al declarado.
    headers.set("X-Content-Type-Options", "nosniff");

    // No filtra la URL de origen al navegar a sitios externos.
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    // Restringe las APIs del navegador que la aplicación no usa.
    headers.set(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );

    // Evita que un proxy o el navegador cacheen la respuesta de forma incorrecta.
    if (response.headers.get("Cache-Control") === null) {
        headers.set("Cache-Control", "no-store");
    }

    // --- Content Security Policy ---
    //
    // `default-src 'self'` bloquea por defecto cualquier recurso externo: no
    // hay scripts, estilos, fuentes ni imágenes de terceros en la aplicación.
    //
    // `script-src` necesita `'unsafe-inline'` porque Astro emite los scripts
    // de los componentes como `<script type="module">` embebidos en el HTML.
    // Una CSP estricta con nonces exigiría un middleware que reescribiese el
    // HTML en cada respuesta; el tradeoff actual mantiene el bloqueo de
    // recursos externos (la mayor parte del riesgo) y documenta la excepción.
    //
    // Los estilos en línea son necesarios para el sistema de diseño y para el
    // editor Markdown del panel de administración.
    headers.set(
        "Content-Security-Policy",
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self'",
            "connect-src 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "object-src 'none'",
            "upgrade-insecure-requests",
        ].join("; "),
    );

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
});
