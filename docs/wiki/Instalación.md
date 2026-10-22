# Instalación

## Requisitos
- **Node.js**: `>=22.23.4` (Astro 7).
- **npm** o **bun**.
- **Cloudflare**: Cuenta gratuita para D1, KV y Workers.

## Puesta en marcha local
```bash
git clone https://github.com/aedmadrid/votaso.git
cd votaso
npm install
cp .dev.vars.example .dev.vars
```

Edita `.dev.vars` con tus credenciales:
```env
OAUTH_CLIENT_ID="votaso"
OAUTH_CLIENT_SECRET=""
SECRET_SALT="clave_aleatoria_minimo_32_caracteres"
ADMIN_EMAILS="admin@example.com"
```

Genera una sal segura:
```bash
openssl rand -hex 32
```

## Comandos
```bash
npm run dev      # Servidor local de desarrollo
npm test         # Pruebas unitarias con Vitest
npm run build    # Compilación de producción
```
