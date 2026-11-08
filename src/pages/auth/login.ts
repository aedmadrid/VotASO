import type { APIRoute } from "astro";
import { getConfig, normalizeVoterIdentity } from "../../lib/config";
import { base64UrlEncode, pkceChallengeS256 } from "../../lib/crypto";
import { createSignedToken, isSafeInternalPath, nombreCookieEstado, nombreCookieSesion } from "../../lib/session";

export const GET: APIRoute = async ({ url }) => {
  const cfg = getConfig();
  const nextPath = url.searchParams.get("next") || "/";

  // Entrada directa desde la ASO.app: ?app_token=<access_token OAuth>.
  // La app ya autenticó al usuario con VerificASO; validamos el token contra
  // userinfo (lado servidor) y creamos sesión sin pasar por el navegador
  // (Google bloquea webviews y la pantalla se quedaba tiesa).
  const appToken = url.searchParams.get("app_token") || "";
  if (appToken) {
    const safeDest = isSafeInternalPath(nextPath) ? nextPath : "/";
    try {
      const userRes = await fetch(cfg.oauthUserinfoUrl, {
        headers: { Authorization: ["Bearer", appToken].join(" "), Accept: "application/json" },
      });
      if (userRes.ok) {
        const rawUserInfo: Record<string, any> = await userRes.json();
        const voter = normalizeVoterIdentity(rawUserInfo, cfg);
        if (voter.sub || voter.email) {
          const sessionToken = await createSignedToken({ voter }, cfg.secretSalt, 7200);
          const isSecure = url.protocol === "https:";
          const headers = new Headers();
          headers.set("Location", safeDest);
          headers.append(
            "Set-Cookie",
            `${nombreCookieSesion(isSecure)}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200${isSecure ? "; Secure" : ""}`,
          );
          return new Response(null, { status: 302, headers });
        }
      }
    } catch {
      // Cae al flujo OAuth normal de abajo.
    }
  }
  // Solo se admiten rutas internas. Un valor como `//evil.com` o `https://evil.com`
  // es un redirect abierto: el navegador lo interpretaría como URL absoluta.
  const safeNext = isSafeInternalPath(nextPath) ? nextPath : "/";
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64UrlEncode(randomBytes);
  const codeChallenge = await pkceChallengeS256(codeVerifier);
  const stateNonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  const redirectUri = `${url.origin}/auth/callback`;
  const stateCookieVal = await createSignedToken(
    { state: stateNonce, verifier: codeVerifier, next: safeNext, redirectUri },
    cfg.secretSalt,
    600,
  );

  const authUrl = new URL(cfg.oauthAuthUrl);
  authUrl.searchParams.set("client_id", cfg.oauthClientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", cfg.oauthScopes);
  authUrl.searchParams.set("state", stateNonce);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const isSecure = url.protocol === "https:";
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": `${nombreCookieEstado(isSecure)}=${encodeURIComponent(stateCookieVal)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isSecure ? "; Secure" : ""}`,
    },
  });
};
