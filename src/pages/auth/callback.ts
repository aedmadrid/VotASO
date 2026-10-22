import type { APIRoute } from "astro";
import { getConfig, normalizeVoterIdentity, resolveRawEnv } from "../../lib/config";
import {
  createSignedToken,
  isSafeInternalPath,
  nombreCookieEstado,
  parseCookies,
  nombreCookieSesion,
  verifySignedToken,
} from "../../lib/session";

async function oauthFetch(url: string, init: RequestInit): Promise<Response> {
  const env = resolveRawEnv();
  const svc = env.OAUTH_SERVICE as { fetch: typeof fetch } | undefined;
  if (svc && typeof svc.fetch === "function") {
    try {
      return await svc.fetch(new Request(url, init));
    } catch {
      // Fallback a fetch estándar
    }
  }
  return fetch(url, init);
}

export const GET: APIRoute = async ({ request, url }) => {
  const cfg = getConfig();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`Autorización OAuth cancelada o denegada: ${error}`, { status: 400 });
  }
  if (!code || !state) {
    return new Response("Parámetros OAuth incompletos (code/state).", { status: 400 });
  }

  const cookies = parseCookies(request);
  const pending = await verifySignedToken<{
    state: string;
    verifier: string;
    next: string;
    redirectUri: string;
  }>(
    cookies[nombreCookieEstado(url.protocol === "https:")] ||
      cookies["votaso_oauth"],
    cfg.secretSalt,
  );

  if (!pending || pending.state !== state) {
    return new Response("Estado OAuth inválido o expirado (protección CSRF).", { status: 400 });
  }

  const tokenBody: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    client_id: cfg.oauthClientId,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  };
  if (cfg.oauthClientSecret) {
    tokenBody.client_secret = cfg.oauthClientSecret;
  }

  const tokenRes = await oauthFetch(cfg.oauthTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(tokenBody),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => "");
    // El detalle del proveedor puede contener información interna del IdP:
    // se registra en el log del servidor, no se devuelve al cliente.
    console.error(`[oauth] Error del proveedor de identidad (${tokenRes.status}):`, errText);
    return new Response(
      "Error al canjear el código OAuth con el proveedor de identidad.",
      { status: 502 },
    );
  }
  const tokenData: any = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return new Response("El proveedor OAuth no devolvió un access_token válido.", { status: 502 });
  }

  const userRes = await oauthFetch(cfg.oauthUserinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!userRes.ok) {
    const errText = await userRes.text().catch(() => "");
    console.error(`[oauth] Error al obtener la identidad (${userRes.status}):`, errText);
    return new Response(
      "Error al obtener los datos de identidad del proveedor OAuth.",
      { status: 502 },
    );
  }
  const rawUserInfo: Record<string, any> = await userRes.json();
  const voter = normalizeVoterIdentity(rawUserInfo, cfg);

  if (!voter.sub && !voter.email) {
    return new Response("El proveedor OAuth no devolvió un identificador de usuario.", { status: 403 });
  }

  const sessionToken = await createSignedToken({ voter }, cfg.secretSalt, 7200);
  const isSecure = url.protocol === "https:";
  // Se revalida el destino: la cookie de estado está firmada, pero el destino
  // se decide en el último momento y nunca debe poder apuntar fuera del sitio.
  const dest = pending.next && isSafeInternalPath(pending.next) ? pending.next : "/";

  const headers = new Headers();
  headers.set("Location", dest);
  headers.append(
    "Set-Cookie",
    `${nombreCookieSesion(isSecure)}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200${isSecure ? "; Secure" : ""}`,
  );
  headers.append(
    "Set-Cookie",
    `${nombreCookieEstado(isSecure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? "; Secure" : ""}`,
  );
  return new Response(null, { status: 302, headers });
};
