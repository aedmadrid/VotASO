import { describe, expect, it } from "vitest";
import {
    censusSociosDisponible,
    getConfig,
    normalizeVoterIdentity,
} from "../../src/lib/config";
import { renderElectionMarkdown } from "../../src/lib/markdown";
import { auditarUrna, procesarVoto } from "../../src/lib/urna";
import { computeVoteBlockHash, buildPadronKey, signVoteReceipt, timingSafeEqual } from "../../src/lib/crypto";
import {
    dominioCoincide,
    isSafeInternalPath,
    nombreCookieEstado,
    nombreCookieSesion,
} from "../../src/lib/session";
import type { D1DatabaseBinding, KVNamespaceBinding } from "../../src/env";

function createMockBindings() {
    const kvStore = new Map<string, string>();
    const eleccionesTable: any[] = [];
    const urnaTable: any[] = [];
    const padronTable: any[] = [];

    const PADRON_KV: KVNamespaceBinding & { _store: Map<string, string> } = {
        async get(key: string) {
            return kvStore.has(key) ? kvStore.get(key)! : null;
        },
        async put(key: string, val: string) {
            kvStore.set(key, val);
        },
        _store: kvStore,
    };

    const URNA_D1: D1DatabaseBinding & {
        _urna: any[];
        _elecciones: any[];
        _padron: any[];
    } = {
        prepare(sql: string) {
            let bound: unknown[] = [];
            return {
                bind(...args: unknown[]) {
                    bound = args;
                    return this;
                },
                async run() {
                    if (sql.includes("INSERT INTO elecciones")) {
                        const [
                            id,
                            titulo,
                            descripcion,
                            opciones_json,
                            censo_tipo,
                            fecha_inicio,
                            fecha_fin,
                            creada_por,
                            created_at,
                        ] = bound;
                        eleccionesTable.push({
                            id,
                            titulo,
                            descripcion,
                            opciones_json,
                            censo_tipo,
                            estado: "abierta",
                            fecha_inicio,
                            fecha_fin,
                            creada_por,
                            created_at,
                        });
                    } else if (sql.includes("INSERT INTO urna")) {
                        const [
                            eleccion_id,
                            opcion,
                            fiabilidad,
                            ticket_verificacion,
                            timestamp,
                            prev_hash,
                            block_hash,
                            signature,
                        ] = bound;
                        urnaTable.push({
                            id: urnaTable.length + 1,
                            eleccion_id,
                            opcion,
                            fiabilidad,
                            ticket_verificacion,
                            timestamp,
                            prev_hash,
                            block_hash,
                            signature,
                        });
                    } else if (sql.includes("INSERT INTO padron")) {
                        // Reproduce la clave primaria compuesta: si la fila ya
                        // existe, el INSERT no inserta nada (changes = 0).
                        const [eleccion_id, votante_hash, creado_en] = bound;
                        const existe = padronTable.some(
                            (p) => p.eleccion_id === eleccion_id && p.votante_hash === votante_hash,
                        );
                        if (!existe) {
                            padronTable.push({ eleccion_id, votante_hash, creado_en });
                            return { success: true, meta: { changes: 1 } };
                        }
                        return { success: true, meta: { changes: 0 } };
                    } else if (sql.includes("INSERT INTO admin_acciones")) {
                        return { success: true, meta: { changes: 1 } };
                    }
                    return { success: true, meta: { changes: 1 } };
                },
                async all<T = any>() {
                    if (sql.includes("FROM elecciones WHERE id = ?")) {
                        return { results: eleccionesTable.filter((e) => e.id === bound[0]) as T[] };
                    }
                    if (sql.includes("FROM elecciones")) {
                        return {
                            results: eleccionesTable.map((e) => ({
                                id: e.id,
                                censo_tipo: e.censo_tipo,
                                ponderar_no_verificados: 1,
                            })) as T[],
                        };
                    }
                    if (sql.includes("SELECT block_hash FROM urna WHERE eleccion_id = ?")) {
                        const matching = urnaTable.filter((u) => u.eleccion_id === bound[0]);
                        return {
                            results: (matching.length
                                ? [{ block_hash: matching[matching.length - 1].block_hash }]
                                : []) as T[],
                        };
                    }
                    if (sql.includes("FROM urna WHERE eleccion_id = ?")) {
                        return { results: urnaTable.filter((u) => u.eleccion_id === bound[0]) as T[] };
                    }
                    if (sql.includes("FROM urna")) {
                        return { results: [...urnaTable] as T[] };
                    }
                    return { results: [] as T[] };
                },
            };
        },
        _urna: urnaTable,
        _elecciones: eleccionesTable,
        _padron: padronTable,
    };

    return { PADRON_KV, URNA_D1 };
}

describe("VotASO (Astro + TypeScript) — Criptografía, Censo y OAuth Agnóstico", () => {
  it("1. La doble verificación SOLO se aplica si el OAuth es VerificASO", () => {
    const cfgVerificaso = getConfig({
      OAUTH_AUTH_URL: "https://verificaso.aedm.org.es/oauth/authorize",
      OAUTH_USERINFO_URL: "https://verificaso.aedm.org.es/api/oauth/userinfo",
    });
    expect(cfgVerificaso.enableDoubleVerification).toBe(true);

    const unaCuenta = normalizeVoterIdentity(
      {
        sub: "u-1",
        email: "uno@esdmadrid.es",
        email_esd: "uno@esdmadrid.es",
        id_educamadrid: null,
        es_socio: true,
      },
      cfgVerificaso,
    );
    expect(unaCuenta.fiabilidad).toBe("ordinario");

    const dosCuentas = normalizeVoterIdentity(
      {
        sub: "u-2",
        email: "dos@esdmadrid.es",
        email_esd: "dos@esdmadrid.es",
        id_educamadrid: "dos.educa",
        es_socio: true,
      },
      cfgVerificaso,
    );
    expect(dosCuentas.fiabilidad).toBe("muy_fiable");

    // Organización externa que NO usa VerificASO
    const cfgExterna = getConfig({
      OAUTH_AUTH_URL: "https://sso.universidad.edu/oauth/authorize",
      OAUTH_USERINFO_URL: "https://sso.universidad.edu/oauth/userinfo",
    });
    expect(cfgExterna.enableDoubleVerification).toBe(false);

    const votanteExterno = normalizeVoterIdentity(
      { sub: "ext-99", email: "ana@universidad.edu", es_socio: true },
      cfgExterna,
    );
    expect(votanteExterno.hasDoubleAccount).toBe(true);
    expect(votanteExterno.fiabilidad).toBe("muy_fiable");
  });

  it("2. Impide votar dos veces (PADRON_KV), mantiene anonimato total en D1 y encadena Hash-Chain", async () => {
    const { PADRON_KV, URNA_D1 } = createMockBindings();
    const cfg = getConfig({
      SECRET_SALT: "test-salt-2026",
      OAUTH_AUTH_URL: "https://verificaso.aedm.org.es/oauth/authorize",
    });

    const votanteDoble = normalizeVoterIdentity(
      {
        sub: "id-socia-1",
        email: "socia@esdmadrid.es",
        email_esd: "socia@esdmadrid.es",
        id_educamadrid: "socia.educa",
        es_socio: true,
      },
      cfg,
    );

    const r1 = await procesarVoto({
      voter: votanteDoble,
      eleccionId: "general",
      opcionSeleccionada: "Candidato A",
      cfg,
      PADRON_KV,
      URNA_D1,
    });
    expect(r1.status).toBe(200);
    expect(r1.body.fiabilidad).toBe("muy_fiable");
    expect(r1.body.ticket).toHaveLength(16);

    // Intento de doble voto -> rechazado por PADRON_KV (400)
    const rDup = await procesarVoto({
      voter: votanteDoble,
      eleccionId: "general",
      opcionSeleccionada: "Candidato B",
      cfg,
      PADRON_KV,
      URNA_D1,
    });
    expect(rDup.status).toBe(400);

    // Segundo votante con una sola cuenta -> Voto Ordinario
    const votanteSimple = normalizeVoterIdentity(
      {
        sub: "id-socio-2",
        email: "simple@educa.madrid.org",
        id_educamadrid: "simple",
        es_socio: true,
      },
      cfg,
    );
    const r2 = await procesarVoto({
      voter: votanteSimple,
      eleccionId: "general",
      opcionSeleccionada: "Candidato A",
      cfg,
      PADRON_KV,
      URNA_D1,
    });
    expect(r2.status).toBe(200);
    expect(r2.body.fiabilidad).toBe("ordinario");

    // La urna D1 jamás contiene el correo ni el sub del votante
    const rawUrna = JSON.stringify(URNA_D1._urna);
    expect(rawUrna).not.toContain("socia@esdmadrid.es");
    expect(rawUrna).not.toContain("id-socia-1");
    expect(rawUrna).not.toContain("simple@educa.madrid.org");

    // Auditoría pública y cadena de bloques íntegra
    const audit = await auditarUrna({ URNA_D1, cfg });
    expect(audit.resumen.verificacion_blockchain.cadena_integra).toBe(true);
    expect(audit.resumen.verificacion_blockchain.total_papeletas).toBe(2);
    expect(audit.resumen.verificacion_blockchain.votos_muy_fiables_doble_cuenta).toBe(1);
    expect(audit.resumen.verificacion_blockchain.votos_ordinarios_una_cuenta).toBe(1);
    expect(audit.resumen.escrutinio["Candidato A"]).toEqual({
      total: 2,
      muy_fiable: 1,
      ordinario: 1,
      puntos: 1.5,
    });

    // Verificación matemática del recibo firmado P2P
    const recalcHash = await computeVoteBlockHash({
      prev_hash: r1.body.prev_hash,
      eleccion_id: r1.body.eleccion_id,
      opcion: r1.body.opcion,
      fiabilidad: r1.body.fiabilidad,
      ticket_verificacion: r1.body.ticket,
      timestamp: r1.body.timestamp,
    });
    expect(recalcHash).toBe(r1.body.block_hash);
    const recalcSig = await signVoteReceipt(
      cfg.secretSalt,
      recalcHash,
      r1.body.ticket,
      r1.body.eleccion_id,
      r1.body.opcion,
      r1.body.fiabilidad,
      r1.body.timestamp,
    );
    expect(recalcSig).toBe(r1.body.signature);
  });

  it("3. Respeta el censo de cada elección: solo_socios vs registrados", async () => {
    const { PADRON_KV, URNA_D1 } = createMockBindings();
    const cfg = getConfig({ SECRET_SALT: "test-salt-2026" });

    // Insertamos una elección solo para socios
    await URNA_D1.prepare("INSERT INTO elecciones VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        "asamblea-socios",
        "Asamblea de Socios",
        "Solo socios",
        JSON.stringify(["Sí", "No"]),
        "solo_socios",
        Date.now(),
        null,
        "lucas.peinado@esdmadrid.es",
        Date.now(),
      )
      .run();

    const registradoNoSocio = normalizeVoterIdentity(
      { sub: "u-reg", email: "alumno@esdmadrid.es", es_socio: false },
      cfg,
    );
    const resNoSocio = await procesarVoto({
      voter: registradoNoSocio,
      eleccionId: "asamblea-socios",
      opcionSeleccionada: "Sí",
      cfg,
      PADRON_KV,
      URNA_D1,
    });
    expect(resNoSocio.status).toBe(403);

    const socioPleno = normalizeVoterIdentity(
      { sub: "u-soc", email: "socio@esdmadrid.es", es_socio: true },
      cfg,
    );
    const resSocio = await procesarVoto({
      voter: socioPleno,
      eleccionId: "asamblea-socios",
      opcionSeleccionada: "Sí",
      cfg,
      PADRON_KV,
      URNA_D1,
    });
    expect(resSocio.status).toBe(200);
  });

  it("4. Renderiza el contexto descriptivo Markdown de cada votación sanitizando XSS", () => {
      const html = renderElectionMarkdown(
          "### Contexto de la votación\n\nSe vota el **presupuesto anual**.\n\n- Punto 1\n- [Ver documento](https://aedm.org.es)\n\n<script>alert(1)</script>",
      );
      expect(html).toContain("<h3>Contexto de la votación</h3>");
      expect(html).toContain("<strong>presupuesto anual</strong>");
      expect(html).toContain('target="_blank"');
      expect(html).not.toContain("<script>");
  });

  it("5. La barrera atómica de D1 impide el doble voto aunque KV se vacíe", async () => {
      const { PADRON_KV, URNA_D1 } = createMockBindings();
      const cfg = getConfig({ SECRET_SALT: "test-salt-2026" });

      const votante = normalizeVoterIdentity(
          { sub: "id-atomico-1", email: "atomica@esdmadrid.es", es_socio: true },
          cfg,
      );

      const r1 = await procesarVoto({
          voter: votante,
          eleccionId: "general",
          opcionSeleccionada: "Candidato A",
          cfg,
          PADRON_KV,
          URNA_D1,
      });
      expect(r1.status).toBe(200);

      // Simulamos que la comprobación rápida de KV se ha vaciado (TTL expirado,
      // caché inconsistente...). La barrera atómica de D1 debe seguir bloqueando.
      PADRON_KV._store.clear();

      const r2 = await procesarVoto({
          voter: votante,
          eleccionId: "general",
          opcionSeleccionada: "Candidato B",
          cfg,
          PADRON_KV,
          URNA_D1,
      });
      expect(r2.status).toBe(400);
      expect(URNA_D1._urna).toHaveLength(1);
  });

  it("6. Impide el redirect abierto en el retorno del login OAuth", () => {
      expect(isSafeInternalPath("/admin")).toBe(true);
      expect(isSafeInternalPath("/votar?x=1")).toBe(true);

      expect(isSafeInternalPath("//evil.com")).toBe(false);
      expect(isSafeInternalPath("/\\evil.com")).toBe(false);
      expect(isSafeInternalPath("https://evil.com")).toBe(false);
      expect(isSafeInternalPath("http://evil.com")).toBe(false);
      expect(isSafeInternalPath("/ruta\\con\\barra")).toBe(false);
      expect(isSafeInternalPath("/ruta\r\nSet-Cookie: x=1")).toBe(false);
      expect(isSafeInternalPath("")).toBe(false);
  });

  it("7. La comparación de firmas no filtra por longitud ni por tiempo", () => {
      expect(timingSafeEqual("abc", "abc")).toBe(true);
      expect(timingSafeEqual("abc", "abd")).toBe(false);
      expect(timingSafeEqual("abc", "abcd")).toBe(false);
      expect(timingSafeEqual("", "")).toBe(true);
      expect(timingSafeEqual("a", "")).toBe(false);
  });

  it("8. Las cabeceras de identidad están desactivadas por defecto", () => {
      const cfgPorDefecto = getConfig({});
      expect(cfgPorDefecto.trustIdentityHeaders).toBe(false);
      expect(cfgPorDefecto.identityHeadersSecret).toBe("");

      const cfgHabilitada = getConfig({ TRUST_IDENTITY_HEADERS: "true" });
      expect(cfgHabilitada.trustIdentityHeaders).toBe(true);
  });

      it("9. Oculta el censo de socios si el proveedor no devuelve claims de pertenencia", () => {
          const cfg = getConfig({ OAUTH_AUTH_URL: "https://sso.universidad.edu/oauth/authorize" });

          // Proveedor SIN claims de pertenencia: el censo de socios no se ofrece.
          const sinClaims = normalizeVoterIdentity(
              { sub: "u-1", email: "ana@universidad.edu" },
              cfg,
          );
          expect(sinClaims.tieneClaimsDePertenencia).toBe(false);
          expect(censusSociosDisponible(cfg, sinClaims.tieneClaimsDePertenencia)).toBe(false);

          // Proveedor CON claims de pertenencia: el censo de socios sí se ofrece.
          const conClaims = normalizeVoterIdentity(
              { sub: "u-2", email: "beto@universidad.edu", es_socio: true },
              cfg,
          );
          expect(conClaims.tieneClaimsDePertenencia).toBe(true);
          expect(censusSociosDisponible(cfg, conClaims.tieneClaimsDePertenencia)).toBe(true);

          // El modo "never" desactiva el censo aunque el proveedor sí lo sostenga.
          const cfgNever = getConfig({
              OAUTH_MEMBERSHIP_MODE: "never",
              OAUTH_AUTH_URL: "https://sso.universidad.edu/oauth/authorize",
          });
          expect(censusSociosDisponible(cfgNever, true)).toBe(false);

          // El modo "always" lo habilita explícitamente.
          const cfgAlways = getConfig({
              OAUTH_MEMBERSHIP_MODE: "always",
              OAUTH_AUTH_URL: "https://sso.universidad.edu/oauth/authorize",
          });
          expect(censusSociosDisponible(cfgAlways, false)).toBe(true);
      });

      it("10. Un proveedor sin capacidad de socios no bloquea una votación de socios", async () => {
          const { PADRON_KV, URNA_D1 } = createMockBindings();
          const cfg = getConfig({
              SECRET_SALT: "test-salt-2026",
              OAUTH_AUTH_URL: "https://sso.universidad.edu/oauth/authorize",
          });

          // Votación declarada de socios, pero el proveedor no distingue socios.
          await URNA_D1.prepare("INSERT INTO elecciones VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .bind(
                  "asamblea-general",
                  "Asamblea General",
                  "Sin capacidad de socios",
                  JSON.stringify(["Sí", "No"]),
                  "solo_socios",
                  "abierta",
                  Date.now(),
                  null,
                  "admin@ejemplo.org",
                  Date.now(),
              )
              .run();

          const registrado = normalizeVoterIdentity(
              { sub: "u-reg-2", email: "alumno@universidad.edu" },
              cfg,
          );
          expect(registrado.esSocio).toBe(false);

          // Sin degradar el censo, el voto se rechazaría con 403.
          const res = await procesarVoto({
              voter: registrado,
              eleccionId: "asamblea-general",
              opcionSeleccionada: "Sí",
              cfg,
              PADRON_KV,
              URNA_D1,
          });
          expect(res.status).toBe(200);
      });

      it("11. El recuento pondera los votos: el ordinario vale la mitad", async () => {
          const { PADRON_KV, URNA_D1 } = createMockBindings();
          const cfg = getConfig({
              SECRET_SALT: "test-salt-2026",
              OAUTH_AUTH_URL: "https://verificaso.aedm.org.es/oauth/authorize",
          });

          // Un voto muy fiable y uno ordinario, a favor de la misma opción.
          const fiable = normalizeVoterIdentity(
              {
                  sub: "id-fiable",
                  email: "fiable@esdmadrid.es",
                  email_esd: "fiable@esdmadrid.es",
                  id_educamadrid: "fiable.educa",
                  es_socio: true,
              },
              cfg,
          );
          const ordinario = normalizeVoterIdentity(
              { sub: "id-ord", email: "ord@esdmadrid.es", es_socio: true },
              cfg,
          );

          await procesarVoto({
              voter: fiable,
              eleccionId: "general",
              opcionSeleccionada: "Candidato A",
              cfg,
              PADRON_KV,
              URNA_D1,
          });
          await procesarVoto({
              voter: ordinario,
              eleccionId: "general",
              opcionSeleccionada: "Candidato A",
              cfg,
              PADRON_KV,
              URNA_D1,
          });

          const audit = await auditarUrna({ URNA_D1, cfg });
          const opcionA = audit.resumen.escrutinio["Candidato A"]!;

          // 2 papeletas, pero 1 + 0.5 = 1.5 puntos.
          expect(opcionA.total).toBe(2);
          expect(opcionA.muy_fiable).toBe(1);
          expect(opcionA.ordinario).toBe(1);
          expect(opcionA.puntos).toBe(1.5);
          expect(audit.resumen.verificacion_blockchain.total_puntos).toBe(1.5);
      });

      it("12. Las votaciones de socios NO se ponderan: todos los votos valen 1", async () => {
          const { PADRON_KV, URNA_D1 } = createMockBindings();
          const cfg = getConfig({
              SECRET_SALT: "test-salt-2026",
              OAUTH_AUTH_URL: "https://verificaso.aedm.org.es/oauth/authorize",
          });

          await URNA_D1.prepare("INSERT INTO elecciones VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .bind(
                  "asamblea-socios-pond",
                  "Asamblea de Socios",
                  "Censo acotado",
                  JSON.stringify(["Sí", "No"]),
                  "solo_socios",
                  "abierta",
                  Date.now(),
                  null,
                  "admin@ejemplo.org",
                  Date.now(),
              )
              .run();

          const ordinario = normalizeVoterIdentity(
              { sub: "id-ord-2", email: "ord2@esdmadrid.es", es_socio: true },
              cfg,
          );
          await procesarVoto({
              voter: ordinario,
              eleccionId: "asamblea-socios-pond",
              opcionSeleccionada: "Sí",
              cfg,
              PADRON_KV,
              URNA_D1,
          });

          const audit = await auditarUrna({ URNA_D1, cfg });
          const opcionSi = audit.resumen.escrutinio["Sí"]!;

          // Aunque el voto sea «ordinario», en un censo de socios vale 1 punto.
          expect(opcionSi.total).toBe(1);
          expect(opcionSi.ordinario).toBe(1);
          expect(opcionSi.puntos).toBe(1);
      });

      it("13. Los pesos del recuento son configurables y están acotados", () => {
          const cfgPorDefecto = getConfig({});
          expect(cfgPorDefecto.pesoVotoFiable).toBe(1);
          expect(cfgPorDefecto.pesoVotoOrdinario).toBe(0.5);

          const cfgCustom = getConfig({
              VOTO_PESO_FIABLE: "2",
              VOTO_PESO_ORDINARIO: "0.25",
          });
          expect(cfgCustom.pesoVotoFiable).toBe(2);
          expect(cfgCustom.pesoVotoOrdinario).toBe(0.25);

          // Un valor absurdo queda acotado en lugar de romper el escrutinio.
          const cfgAbsurdo = getConfig({ VOTO_PESO_ORDINARIO: "9999" });
          expect(cfgAbsurdo.pesoVotoOrdinario).toBe(100);

          // Un valor no numérico cae al valor por defecto.
          const cfgInvalido = getConfig({ VOTO_PESO_ORDINARIO: "mucho" });
          expect(cfgInvalido.pesoVotoOrdinario).toBe(0.5);
      });

      it("14. SECRET_SALT es obligatoria en producción", () => {
          // En producción, sin sal, la aplicación se niega a arrancar.
          expect(() =>
              getConfig({ ENVIRONMENT: "production" }),
          ).toThrow(/SECRET_SALT/);

          // Con sal suficiente, arranca con normalidad.
          const cfg = getConfig({
              ENVIRONMENT: "production",
              SECRET_SALT: "a".repeat(64),
          });
          expect(cfg.secretSalt).toHaveLength(64);

          // Una sal demasiado corta también se rechaza en producción.
          expect(() =>
              getConfig({ ENVIRONMENT: "production", SECRET_SALT: "corta" }),
          ).toThrow(/demasiado corta/);

          // En desarrollo se permite, con valor por defecto.
          const cfgDev = getConfig({});
          expect(cfgDev.secretSalt.length).toBeGreaterThan(0);
      });

      it("15. El dominio de correo no admite sufijos suplantados", () => {
          // Un dominio atacante que TERMINA en el dominio legítimo no cuela.
          expect(dominioCoincide("ana@esdmadrid.es", "esdmadrid.es")).toBe(true);
          expect(dominioCoincide("ana@esdmadrid.es", "@esdmadrid.es")).toBe(true);
          expect(dominioCoincide("ana@ESDMADRID.ES", "esdmadrid.es")).toBe(true);

          expect(dominioCoincide("malo@atacante-esdmadrid.es", "esdmadrid.es")).toBe(false);
          expect(dominioCoincide("malo@esdmadrid.es.atacante.com", "esdmadrid.es")).toBe(false);
          expect(dominioCoincide("malo@otro.org", "esdmadrid.es")).toBe(false);
          expect(dominioCoincide("sin-dominio", "esdmadrid.es")).toBe(false);
      });

      it("16. Las cookies de sesión usan el prefijo __Host- en HTTPS", () => {
          expect(nombreCookieSesion(true)).toBe("__Host-votaso_session");
          expect(nombreCookieSesion(false)).toBe("votaso_session");
          expect(nombreCookieEstado(true)).toBe("__Host-votaso_oauth");
          expect(nombreCookieEstado(false)).toBe("votaso_oauth");
      });

      it("17. La clave del padrón distingue identificadores con distinta capitalización", async () => {
          // El `sub` de OAuth es sensible a mayúsculas: dos identificadores que
          // solo difieren en caja son dos electors distintos.
          const claveA = await buildPadronKey("general", "AbC", "sal");
          const claveB = await buildPadronKey("general", "abc", "sal");
          expect(claveA).not.toBe(claveB);

          // El mismo elector genera siempre la misma clave.
          const claveRepetida = await buildPadronKey("general", "AbC", "sal");
          expect(claveA).toBe(claveRepetida);
      });
  });
