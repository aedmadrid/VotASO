/// <reference types="astro/client" />

export interface KVNamespaceBinding {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface D1PreparedStatementBinding {
  bind(...values: unknown[]): D1PreparedStatementBinding;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
  all<T = Record<string, any>>(): Promise<{ results: T[] }>;
}

export interface D1DatabaseBinding {
  prepare(query: string): D1PreparedStatementBinding;
}

export interface VoterIdentity {
  sub: string;
  email: string;
  nombre: string;
  esSocio: boolean;
  nivelMiembro: string;
  hasDoubleAccount: boolean;
  fiabilidad: "muy_fiable" | "ordinario";
  isAdmin: boolean;
  /**
   * Indica si el proveedor OAuth devolvió algún claim de pertenencia a la
   * organización. Si es `false`, el despliegue no puede sostener un censo
   * `solo_socios` y el censo efectivo es `registrados`.
   */
  tieneClaimsDePertenencia?: boolean;
}

declare namespace App {
  interface Locals {
    voter: VoterIdentity | null;
  }
}
