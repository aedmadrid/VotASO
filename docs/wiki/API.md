# Referencia de API

## `POST /votar`
Emite una papeleta de voto anónimo.
- **Acceso**: Requiere sesión activa.
- **Cuerpo JSON**:
  ```json
  {
    "eleccionId": "eleccion-id",
    "opcionSeleccionada": "Opción A"
  }
  ```
- **Respuesta (200 OK)**:
  ```json
  {
    "success": true,
    "ticket": "recibo-aleatorio",
    "block_hash": "sha256...",
    "signature": "hmac...",
    "timestamp": 1740000000000
  }
  ```

## `GET /auditoria-publica`
Acceso público a la urna y recuento.
- **Parámetros**:
  - `eleccion_id`: Filtra por votación.
  - `resumen=1`: Devuelve escrutinio agrupado y verificación del hash-chain.
- **Respuesta**: Array de papeletas anónimas o JSON de escrutinio.

## `POST /api/admin/elecciones`
Gestión de votaciones (exclusivo administradores).
- `action: "create"`: Crea una nueva votación con censo y opción de ponderación.
- `action: "toggle_estado"`: Abre o cierra la votación.
- `action: "delete"`: Elimina una votación (requiere `confirmar: true` si tiene votos).
