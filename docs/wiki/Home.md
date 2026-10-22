# VotASO — Wiki técnica

VotASO es una plataforma de votación electrónica criptográfica de código abierto construida en **Astro 7 (SSR) + TypeScript** sobre **Cloudflare Workers**, **Cloudflare D1** (`URNA_D1`) y **Cloudflare KV** (`PADRON_KV`).

## Garantías de integridad
1. **Un voto por elector**: Huella cegada irreversible (`SHA-256` con `SECRET_SALT`) y barrera atómica en tabla D1 `padron`.
2. **Anonimato total**: En la tabla `urna` de D1 nunca se guarda correo, nombre ni `sub`. Solo opción, fiabilidad, ticket y hashes.
3. **Inmutabilidad auditable**: Hash-Chain criptográfico por cada papeleta; cualquier manipulación rompe la cadena detectable públicamente en `/auditoria-publica`.

## Índice
- [Instalación](Instalación.md) — Requisitos y ejecución en local.
- [Configuración](Configuración.md) — Variables de entorno, claims y secretos.
- [Arquitectura](Arquitectura.md) — Flujo, D1, KV y modelo de datos.
- [Seguridad y Privacidad](Seguridad-y-Privacidad.md) — Modelo de amenazas y privacidad.
- [Auditoría y Verificación](Auditoria-y-Verificacion.md) — Cómo auditar y verificar recibos.
- [API](API.md) — Endpoints HTTP y formatos JSON.
- [Despliegue](Despliegue.md) — Publicación en Cloudflare Workers.
- [FAQ](FAQ.md) — Preguntas frecuentes directas.
- [Glosario](Glosario.md) — Definiciones técnicas clave.
