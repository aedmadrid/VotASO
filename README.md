# VotASO

**VotASO** es una plataforma de **votación electrónica institucional de código abierto**: una urna
criptográfica, auditable por cualquier tercero y agnóstica respecto a la organización que la
despliega.

Construida con **Astro 6 (SSR) + TypeScript** sobre **Cloudflare Workers**, con **Cloudflare D1**
como urna transparente y **Cloudflare KV** como padrón de participación.

```
┌──────────────┐      ┌─────────────────────┐      ┌──────────────────┐
│  Navegador   │─────▶│  Cloudflare Worker  │─────▶│  Proveedor OAuth │
│  (votante)   │◀─────│   (Astro SSR)       │◀─────│  (identidad)     │
└──────────────┘      └──────────┬──────────┘      └──────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
         ┌────────────────────┐        ┌────────────────────┐
         │  D1  ·  `urna`     │        │  KV  ·  `PADRON`   │
         │  Votos anónimos    │        │  Padrón cegado     │
         │  Cadena hash-chain │        │  con TTL (RGPD)    │
         └────────────────────┘        └────────────────────┘
```

---

## 📋 Índice

- [Las tres garantías](#las-tres-garantías)
- [Por qué es auditable](#-por-qué-es-auditable-en-github)
- [Inicio rápido](#-inicio-rápido)
- [Despliegue](#-despliegue-en-cloudflare-workers)
- [Configuración](#-configuración)
- [Verificación por un auditor](#-verificación-por-un-auditor-externo)
- [Modelo de datos](#-modelo-de-datos)
- [API](#-api)
- [Seguridad](#-seguridad)
- [Estado del proyecto](#-estado-del-proyecto)
- [Contribución](#-contribución)
- [Licencia](#-licencia)

---

## Las tres garantías

VotASO se construye sobre tres propiedades que se pueden comprobar leyendo el código, no confiando
en la marca del proveedor:

### 1. Imposible votar dos veces

Antes de que una papeleta entre en la urna, se calcula una huella **cegada e irreversible** del
elector:

```
SHA-256("padron:v1:" + eleccion_id + ":" + identificador_elector + ":" + SECRET_SALT)
```

El control de participación tiene dos capas:

- **D1 es la fuente de verdad.** La tabla `padron` usa clave primaria compuesta
  `(eleccion_id, votante_hash)`, de modo que el `INSERT` es **atómico**: si ese elector ya votó en
  esa votación, no inserta y el segundo intento se rechaza. No existe ventana de carrera entre dos
  peticiones simultáneas.
- **KV es la comprobación rápida y el descarte automático.** Una lectura de clave evita tocar la
  base de datos en el caso habitual, y el `expirationTtl` hace que la marca de participación
  desaparezca sola pasado el plazo de conservación (RGPD).

Además, el identificador usado es el `sub` inmutable del proveedor OAuth, de modo que dos correos
distintos de la misma persona (por ejemplo, una cuenta `@esdmadrid.es` y otra `@educa.madrid.org`) se
corresponden con la misma huella.

### 2. Ruptura total del vínculo de identidad

El correo, el nombre y el identificador del usuario **nunca se escriben en la urna**. La tabla
`urna` solo contiene:

| Columna              | Contenido                                             |
| -------------------- | ----------------------------------------------------- |
| `eleccion_id`        | Votación a la que pertenece la papeleta              |
| `opcion`             | Opción emitida                                        |
| `fiabilidad`         | `muy_fiable` u `ordinario`                            |
| `ticket_verificacion`| Identificador público de 16 hex para verificar el voto |
| `timestamp`          | Momento del voto, en milisegundos                     |
| `prev_hash`          | Eslabón con la papeleta anterior                      |
| `block_hash`         | SHA-256 del contenido canónico de la papeleta         |
| `signature`          | HMAC-SHA256 del recibo                                |

Ni siquiera un administrador con acceso directo a la consola de Cloudflare puede saber **quién**
votó cada papeleta.

### 3. Cadena de bloques verificable y recibos firmados

Cada papeleta encadena su hash con el de la anterior:

```
block_hash(N) = SHA-256( prev_hash(N) | eleccion_id | opcion | fiabilidad | ticket | timestamp )
```

El encadenamiento es **optimista con reintento**: antes de insertar, se revalida que la `prev_hash`
calculada siga siendo la cabeza vigente. Si otro elector votó en paralelo, se recalcula el eslabón
y se reintenta, de modo que dos votos simultáneos no bifurcan la cadena.

Al votar, el elector recibe un **ticket de 16 caracteres** y un **recibo criptográfico JSON
firmado**. Cualquier persona puede descargar la urna completa, recalcular la cadena a mano y
comprobar que ningún voto fue alterado ni eliminado.

---

## 🔍 Por qué es auditable en GitHub

El núcleo electoral cabe en dos ficheros:

- [`src/lib/urna.ts`](./src/lib/urna.ts) — la lógica de la urna, el padrón y el escrutinio.
- [`src/lib/crypto.ts`](./src/lib/crypto.ts) — las primitivas criptográficas.

Todo lo demás (OAuth, sesiones, interfaz) es contenedor. La cadena de hashes puede recalcularse
offline con cualquier implementación de SHA-256, sin depender de este proyecto.

Para el detalle operativo, consulta la **[wiki técnica](docs/wiki/Home.md)**:

| Página                                                                       | Contenido                                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| [Instalación](docs/wiki/Instalación.md)                                       | Puesta en marcha local en 5 minutos                   |
| [Configuración](docs/wiki/Configuración.md)                                   | Referencia completa de variables de entorno           |
| [Arquitectura](docs/wiki/Arquitectura.md)                                     | Diagramas, modelo de datos y flujo de una votación    |
| [Seguridad y privacidad](docs/wiki/Seguridad-y-Privacidad.md)                 | Modelo de amenazas y garantías                        |
| [Auditoría y verificación](docs/wiki/Auditoria-y-Verificacion.md)             | Guía paso a paso para auditar una votación            |
| [API](docs/wiki/API.md)                                                       | Referencia de endpoints HTTP                          |
| [Despliegue](docs/wiki/Despliegue.md)                                         | Guía de despliegue en Cloudflare                      |
| [FAQ](docs/wiki/FAQ.md)                                                       | Preguntas frecuentes                                   |
| [Glosario](docs/wiki/Glosario.md)                                             | Vocabulario electoral y criptográfico                  |

---

## 🚀 Inicio rápido

### Requisitos

- **Node.js >= 22.23.4** (Astro 7 lo exige)
- Una cuenta de **Cloudflare** (el plan gratuito es suficiente)

### Instalación

```bash
# 1. Clonar e instalar dependencias
git clone https://github.com/aedmadrid/votaso.git
cd votaso
npm ci

# 2. Crear el fichero local de secretos a partir de la plantilla
cp .dev.vars.example .dev.vars
# Edita .dev.vars y pon tus credenciales reales (NUNCA subas este fichero)

# 3. Arrancar en local
npm run dev
```

> Si `npm install` falla al resolver dependencias de pares, usa `bun install` como alternativa.

### Tests

```bash
npm test          # suite unitaria
npm run typecheck # verificación de tipos (astro check)
```

La suite unitaria (`tests/unit/votaso.test.ts`) cubre criptografía, cegado del padrón, la cadena
de bloques, el control de censo, la ponderación del recuento y la sanitización de Markdown.

---

## 🚀 Despliegue en Cloudflare Workers

```bash
# 1. Crear el almacén KV (padrón) y la base de datos D1 (urna)
npx wrangler kv namespace create PADRON_KV
npx wrangler d1 create votaso-urna-db

# 2. Copia los IDs obtenidos en wrangler.toml e inicializa el esquema
npx wrangler d1 execute votaso-urna-db --remote --file=./schema.sql

# 3. Configurar los secretos de producción
npx wrangler secret put OAUTH_CLIENT_ID
npx wrangler secret put OAUTH_CLIENT_SECRET
npx wrangler secret put SECRET_SALT

# 4. Verificar y desplegar
npm test
npm run typecheck
npm run build
npx wrangler deploy
```

> ⚠️ **`SECRET_SALT` es obligatoria.** Sin ella (o si mide menos de 32 caracteres) la aplicación se
> niega a arrancar en producción. Con una sal conocida, cualquiera podría forjar una sesión de
> administrador.

> **Antes de publicar en producción**, revisa la
> [checklist de lanzamiento](docs/wiki/Despliegue.md#checklist-previa-al-lanzamiento).

---

## ⚙️ Configuración

VotASO es **agnóstico**: ninguna organización, dominio ni administrador está fijado en el código
fuente. Todo se configura por variables de entorno.

### Proveedor OAuth 2.0 / OIDC

| Variable               | Descripción                                             | Por defecto |
| ---------------------- | ------------------------------------------------------- | ----------- |
| `OAUTH_AUTH_URL`       | Endpoint de autorización                                 | VerificASO  |
| `OAUTH_TOKEN_URL`      | Endpoint de canje del token                              | VerificASO  |
| `OAUTH_USERINFO_URL`   | Endpoint de perfil                                       | VerificASO  |
| `OAUTH_CLIENT_ID`      | Client ID registrado en el proveedor                     | —           |
| `OAUTH_CLIENT_SECRET`  | Client Secret (opcional con PKCE público)                | —           |
| `OAUTH_SCOPES`         | Ámbitos solicitados                                       | VerificASO  |

### Mapeo de campos del perfil

`CLAIM_ID`, `CLAIM_EMAIL`, `CLAIM_NAME`, `CLAIM_SURNAME`, `CLAIM_IS_MEMBER`,
`CLAIM_MEMBER_LEVEL`, `CLAIM_DOUBLE_VERIFIED`, `CLAIM_ACCOUNT_PRIMARY` y
`CLAIM_ACCOUNT_SECONDARY` indican qué campo del `userinfo` corresponde a cada dato.

### Organización

`ORG_NAME`, `ORG_SHORT_NAME`, `ORG_LOGO_URL`, `ORG_WEBSITE_URL`, `ORG_PRIVACY_URL`,
`ORG_REPO_URL`, `ORG_CONTACT_EMAIL` y `ORG_PROFILE_URL`.

### Administración y padrón

| Variable                | Descripción                                                    | Por defecto |
| ----------------------- | -------------------------------------------------------------- | ----------- |
| `ADMIN_EMAILS`          | Correos con acceso a `/admin` (separados por comas)             | —           |
| `MEMBER_REQUIRED_LEVEL` | Nivel de membresía exigido en las votaciones `solo_socios`     | `pleno_derecho` |
| `PADRON_TTL_DAYS`       | Días de conservación del hash de participación                  | `90`        |
| `SECRET_SALT`           | Semilla criptográfica (>= 32 bytes). **Secreto.**              | —           |
| `OAUTH_MEMBERSHIP_MODE` | Capacidad de pertenencia del IdP: `auto`, `always` o `never`    | `auto`      |
| `VOTO_PESO_FIABLE`      | Peso del voto con doble verificación                            | `1`         |
| `VOTO_PESO_ORDINARIO`   | Peso del voto sin doble verificación                            | `0.5`       |

### Censo adaptable

Si tu proveedor OAuth **no distingue socios** (no devuelve ningún claim de pertenencia), la opción
«solo socios» **desaparece** del panel de administración y las votaciones se dirigen a todos los
usuarios registrados. No hay que hacer nada: se detecta solo.

```bash
OAUTH_MEMBERSHIP_MODE = "auto"    # detección automática (por defecto)
OAUTH_MEMBERSHIP_MODE = "always"  # el IdP sí distingue socios: forzar la opción
OAUTH_MEMBERSHIP_MODE = "never"   # el IdP no distingue socios: nunca ofrecerla
```

### Recuento ponderado

El recuento distingue dos magnitudes, y ambas se publican en la auditoría:

- **Papeletas** (`total`): número bruto de votos depositados.
- **Puntos** (`puntos`): valor electoral tras aplicar el peso.

Un voto «muy fiable» (doble cuenta verificada) vale `VOTO_PESO_FIABLE` puntos y uno «ordinario» vale
`VOTO_PESO_ORDINARIO` — **la mitad** por defecto.

> **Excepción:** en las votaciones con censo `solo_socios` **no se pondera**. El electorado ya está
> acotado a socios de pleno derecho, así que todos los votos valen lo mismo.

```bash
VOTO_PESO_FIABLE = "1"
VOTO_PESO_ORDINARIO = "0.5"
```

Conviene fijar los pesos **antes** de abrir la votación: cambiarlos después altera el recuento de
una votación ya cerrada.

### Doble verificación (voto «muy fiable»)

La distinción entre **Voto Muy Fiable** (dos cuentas vinculadas) y **Voto Ordinario** (una sola
cuenta) **solo se activa cuando el proveedor OAuth configurado es VerificASO** y
`ENABLE_DOUBLE_VERIFICATION_TALLY = "true"`. Con cualquier otro proveedor, todos los votos tienen el
mismo rango y no se muestra ningún aviso de doble cuenta.

La referencia completa está en la [wiki de configuración](docs/wiki/Configuración.md).

---

## ✅ Verificación por un auditor externo

### Tu recibo

Al votar, **se descarga automáticamente un archivo JSON** con tu recibo
(`recibo-votaso-<ticket>.json`). Guárdalo: es la prueba de que tu voto está en la urna.

Para comprobarlo en cualquier momento, en la zona de **Auditoría** del pie de la portada puedes:

- **Cargar el archivo** con el botón «Cargar recibo desde archivo» (se rellena y verifica solo).
- **Pegar el JSON** directamente en el campo de texto.

```bash
# 1. Descargar la urna completa (array de papeletas)
curl "https://TU-DOMINIO/auditoria-publica"

# 2. Descargar el resumen con verificación de la cadena
curl "https://TU-DOMINIO/auditoria-publica?resumen=1"

# 3. Validar un recibo JSON concreto
curl -X POST "https://TU-DOMINIO/api/verificar-recibo" \
  -H "Content-Type: application/json" \
  -d '{"ticket":"...","eleccion_id":"...","opcion":"...","fiabilidad":"ordinario","timestamp":0,"prev_hash":"...","block_hash":"...","signature":"..."}'
```

El campo `verificacion_blockchain.cadena_integra` indica si la cadena se mantiene intacta de principio
a fin. La [guía de auditoría](docs/wiki/Auditoria-y-Verificacion.md) explica cómo recalcular cada
hash a mano.

Para consultar las papeletas en HTML, existe la vista `/urna`, que muestra el estado de la cadena y
el listado completo de papeletas. Es **pública**: cualquiera puede acceder a ella por URL directa,
sin cuenta. En la interfaz, el enlace a la urna solo se muestra a los miembros del grupo, en la
zona de Auditoría del pie de la portada.

---

## 🗄️ Modelo de datos

Dos tablas en D1, definidas en [`schema.sql`](./schema.sql):

- **`elecciones`** — procesos electorales: título, contexto en Markdown, opciones, censo, estado y
  fechas.
- **`urna`** — papeletas depositadas, con su eslabón criptográfico y su firma.

Y el padrón en KV, con expiración automática para cumplir la minimización de datos del RGPD: la
huella cegada se borra sola pasado el plazo de conservación.

---

## 🔌 API

| Método | Ruta                     | Descripción                                       |
| ------ | ------------------------ | ------------------------------------------------- |
| `GET`  | `/auth/login`            | Inicia el flujo OAuth 2.0 con PKCE                |
| `GET`  | `/auth/callback`         | Callback del proveedor de identidad               |
| `GET`  | `/auth/logout`           | Cierra sesión y borra la cookie                   |
| `GET`  | `/`                      | Portada de votación                                |
| `GET`  | `/admin`                 | Panel de administración                            |
| `POST` | `/votar`                 | Emisión de voto (JSON)                            |
| `GET`  | `/auditoria-publica`     | Urna pública en JSON (filas o resumen)            |
| `GET`  | `/urna`                  | Vista HTML de la urna pública                     |
| `POST` | `/api/verificar-recibo`  | Validación de un recibo criptográfico              |
| `POST` | `/api/admin/elecciones`  | Alta, edición y cierre de votaciones               |

Detalle en la [referencia de API](docs/wiki/API.md).

---

## 🔐 Seguridad

- **Criptografía nativa.** Solo `Web Crypto API`: SHA-256, HMAC-SHA256 y PKCE S256. Cero
  dependencias criptográficas externas.
- **Sesiones firmadas.** Cookies `HttpOnly` + `SameSite=Lax` con firma HMAC-SHA256, expiración y
  prefijo `__Host-` (impide el *cookie tossing* desde un subdominio).
- **OAuth con PKCE S256** y validación de `state` contra CSRF. El destino de redirección se valida
  contra redirect abiertos.
- **`SECRET_SALT` obligatoria en producción.** Si falta o es corta, la aplicación se niega a
  arrancar: con una sal conocida se podrían forjar sesiones de administrador.
- **Markdown sanitizado** con `marked` + `sanitize-html` antes de renderizar. Las imágenes
  externas solo se admiten por HTTPS.
- **Minimización de datos.** La urna no contiene datos personales; el padrón se purga pasado el
  plazo de conservación.
- **Cabeceras de seguridad y CSP** en todas las respuestas, más verificación de origen en las
  peticiones que mutan estado.
- **Limitación de peticiones por IP** en el voto, la verificación de recibos y la administración.
- **Dependencias sin vulnerabilidades conocidas** (`npm audit --omit=dev` → 0).
- **Sin secretos en el repositorio.** Toda credencial va en `.dev.vars` (local) o en secretos de
  Wrangler (producción). `.gitignore` impide subir `.dev.vars` y la CI lo comprueba.

> **Aviso.** Este software no ha pasado una auditoría de seguridad formal por un tercero
> independiente. Úsalo en procesos con consecuencias reales solo tras una revisión propia
> adecuada. Consulta el [modelo de amenazas](docs/wiki/Seguridad-y-Privacidad.md) para qué queda
> dentro y qué queda fuera de su alcance.

---

## 📊 Estado del proyecto

- [x] Votación con padrón, ruptura de identidad y hash-chain
- [x] OAuth 2.0 agnóstico con PKCE
- [x] Panel de administración y contexto en Markdown
- [x] Escrutinio y verificador de recibos público
- [x] Auditoría pública en JSON y vista HTML de la urna
- [x] Barrera de participación atómica en D1 y encadenamiento con reintento
- [x] Bitácora de acciones de administración
- [x] Recuento ponderado por puntos (el voto «muy fiable» pesa el doble)
- [x] Censo adaptable a la capacidad del proveedor OAuth
- [ ] Auditoría de seguridad por tercero

La revisión de código completa, con los hallazgos y su plan de corrección, está en
[`docs/AUDITORIA.md`](./docs/AUDITORIA.md). En ella se documentan dos vulnerabilidades críticas y
tres altas que **ya están corregidas** en esta versión, así como el resto de carencias conocidas.

---

## 🤝 Contribución

Las Issue y Pull Requests son bienvenidas. Antes de abrir una PR:

```bash
npm install
npm test
npm run build
```

Consulta [`CONTRIBUTING.md`](./CONTRIBUTING.md) para el proceso detallado y
[`docs/AUDITORIA.md`](./docs/AUDITORIA.md) para el estado de la revisión de código.

---

## 📄 Licencia

[MIT](./LICENSE) © AEDM
