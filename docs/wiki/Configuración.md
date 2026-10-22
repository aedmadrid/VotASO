# Configuración

Toda la configuración de VotASO se gestiona mediante variables de entorno en `wrangler.toml` o secretos de Cloudflare.

## Proveedor OAuth 2.0
| Variable | Descripción |
|---|---|
| `OAUTH_AUTH_URL` | Endpoint de login/autorización OAuth. |
| `OAUTH_TOKEN_URL` | Endpoint para canjear código por `access_token`. |
| `OAUTH_USERINFO_URL` | Endpoint que devuelve datos del perfil. |
| `OAUTH_CLIENT_ID` | Identificador de cliente (por defecto `votaso`). |
| `OAUTH_SCOPES` | Permisos solicitados al IdP. |

## Mapeo de Claims OAuth (100% Agnóstico)
| Variable | Por defecto | Descripción |
|---|---|---|
| `CLAIM_ID` | `sub` | Identificador de usuario. |
| `CLAIM_EMAIL` | `email` | Correo del usuario. |
| `CLAIM_IS_MEMBER` | `es_socio` | Booleano si es socio. |
| `CLAIM_MEMBER_LEVEL`| `tipo_asociado` | Nivel de membresía (`pleno_derecho`). |
| `CLAIM_DOUBLE_VERIFIED` | `verified_double` | Indicador de 2 cuentas vinculadas. |
| `CLAIM_IS_ADMIN` | `is_admin` | Booleano si es administrador en el IdP. |

## Ponderación y Seguridad
| Variable | Por defecto | Descripción |
|---|---|---|
| `SECRET_SALT` | — | **Obligatoria en producción**. Secreto para cegar padrón y firmar recibos. |
| `ADMIN_EMAILS` | `""` | Lista CSV de emails administradores (fallback). |
| `VOTO_PESO_FIABLE` | `1` | Puntos para voto con verificación única. |
| `VOTO_PESO_ORDINARIO`| `0.5` | Puntos para voto con verificación estándar. |
| `PADRON_TTL_DAYS` | `90` | Días de retención en KV antes del borrado automático. |
