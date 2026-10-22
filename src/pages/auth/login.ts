import type { APIRoute } from "astro";
import { getConfig } from "../../lib/config";
import { base64UrlEncode, pkceChallengeS256 } from "../../lib/crypto";
import { createSignedToken, isSafeInternalPath, nombreCookieEstado } from "../../lib/session";

export const GET: APIRoute = async ({ url }) => {
  const cfg = getConfig();
  const nextPath = url.searchParams.get("next") || "/";
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
