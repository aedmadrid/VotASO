import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  output: "server",
  // React SOLO para el editor Markdown del contexto de la votación en /admin (MDXEditor, igual que en VerificASO).
  integrations: [react()],
  security: {
    // Verificación de origen (protección CSRF) para peticiones POST/PUT/DELETE/PATCH.
    // Las rutas de la API usan `application/json`, así que no les afecta; protege
    // frente a formularios cross-site enviados contra rutas que sí acepten
    // `application/x-www-form-urlencoded`.
    checkOrigin: true,
  },
  vite: {
    ssr: {
      optimizeDeps: {
        // `picomatch` es una dependencia transitiva de Astro; se incluye para
        // que el SSR de Vite la pre-resuelva en entornos lentos.
        include: ["picomatch"],
      },
    },
  },
  adapter: cloudflare({
    sessionKVBindingName: "PADRON_KV",
    imageService: "passthrough",
    platformProxy: {
      enabled: true,
    },
  }),
});
