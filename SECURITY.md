# Política de seguridad

## Reportar una vulnerabilidad

**No abras una Issue pública, ni un Pull Request, ni un Discussion para reportar un fallo de
seguridad.** Un issue público puede dar a un atacante la información que necesita.

Envía el reporte por correo electrónico a **aadm@esdmadrid.es**, o usa el canal privado de
GitHub: *Security* → *Report a vulnerability* en la pestaña **Security** del repositorio.

Incluye, si puedes:

- Descripción de la vulnerabilidad y su impacto.
- Pasos para reproducirla (idealmente, un caso de prueba o una petición `curl`).
- Versión afectada (commit o etiqueta).
- Cualquier PoC o traza.

Recibirás acuse de recibo en un plazo razonable. Intentamos confirmar el problema y preparar una
corrección en un plazo de días o semanas, según la gravedad. Coordinamos la publicación con el
reportero para que la vulnerabilidad no se haga pública antes de existir una corrección.

## Qué consideramos vulnerabilidad

- Quebrar la **ruptura de identidad**: conseguir asociar un voto a un elector.
- Eludir la **barrera de participación**: votar más de una vez en la misma votación.
- Alterar o borrar una papeleta de la urna **sin** que la auditoría pública lo detecte.
- Forjar un **recibo criptográfico** válido, o invalidar el de un tercero.
- Acceder al panel `/admin` sin ser un administrador.
- Que un votante pueda **emitir un voto en una votación cerrada** o fuera de su censo.
- Vulnerabilidades de inyección (XSS, SQL, SSRF) en rutas públicas.

## Qué NO consideramos vulnerabilidad

- Que el contenido de las papeletas de una urna abierta sea visible en la auditoría pública: es un
  requisito de transparencia del sistema.
- Que alguien con acceso administrativo a la consola de Cloudflare pueda leer o modificar la base de
  datos: la organización que opera la infraestructura es un actor de confianza del modelo (ver
  [el modelo de amenazas](docs/wiki/Seguridad-y-Privacidad.md)).
- Que el voto de «muy fiable» y el «ordinario» pesen lo mismo en el recuento: el peso configurable
  está pendiente de implementar (ver [`docs/AUDITORIA.md`](./docs/AUDITORIA.md)).
- La ausencia de auditoría formal de un tercero.

## Uso responsable

VotASO se despliega en procesos con consecuencias reales sobre personas. Antes de usarlo en un
proceso electoral auténtico:

- Revisa el estado de la revisión de código en [`docs/AUDITORIA.md`](./docs/AUDITORIA.md).
- Considera una revisión de seguridad independiente.
- Prueba el flujo completo en un entorno de pruebas antes de abrir la votación real.
- Define con antelación un procedimiento de recuento y de resolución de incidencias.

## Versiones soportadas

| Versión | Soportada          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |

El proyecto está en fase beta: solo se corrigen fallos en la rama `main`.
