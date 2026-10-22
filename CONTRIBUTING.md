# Contribuir a VotASO

VotASO es una herramienta de votación institucional. Las contribuciones que tocan la **integridad
electoral** (la cadena hash-chain, el padrón, la ruptura de identidad o la criptografía) se tratan
con más cautela que el resto: un cambio que parezca inocuo puede alterar la seguridad del sistema.

## Antes de empezar

1. Lee [`docs/AUDITORIA.md`](./docs/AUDITORIA.md). Contiene el análisis de seguridad y de calidad
   del código actual, con las carencias conocidas y su prioridad. Si tu contribución tapa una de
   ellas, es el mejor punto de partida posible.
2. Revisa la [wiki técnica](docs/wiki/Home.md), en especial
   [Arquitectura](docs/wiki/Arquitectura.md) y
   [Seguridad y privacidad](docs/wiki/Seguridad-y-Privacidad.md).

## Entorno de desarrollo

```bash
git clone https://github.com/aedmadrid/votaso.git
cd votaso
npm install
cp .dev.vars.example .dev.vars   # con tus credenciales; nunca se versiona
npm run dev
```

Requiere **Node.js >= 22.23.4** (Astro 7 lo exige). Si `npm install` falla al resolver
dependencias de pares, usa `bun install` como alternativa.

## Comandos disponibles

| Comando             | Qué hace                                              |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | Servidor de desarrollo de Astro                       |
| `npm run build`     | Compilación para Cloudflare Workers                   |
| `npm test`          | Suite unitaria (Vitest)                               |
| `npm run preview`   | Previsualiza el build de producción                   |

Antes de abrir una Pull Request, los tres deben pasar en verde:

```bash
npm test && npm run build
```

## Estilo del código

- **TypeScript estricto.** El proyecto usa `astro/tsconfigs/strict`. No uses `any` sin una razón
  justificada en un comentario.
- **Comentarios en español**, explicando el *porqué*, no el *qué*. El código ya dice lo que hace.
- **Cero dependencias criptográficas externas.** Toda la criptografía va con la `Web Crypto API`
  nativa, en [`src/lib/crypto.ts`](./src/lib/crypto.ts). Si necesitas un algoritmo que no está,
  consúltalo antes de añadir una dependencia.
- **Cero secretos en el código fuente.** Nada de dominios, correos de administradores ni URLs de
  proveedores hardcodeados: todo va por variables de entorno (ver
  [Configuración](docs/wiki/Configuración.md)).

## Reglas para tocar el núcleo electoral

Si tu cambio afecta a [`src/lib/urna.ts`](./src/lib/urna.ts),
[`src/lib/crypto.ts`](./src/lib/crypto.ts) o [`src/lib/session.ts`](./src/lib/session.ts):

1. **No rompas la cadena de bloques.** El formato canónico de `block_hash` es
   `SHA-256(prev_hash|eleccion_id|opcion|fiabilidad|ticket|timestamp)`. Si lo cambias, rompes la
   compatibilidad con los recibos ya emitidos y con las auditorías anteriores.
2. **No introduzcas datos personales en la tabla `urna`.** Ninguna columna nueva puede contener
   correo, nombre ni identificador de elector. Es la garantía central del sistema.
3. **Añade un test** en [`tests/unit/votaso.test.ts`](./tests/unit/votaso.test.ts) que cubra el
   comportamiento nuevo. Los cambios sin test no se fusionan.
4. **Actualiza la wiki** si alteras una garantía, una variable de entorno o un endpoint.

## Reportar una vulnerabilidad

**No abras una Issue pública para un fallo de seguridad.** Sigue el proceso descrito en
[`SECURITY.md`](./SECURITY.md).

## Commits y Pull Requests

- Un commit, un cambio. Mensajes en imperativo y en español.
- Explica en la descripción de la PR *qué* cambia y *por qué*, y enlaza la Issue si existe.
- Si el cambio altera el comportamiento observable, actualiza también el README y la wiki.

## Código de conducta

Al participar aceptas mantener un trato respetuoso. No hay un código de conducta independiente en
este repositorio: se aplican las expectations habituales de la comunidad open source.
