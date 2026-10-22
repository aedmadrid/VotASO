# Arquitectura del Sistema

```
[Votante]
   │
   ▼
[OAuth 2.0 (VerificASO / IdP)]  ── (Autenticación y claims)
   │
   ▼
[VotASO Worker (Astro SSR)]
   │
   ├──▶ [Cloudflare D1: padron]  ── (Barrera atómica un-voto-por-elector)
   ├──▶ [Cloudflare KV: PADRON]  ── (Caché rápida y expiración TTL RGPD)
   │
   └──▶ [Cloudflare D1: urna]    ── (Hash-Chain anónimo y transparente)
```

## Componentes
- **Front-end**: Astro SSR con diseño minimalista basado en CSS sin librerías pesadas.
- **Backend / Worker**: Edge API en Cloudflare Workers con Web Crypto API nativa.
- **D1 (`votaso-urna-db`)**: Base de datos SQL relacional distribuida.
- **KV (`PADRON_KV`)**: Almacén clave-valor de baja latencia con TTL automático.
