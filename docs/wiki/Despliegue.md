# Despliegue en Cloudflare

## 1. Crear Recursos
```bash
# Base de datos D1
npx wrangler d1 create votaso-urna-db

# Espacio KV para padrón
npx wrangler kv:namespace create PADRON_KV
```

Copia los IDs generados en `wrangler.toml`.

## 2. Inicializar Esquema D1
```bash
npx wrangler d1 execute votaso-urna-db --remote --file=./schema.sql
```

## 3. Secretos de Producción
En producción (`ENVIRONMENT="production"`), `SECRET_SALT` es obligatoria:
```bash
npx wrangler secret put SECRET_SALT
```

Opcionales:
```bash
npx wrangler secret put OAUTH_CLIENT_SECRET
npx wrangler secret put ADMIN_EMAILS
```

## 4. Desplegar
```bash
npm run build
npx wrangler deploy
```
