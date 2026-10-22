/**
 * config.ts — Configuración 100% agnóstica leída desde variables de entorno (`env`).
 *
 * REGLA IMPORTANTE:
 *   Todo lo específico de VerificASO (como el recuento con doble verificación:
 *   Voto Muy Fiable con 2 cuentas Google ESD + EducaMadrid vs Voto Ordinario con 1 cuenta)
 *   SOLO se activa si el proveedor OAuth configurado es VerificASO o si se habilita
 *   explícitamente con `ENABLE_DOUBLE_VERIFICATION_TALLY = "true"`.
 *   En cualquier otra organización con otro proveedor OAuth, está desactivado automáticamente.
 */
import { env as cfEnv } from "cloudflare:workers";
import type { D1DatabaseBinding, KVNamespaceBinding, VoterIdentity } from "../env";

export interface VotasoConfig {
  orgName: string;
  orgShortName: string;
  orgLogoUrl: string;
  orgWebsiteUrl: string;
  orgPrivacyUrl: string;
  orgRepoUrl: string;
  orgProfileUrl: string;
  orgContactEmail: string;
  enableDoubleVerification: boolean;
  doubleAccountHint: string;
  oauthAuthUrl: string;
  oauthTokenUrl: string;
  oauthUserinfoUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScopes: string;
  claimId: string;
  claimEmail: string;
  claimName: string;
  claimSurname: string;
  claimIsMember: string;
  claimMemberLevel: string;
  memberRequiredLevel: string;
  claimDoubleVerified: string;
  claimIsAdmin: string;
  claimAccountPrimary: string;
  claimAccountSecondary: string;
  allowedEmailDomain: string;
  adminEmails: string[];
  padronTtlSeconds: number;
  secretSalt: string;
  trustIdentityHeaders: boolean;
  identityHeadersSecret: string;
  /**
   * Capacidad del proveedor OAuth respecto a la pertenencia a la organización:
   * - "auto"  → se deduce de lo que el proveedor realmente devuelve (por defecto).
   * - "always" → se fuerza que el censo `solo_socios` esté disponible.
   * - "never" → el proveedor no distingue socios: el censo `solo_socios` no se ofrece.
   */
  membershipMode: MembershipMode;
  /** Peso del voto con verificación doble (doble cuenta) en el recuento. */
  pesoVotoFiable: number;
  /** Peso del voto sin verificación doble en el recuento. */
  pesoVotoOrdinario: number;
}

/**
 * Modo de soporte de pertenencia declarado por el proveedor OAuth.
 */
export type MembershipMode = "auto" | "always" | "never";

type EnvRecord = Record<string, any>;

export function resolveRawEnv(overrideEnv?: EnvRecord): EnvRecord {
  if (overrideEnv) return overrideEnv;
  const out: EnvRecord = {};
  try {
    const proc = (globalThis as any).process?.env;
    if (proc) Object.assign(out, proc);
  } catch {
    /* ignore */
  }
  try {
    const meta = (import.meta as any).env;
    if (meta) Object.assign(out, meta);
  } catch {
    /* ignore */
  }
  try {
    if (cfEnv) Object.assign(out, cfEnv);
  } catch {
    /* ignore */
  }
  return out;
}

export function getBindings(overrideEnv?: EnvRecord): {
  PADRON_KV: KVNamespaceBinding;
  URNA_D1: D1DatabaseBinding;
} {
  const raw = resolveRawEnv(overrideEnv);
  return {
    PADRON_KV: raw.PADRON_KV as KVNamespaceBinding,
    URNA_D1: raw.URNA_D1 as D1DatabaseBinding,
  };
}

export function getConfig(overrideEnv?: EnvRecord): VotasoConfig {
  const env = resolveRawEnv(overrideEnv);
  const salt = resolverSecretSalt(env);
  const adminList = String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const oauthAuthUrl = String(env.OAUTH_AUTH_URL || "https://verificaso.aedm.org.es/oauth/authorize");
  const oauthTokenUrl = String(env.OAUTH_TOKEN_URL || "https://verificaso.aedm.org.es/api/oauth/token");
  const oauthUserinfoUrl = String(env.OAUTH_USERINFO_URL || "https://verificaso.aedm.org.es/api/oauth/userinfo");

  // Solo es obligatorio/activo el sistema de doble verificación si el OAuth es VerificASO
  const isVerificasoOAuth =
    oauthAuthUrl.includes("verificaso") || oauthUserinfoUrl.includes("verificaso");
  const enableDoubleVerification =
    env.ENABLE_DOUBLE_VERIFICATION_TALLY !== undefined
      ? String(env.ENABLE_DOUBLE_VERIFICATION_TALLY).toLowerCase() === "true" && isVerificasoOAuth
      : isVerificasoOAuth;

  // --- Capacidad de pertenencia del proveedor OAuth ---
  // "auto"   → se deduce de lo que el proveedor devuelve realmente en cada login.
  // "always" → el proveedor sí distingue socios (fuerza la disponibilidad del censo).
  // "never"  → el proveedor no distingue socios: el censo `solo_socios` no se ofrece.
  const membershipRaw = String(env.OAUTH_MEMBERSHIP_MODE || "auto").toLowerCase().trim();
  const membershipMode: MembershipMode =
    membershipRaw === "always" || membershipRaw === "never" ? membershipRaw : "auto";

  // --- Pesos del recuento ---
  // Se parsean con un valor por defecto seguro y se acotan a un rango razonable
  // para que un error de configuración no produces un escrutinio absurdo.
  const pesoVotoFiable = parsePeso(env.VOTO_PESO_FIABLE, 1, 0, 100);
  const pesoVotoOrdinario = parsePeso(env.VOTO_PESO_ORDINARIO, 0.5, 0, 100);

  return {
    orgName: String(env.ORG_NAME || "VotASO — Plataforma de Votación Auditable"),
    orgShortName: String(env.ORG_SHORT_NAME || "ASO"),
    orgLogoUrl: String(env.ORG_LOGO_URL || "https://aedm.org.es/aedm.svg"),
    orgWebsiteUrl: String(env.ORG_WEBSITE_URL || "https://aedm.org.es"),
    orgPrivacyUrl: String(env.ORG_PRIVACY_URL || "https://aedm.org.es/privacidad/"),
    orgRepoUrl: String(env.ORG_REPO_URL || "https://github.com/aedmadrid/votaso"),
    orgProfileUrl: String(env.ORG_PROFILE_URL || "https://verificaso.aedm.org.es/perfil"),
    orgContactEmail: String(env.ORG_CONTACT_EMAIL || "aadm@esdmadrid.es"),
    enableDoubleVerification,
    doubleAccountHint: String(
      env.ORG_DOUBLE_ACCOUNT_HINT ||
        "Vincula tus dos cuentas (@esdmadrid.es y @educa.madrid.org) en VerificASO para que tu voto cuente como Voto Muy Fiable.",
    ),
    oauthAuthUrl,
    oauthTokenUrl,
    oauthUserinfoUrl,
    oauthClientId: String(env.OAUTH_CLIENT_ID || "votaso"),
    oauthClientSecret: String(env.OAUTH_CLIENT_SECRET || ""),
    oauthScopes: String(
      env.OAUTH_SCOPES ||
        "identity profile.email.esd profile.id_educamadrid profile.name profile.membership",
    ),
    claimId: String(env.CLAIM_ID || "sub"),
    claimEmail: String(env.CLAIM_EMAIL || "email"),
    claimName: String(env.CLAIM_NAME || "nombre"),
    claimSurname: String(env.CLAIM_SURNAME || "apellido"),
    claimIsMember: String(env.CLAIM_IS_MEMBER || "es_socio"),
    claimMemberLevel: String(env.CLAIM_MEMBER_LEVEL || "tipo_asociado"),
    memberRequiredLevel: String(env.MEMBER_REQUIRED_LEVEL || "pleno_derecho"),
    claimDoubleVerified: String(env.CLAIM_DOUBLE_VERIFIED || "verified_double"),
    claimIsAdmin: String(env.CLAIM_IS_ADMIN || "is_admin"),
    claimAccountPrimary: String(env.CLAIM_ACCOUNT_PRIMARY || "email_esd"),
    claimAccountSecondary: String(env.CLAIM_ACCOUNT_SECONDARY || "id_educamadrid"),
    allowedEmailDomain: String(env.ALLOWED_EMAIL_DOMAIN || ""),
    adminEmails: adminList,
    padronTtlSeconds: Math.max(86400, (parseInt(String(env.PADRON_TTL_DAYS || "90"), 10) || 90) * 86400),
    secretSalt: salt,
    // La vía de autenticación por cabeceras (X-User-Email) permite suplantar a
    // cualquier votante —incluidos los administradores— si el Worker es
    // accesible públicamente. Por eso está desactivada por defecto y solo se
    // habilita de forma explícita para despliegues detrás de Cloudflare Access.
    trustIdentityHeaders:
      String(env.TRUST_IDENTITY_HEADERS || "false").toLowerCase() === "true",
    identityHeadersSecret: String(env.IDENTITY_HEADERS_SECRET || ""),
    membershipMode,
    pesoVotoFiable,
    pesoVotoOrdinario,
  };
}

/**
 * Resuelve la semilla criptográfica que protege sesiones, recibos y padrón.
 *
 * En PRODUCCIÓN es obligatoria: si falta, se lanza un error en lugar de
 * continuar con un valor por defecto. Un valor por defecto conocido en un
 * repositorio público permitiría a cualquiera forjar cookies de sesión
 * (administración) y recibos de voto falsos.
 *
 * En desarrollo se permite un valor por defecto, pero se avisa por consola:
 * conviene definir `SECRET_SALT` también en local.
 */
function resolverSecretSalt(env: EnvRecord): string {
  const configurada = String(env.SECRET_SALT || "").trim();
  if (configurada) {
    if (configurada.length < 32 && esProduccion(env)) {
      throw new Error(
        "SECRET_SALT es demasiado corta para producción: se requieren al menos 32 caracteres. " +
          "Defínela con `npx wrangler secret put SECRET_SALT`.",
      );
    }
    return configurada;
  }

  if (esProduccion(env)) {
    throw new Error(
      "SECRET_SALT no está configurada. Sin ella, las sesiones y los recibos serían " +
        "forjables por cualquiera. Defínela con `npx wrangler secret put SECRET_SALT`.",
    );
  }

  if (!esEntornoDeTest(env)) {
    console.warn(
      "[votaso] SECRET_SALT no está configurada: se usa un valor de desarrollo. " +
        "No despliegues en producción con esta configuración.",
    );
  }
  return "votaso-desarrollo-sin-secret-salt-no-usar-en-produccion";
}

/**
 * Detecta si se está ejecutando la suite de tests, para no ensuciar la salida
 * con avisos de desarrollo.
 */
function esEntornoDeTest(env: EnvRecord): boolean {
  const entorno = String(env.NODE_ENV || "").toLowerCase();
  if (entorno === "test") return true;
  if (env.VITEST) return true;
  try {
    if ((import.meta as any).env?.MODE === "test") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Detecta si el código se está ejecutando en un entorno de producción.
 *
 * Solo se fían las variables de entorno explícitas: `ENVIRONMENT` (definida en
 * `wrangler.toml` para el despliegue real) o `NODE_ENV`. No se deduce de la
 * mera presencia de `SECRET_SALT`, porque en los tests se pasa la sal por
 * parámetro y la aplicación se bloquearía sin necesidad.
 */
function esProduccion(env: EnvRecord): boolean {
  const entorno = String(env.ENVIRONMENT || env.NODE_ENV || "").toLowerCase();
  return entorno === "production" || entorno === "prod";
}
/**
 * Parsea un peso electoral con valores por defecto y acotados.
 */
function parsePeso(raw: unknown, porDefecto: number, min: number, max: number): number {
  if (raw === undefined || raw === null || raw === "") return porDefecto;
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(max, Math.max(min, n));
}

/**
 * Normaliza el perfil recibido desde cualquier proveedor OAuth 2.0 (VerificASO u otro IdP)
 * usando las claves configuradas en `env`.
 */
export function normalizeVoterIdentity(
  rawUserInfo: Record<string, any>,
  cfg: VotasoConfig,
): VoterIdentity {
  const sub = String(rawUserInfo?.[cfg.claimId] || rawUserInfo?.id || rawUserInfo?.email || "").trim();
  const email = String(rawUserInfo?.[cfg.claimEmail] || "").trim().toLowerCase();
  const nombre = String(rawUserInfo?.[cfg.claimName] || "").trim();
  const apellido = String(rawUserInfo?.[cfg.claimSurname] || "").trim();

  const rawMemberBool = rawUserInfo?.[cfg.claimIsMember];
  const rawMemberLevel = rawUserInfo?.[cfg.claimMemberLevel];
  const rawPuedeVotar = rawUserInfo?.puede_votar;
  const esSocio = Boolean(
    rawPuedeVotar === true ||
      rawMemberBool === true ||
      rawMemberBool === "true" ||
      (cfg.memberRequiredLevel && rawMemberLevel === cfg.memberRequiredLevel),
  );

  // ¿El proveedor es capaz de distinguir socios? Se deduce de si su respuesta
  // incluye ALGÚN claim de pertenencia. Un proveedor que no devuelva ninguno
  // no puede sostener un censo `solo_socios`: todos saldrían «no socio» y la
  // votación quedaría vacía de forma silenciosa.
  const tieneClaimsDePertenencia =
    rawUserInfo?.[cfg.claimIsMember] !== undefined ||
    rawUserInfo?.[cfg.claimMemberLevel] !== undefined ||
    rawUserInfo?.puede_votar !== undefined;

  // Si el proveedor OAuth NO es VerificASO (`cfg.enableDoubleVerification === false`),
  // NO se aplica la distinción de doble cuenta y todos los votos tienen plena fiabilidad.
  let hasDoubleAccount = true;
  if (cfg.enableDoubleVerification) {
    const explicitDouble = rawUserInfo?.[cfg.claimDoubleVerified];
    const primaryAcc = rawUserInfo?.[cfg.claimAccountPrimary];
    const secondaryAcc = rawUserInfo?.[cfg.claimAccountSecondary];
    hasDoubleAccount =
      explicitDouble === true ||
      explicitDouble === "true" ||
      Boolean(primaryAcc && String(primaryAcc).trim() && secondaryAcc && String(secondaryAcc).trim());
  }

  const fiabilidad: "muy_fiable" | "ordinario" = hasDoubleAccount ? "muy_fiable" : "ordinario";
  const rawAdminClaim = rawUserInfo?.[cfg.claimIsAdmin];
  const isIdpAdmin = rawAdminClaim === true || rawAdminClaim === "true" || rawAdminClaim === 1;
  const isEmailAdmin = Boolean(email && cfg.adminEmails.includes(email));
  const isAdmin = isEmailAdmin || isIdpAdmin;

  return {
    sub: sub || email,
    email,
    nombre: [nombre, apellido].filter(Boolean).join(" ") || email.split("@")[0] || "Votante",
    esSocio,
    nivelMiembro: String(rawMemberLevel || (esSocio ? cfg.memberRequiredLevel : "registrado")),
    hasDoubleAccount,
    fiabilidad,
    isAdmin,
    tieneClaimsDePertenencia,
  };
}

/**
 * Determina si este despliegue puede ofrecer el censo `solo_socios`.
 *
 * Se combina la declaración explícita (`OAUTH_MEMBERSHIP_MODE`) con lo que el
 * proveedor ha demostrado devolver en el último login:
 *
 * - "always" → siempre disponible (el operador afirma que el IdP distingue socios).
 * - "never"  → nunca disponible: el censo efectivo es `registrados`.
 * - "auto"   → disponible si el proveedor ha devuelto algún claim de pertenencia.
 *
 * El modo efectivo se recalcula en cada login y se guarda en la sesión, de modo
 * que la interfaz de administración puede ocultar la opción cuando el
 * proveedor no la sostiene.
 */
export function censusSociosDisponible(
  cfg: VotasoConfig,
  tieneClaimsDePertenencia?: boolean,
): boolean {
  if (cfg.membershipMode === "never") return false;
  if (cfg.membershipMode === "always") return true;
  // Modo "auto": si aún no hay evidencia (p. ej. un administrador que entra por
  // una vía que no aporta claims), se permite para no bloquear el uso.
  return tieneClaimsDePertenencia !== false;
}
