# Seguridad y Privacidad

## Principios Clave

1. **Ruptura de Identidad**: La tabla `urna` de D1 nunca almacena `email`, `sub`, `nombre` ni direcciones IP.
2. **Padrón Criptográfico Ciego**: Se almacena únicamente `SHA-256("padron:v1:" + eleccionId + ":" + sub + ":" + SECRET_SALT)`. Sin la sal, es matemáticamente imposible derivar quién ha participado.
3. **Atocimidad en D1**: La clave primaria `(eleccion_id, votante_hash)` en D1 previene el doble voto en concurrencia.
4. **Cumplimiento RGPD**: El padrón en KV cuenta con un TTL automático (90 días) para olvidar la huella de participación una vez concluido el proceso electoral.
5. **Aislamiento de Sesión**: Cookies HTTP-Only, Secure, SameSite=Lax firmadas con HMAC-SHA256.
