import { describe, expect, it } from "vitest";
import { cambioPasswordSchema, loginSchema, passwordSchema, rolNuevoSchema } from "./validaciones";

describe("passwordSchema", () => {
  it("acepta contraseñas que cumplen la política", () => {
    expect(passwordSchema.safeParse("Raciones2026").success).toBe(true);
  });
  it("rechaza contraseñas débiles", () => {
    expect(passwordSchema.safeParse("corta1A").success).toBe(false);
    expect(passwordSchema.safeParse("sinnumerosMAYUS").success).toBe(false);
    expect(passwordSchema.safeParse("sinmayusculas123").success).toBe(false);
    expect(passwordSchema.safeParse("SINMINUSCULAS123").success).toBe(false);
  });
});

describe("cambioPasswordSchema", () => {
  it("exige que la confirmación coincida", () => {
    expect(cambioPasswordSchema.safeParse({ password: "Raciones2026", confirmacion: "Raciones2027" }).success).toBe(false);
    expect(cambioPasswordSchema.safeParse({ password: "Raciones2026", confirmacion: "Raciones2026" }).success).toBe(true);
  });
});

describe("loginSchema", () => {
  it("normaliza el correo", () => {
    const r = loginSchema.safeParse({ correo: "  Usuario@Ejemplo.COM ", password: "x" });
    expect(r.success && r.data.correo).toBe("usuario@ejemplo.com");
  });
  it("rechaza correos inválidos", () => {
    expect(loginSchema.safeParse({ correo: "no-es-correo", password: "x" }).success).toBe(false);
  });
});

describe("rolNuevoSchema", () => {
  it("no permite crear otro superadmin", () => {
    expect(
      rolNuevoSchema.safeParse({ codigo: "superadmin", nombre: "X", alcance: "todas", requiere_mfa: true }).success,
    ).toBe(false);
  });
  it("valida el formato del código", () => {
    expect(rolNuevoSchema.safeParse({ codigo: "jefe_comedor", nombre: "Jefe", alcance: "comedor", requiere_mfa: false }).success).toBe(true);
    expect(rolNuevoSchema.safeParse({ codigo: "Jefe Comedor", nombre: "Jefe", alcance: "comedor", requiere_mfa: false }).success).toBe(false);
  });
});
