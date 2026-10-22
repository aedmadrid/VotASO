# Auditoría y Verificación

VotASO permite que cualquier persona audite el recuento y verifique la integridad de la urna.

## 1. Verificación del Hash-Chain
Cada voto en la urna se encadena mediante SHA-256 canónico:
```
block_hash = SHA-256(prev_hash + "|" + eleccion_id + "|" + opcion + "|" + fiabilidad + "|" + ticket_verificacion + "|" + timestamp)
```
Si cualquier fila es modificada o eliminada, el `block_hash` no coincidirá con el `prev_hash` del siguiente voto.

## 2. Consulta Pública
Puedes obtener la urna íntegra en formato JSON mediante:
```bash
curl "https://votaso.aedm.org.es/auditoria-publica?eleccion_id=mi-votacion&resumen=1"
```

## 3. Comprobación de Recibos
El votante recibe un ticket criptográfico al votar. Desde la portada o vía `/api/verificar-recibo` puede comprobar que su papeleta figura en la urna sin desvelar su identidad personal.
