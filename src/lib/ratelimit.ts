/**
 * ratelimit.ts — Limitación de peticiones por IP.
 *
 * Objetivo: frenar el abuso automatizado (scripts de fuerza bruta contra el
 * verificador de recibos, spam de votos) sin molestar al elector legítimo,
 * que emite un único voto por votación.
 *
 * La implementación usa una ventana fija en KV: la clave incluye la IP y el
 * bucket temporal, y el valor es el contador. No es atómica (KV es
 * eventualmente consistente), por lo que sirve como **disuasivo**, no como
 * garantía estricta. Para un límite duro, la recomendación es una regla de
 * WAF en el borde de Cloudflare.
 */
import type { KVNamespaceBinding } from "../env";

export interface ResultadoLimite {
    permitido: boolean;
    restantes: number;
}

/**
 * Comprueba y consume una unidad del cupo de la IP.
 *
 * @param kv       Namespace KV donde se guarda el contador.
 * @param clave    Identificador de la acción (p. ej. "votar", "verificar").
 * @param ip       Dirección IP del cliente.
 * @param maximo   Peticiones permitidas por ventana.
 * @param ventana  Duración de la ventana en segundos.
 */
export async function consumirCuota(
    kv: KVNamespaceBinding | undefined,
    clave: string,
    ip: string,
    maximo: number,
    ventana: number,
): Promise<ResultadoLimite> {
    if (!kv || maximo <= 0) {
        return { permitido: true, restantes: maximo };
    }

    // Se aplica un hash al par clave+IP para no almacenar IPs en claro en KV
    // (minimización de datos) y para no depender de que la IP sea válida como
    // parte de una clave de KV.
    const sufijo = await hashHex(`${clave}:${ip}`);
    const bucket = Math.floor(Date.now() / (ventana * 1000));
    const claveKv = `rl:${clave}:${bucket}:${sufijo}`;

    try {
        const actual = await kv.get(claveKv);
        const contador = actual ? Number(actual) : 0;

        if (contador >= maximo) {
            return { permitido: false, restantes: 0 };
        }

        // `expirationTtl` mínimo de KV: 60 segundos. Si la ventana es menor, se
        // conserva la clave un poco más de lo necesario, lo que es inofensivo.
        const ttl = Math.max(60, ventana);
        await kv.put(claveKv, String(contador + 1), { expirationTtl: ttl });

        return { permitido: true, restantes: maximo - contador - 1 };
    } catch {
        // Si KV falla, no se bloquea al elector: se prefiere permitir la
        // petición y perder la detección de abuso antes que impedir votar.
        return { permitido: true, restantes: maximo };
    }
}

/**
 * Extrae la IP del cliente de las cabeceras de Cloudflare.
 */
export function obtenerIp(request: Request): string {
    return (
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "desconocida"
    );
}

/**
 * Hash SHA-256 en hexadecimal (Web Crypto, sin dependencias).
 */
async function hashHex(entrada: string): Promise<string> {
    const datos = new TextEncoder().encode(entrada);
    const buffer = await crypto.subtle.digest("SHA-256", datos);
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
