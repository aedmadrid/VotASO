# Glosario

- **Urna (`urna`)**: Tabla en Cloudflare D1 donde se almacenan anónimamente las papeletas con su cadena de hashes.
- **Padrón (`padron`)**: Tabla en D1 con clave primaria compuesta `(eleccion_id, votante_hash)` que garantiza atómicamente un voto por elector.
- **KV (`PADRON_KV`)**: Almacén rápido con TTL automático (90 días) para descartar rastros temporales según RGPD.
- **Papeleta**: Voto individual depositado en la urna.
- **Puntos**: Valor electoral de la papeleta tras aplicar la ponderación (1 pto para voto fiable, 0.5 ptos para ordinario si la votación lo activa).
- **Hash-Chain**: Encadenamiento SHA-256 donde cada voto contiene el hash del voto previo (`prev_hash` -> `block_hash`).
- **Ticket de verificación**: Identificador único devuelto al votante para auditar su papeleta en el historial sin revelar su identidad.
- **SECRET_SALT**: Secreto criptográfico obligatorio en producción usado para cegar el padrón y firmar recibos.
