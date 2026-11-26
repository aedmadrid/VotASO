# VotaSO: admin embebido en VerificASO + logout arriba a la derecha

## 1. `/admin` se entra desde VerificASO

- `https://votaso.aedm.org.es/admin` **redirige** (302) a
  `https://verificaso.aedm.org.es/admin/votaso`.
- **Excepción**: si la petición trae `embed=1` y `app_token=…`, se renderiza el admin
  **aquí**, validando el token contra el userinfo de VerificASO:
  - `app_token` es un access token OAuth de VerificASO con scope
    `identity profile.name profile.membership` (el claim `is_admin` viaja ahí).
  - Se valida contra `https://verificaso.aedm.org.es/api/oauth/userinfo` con
    `Authorization: Bearer`.
  - Si `is_admin` no es `true` → **403** con un mensaje claro; no redirigir (dentro
    del iframe un redirect a VerificASO daría un bucle).
  - Si el token no es válido → 401 y el mismo mensaje.
- En modo `embed=1` el panel va sin cabecera de la app ni pie: solo el contenido del
  admin (se ve dentro de VerificASO).
- El admin de VotaSO no debe seguir exponiendo su propio login: si no hay sesión y no
  hay `embed`, manda a VerificASO (paso anterior). Mantén intacta la lógica interna
  de elecciones.

## 2. Logout arriba a la derecha

- En todas las páginas **salvo** cuando `?app=1` (app de escritorio/móvil) o
  `embed=1` (iframe), tiene que verse **«SALIR»** en la esquina superior derecha,
  con el mismo estilo que el resto de enlaces de cabecera (`text-sm text-muted`).
- Si no existe la cabecera en alguna página, añádela mínima: título a la izquierda,
  `SALIR` a la derecha.
- `?app=1` sigue **sin** logout (regla ya existente).

## Verificación

```bash
npm run build && npm run typecheck && npm test    # los tests actuales en verde
```

Y comprobar a mano:
- `curl -sI https://localhost:4321/admin` (dev) → 302 a verificaso.
- `curl -s "http://127.0.0.1:4321/admin?embed=1&app_token=malo"` → 401.
- `grep -n "enApp\|SALIR" src/pages/index.astro` muestra el logout condicionado.
