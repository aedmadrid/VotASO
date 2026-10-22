/**
 * Declaraciones de módulos virtuales del runtime de Cloudflare Workers.
 *
 * `cloudflare:workers` no es un paquete de npm: lo proporciona el runtime en
 * tiempo de ejecución. Sin esta declaración, el typecheck no puede resolver
 * el import de `src/lib/config.ts`.
 *
 * Este fichero NO debe contener `export`: un `.d.ts` con exports se trata
 * como módulo y sus declaraciones no son globales.
 */
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
  export const caches: unknown;
  export const cf: unknown;
}
