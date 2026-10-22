# Preguntas Frecuentes (FAQ)

### 1. ¿Se puede votar dos veces?
No. Se calcula un hash cegado del votante (`SHA-256` + `SECRET_SALT`) y se inserta de forma atómica en la tabla `padron` de D1. Si ya existe, se rechaza la inserción.

### 2. ¿Qué ocurre con la doble verificación?
Solo aplica cuando el IdP es VerificASO. Quienes tienen ambas cuentas vinculadas obtienen verificación única (voto fiable). Quienes tienen una sola cuenta disponen de verificación estándar (ponderable a la mitad si la votación lo requiere).

### 3. ¿El administrador puede ver quién ha votado?
No. La tabla `urna` es estrictamente anónima. No almacena correos, nombres ni identificadores. Solo almacena opción, nivel de verificación, ticket y hashes criptográficos.

### 4. ¿Quién puede auditar las votaciones?
Cualquiera. El endpoint `/auditoria-publica` es público y expone el recuento y las papeletas anónimas encadenadas. Cualquiera puede recalcular los hashes de forma independiente.

### 5. ¿Qué pasa si el proveedor OAuth se cae?
No se podrán iniciar nuevas sesiones, pero las votaciones activas y las papeletas emitidas en D1 quedan intactas. Los usuarios con sesión activa (válida 2h) pueden seguir votando.
