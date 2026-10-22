# AGENTS.md — VotASO (`votaso.aedm.org.es` / `github.com/aedmadrid/votaso`)

## 1. Arquitectura General

**VotASO** es un software de votación electrónica criptográfica de código abierto construido en **Astro 6 (SSR) + TypeScript** sobre **Cloudflare Workers**, **Cloudflare D1** (`URNA_D1`) y **Cloudflare KV** (`PADRON_KV`).

- **Nombre en Wrangler**: `name = "votaso"` ([`wrangler.toml`](./wrangler.toml)).
- **Estética**: Utiliza el sistema de diseño de [`aedm.astro`](file:///Users/lucaspeinado/Git/aedm.astro) (`--verde: #36e452`, `--negro: #040406`, fuentes `Stick No Bills` y `Schibsted Grotesk`, botones rectangulares sin border-radius y soporte automático para el WebView de `ASO.app` con `?app=1` o User-Agent `ASO.app 2`).
- **100% Agnóstico por Variables de Entorno (`env`)**:
  - Ningún proveedor OAuth ni dominio ni administrador está fijado en el código fuente.
  - Todo se lee en [`src/lib/config.ts`](./src/lib/config.ts) desde `[vars]` de `wrangler.toml` o secretos de Cloudflare.
- **Regla sobre VerificASO y la Doble Verificación**:
  - La distinción entre **Voto Muy Fiable** (2 cuentas vinculadas: Google `@esdmadrid.es` + `@educa.madrid.org`) y **Voto Ordinario** (1 sola cuenta) **SOLO es obligatoria/activa cuando el proveedor OAuth configurado es VerificASO** (`oauthAuthUrl.includes("verificaso")` y `ENABLE_DOUBLE_VERIFICATION_TALLY = "true"`).
  - Si cualquier otra organización despliega VotASO con otro proveedor OAuth, `cfg.enableDoubleVerification` pasa automáticamente a `false`, todos los votos tienen el mismo rango y no se muestran avisos de doble cuenta.
- **Censo adaptable** (`OAUTH_MEMBERSHIP_MODE`): el censo `solo_socios` solo se ofrece si el proveedor OAuth puede sostenerlo. Usa SIEMPRE `censusSociosDisponible(cfg, voter.tieneClaimsDePertenencia)`, nunca compares `censo_tipo` a pelo sin esa comprobación.
- **Recuento ponderado**: el recuento publica dos magnitudes, `total` (papeletas) y `puntos` (valor electoral). El voto ordinario vale la mitad del muy fible por defecto (`VOTO_PESO_ORDINARIO`), y las votaciones de socios **NO se ponderan** porque su censo ya está acotado.
- **Garantías de integridad (ver [`docs/AUDITORIA.md`](./docs/AUDITORIA.md))**:
  - La **barrera de participación** es atómica en D1 (tabla `padron`, clave primaria compuesta). KV solo actúa como comprobación rápida y descarte por TTL. Nunca sustituyas la comprobación de D1 por un `GET`+`PUT` sobre KV.
  - El **hash-chain** usa encadenamiento optimista con reintento: revalida la `prev_hash` antes de insertar.
  - Las **firmas** se comparan siempre con `timingSafeEqual` / `timingSafeEqualHex`, nunca con `===`.
  - La autenticación por **cabeceras `X-User-*` está desactivada por defecto** (`TRUST_IDENTITY_HEADERS=false`). No la actives si el Worker es accesible públicamente.
  - El destino de redirección tras el login debe validarse siempre con `isSafeInternalPath()`.
  - `SECRET_SALT` es **obligatoria en producción** (`ENVIRONMENT=production`): sin ella la app no arranca. Nunca introduzcas un valor por defecto conocido.
  - El `sub` de OAuth es **sensible a mayúsculas**: no lo normalices al calcular claves del padrón.
  - Los dominios de correo se comparan con `dominioCoincide()`, nunca con `endsWith` (admite sufijos suplantados).

## 2. Mapa de Archivos

- [`wrangler.toml`](./wrangler.toml): Configuración de Cloudflare (`name = "votaso"`), bindings `PADRON_KV` y `URNA_D1`, y todas las variables `[vars]` documentadas.
- [`schema.sql`](./schema.sql): Esquema D1 **idempotente** (`CREATE TABLE IF NOT EXISTS`) con las tablas `elecciones`, `urna`, `padron` y `admin_acciones`. [`schema.reset.sql`](./schema.reset.sql) es el fichero **destructivo** aparte: nunca lo ejecutes contra una urna con historial real.
- [`src/lib/crypto.ts`](./src/lib/crypto.ts): Primitivas criptográficas nativas (`Web Crypto API`, 0 dependencias externas): `sha256Hex`, `hmacSha256Hex`, `pkceChallengeS256`, `computeVoteBlockHash` (Hash-Chain), `signVoteReceipt`, `timingSafeEqual` y `timingSafeEqualHex` (comparación en tiempo constante para firmas).
- [`src/lib/config.ts`](./src/lib/config.ts): Lectura agnóstica de `env` y normalización de claims OAuth (`normalizeVoterIdentity`).
- [`src/lib/session.ts`](./src/lib/session.ts): Sesiones firmadas con HMAC-SHA256 en cookies HttpOnly, validación de rutas internas (`isSafeInternalPath`) y soporte **desactivado por defecto** de cabecera `X-User-Email` (`TRUST_IDENTITY_HEADERS`).
- [`src/lib/urna.ts`](./src/lib/urna.ts): Lógica nuclear auditable (`procesarVoto` y `auditarUrna`), barrera atómica de participación (`registrarEnPadron` sobre la tabla `padron`) y bitácora de administración (`registrarAccionAdmin`).
- [`src/middleware.ts`](./src/middleware.ts): Cabeceras de seguridad HTTP (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`).
- [`src/lib/markdown.ts`](./src/lib/markdown.ts) y [`src/components/MarkdownEditor.tsx`](./src/components/MarkdownEditor.tsx): Editor Markdown (`@mdxeditor/editor`, igual que el de notas de VerificASO) para redactar/editar el contexto descriptivo de qué se vota en `/admin`, y renderizado HTML sanitizado (`marked` + `sanitize-html`) en la portada de votación.
- [`src/pages/index.astro`](./src/pages/index.astro): Portada pública de votación, contexto descriptivo Markdown, aviso para vincular segunda cuenta en `verificaso.aedm.org.es/perfil`, escrutinio en vivo, verificador de recibos P2P e historial de papeletas por votación.
- [`src/pages/urna.astro`](./src/pages/urna.astro): Vista HTML **pública** de la urna completa (estado de la cadena y listado de papeletas). El enlace a ella solo se muestra en la interfaz a los miembros del grupo, en la zona de Auditoría del pie.
- [`src/pages/admin.astro`](./src/pages/admin.astro) y [`src/pages/api/admin/elecciones.ts`](./src/pages/api/admin/elecciones.ts): Panel `/admin` exclusivo para los correos en `env.ADMIN_EMAILS`. Permite crear votaciones eligiendo censo (`solo_socios` vs `registrados`) y abrirlas/cerrarlas. El borrado de una votación con papeletas exige confirmación explícita.
- [`src/pages/votar.ts`](./src/pages/votar.ts) y [`src/pages/auditoria-publica.ts`](./src/pages/auditoria-publica.ts): Endpoints de emisión de voto y auditoría pública JSON.
- [`tests/unit/votaso.test.ts`](./tests/unit/votaso.test.ts): Tests unitarios con Vitest.
- [`docs/wiki/`](./docs/wiki/): Wiki técnica (10 páginas) y [`docs/AUDITORIA.md`](./docs/AUDITORIA.md): revisión de código con hallazgos y plan de corrección.
