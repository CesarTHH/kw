import { describe, expect, it } from "vitest";
import { esRutaPublica, rutaSegura } from "./rutas";

describe("rutaSegura", () => {
  it("acepta rutas internas", () => {
    expect(rutaSegura("/raciones")).toBe("/raciones");
    expect(rutaSegura("/raciones/consulta?desde=2026-10-01")).toBe("/raciones/consulta?desde=2026-10-01");
  });
  it("usa la ruta por defecto si no hay destino", () => {
    expect(rutaSegura(null)).toBe("/menu");
    expect(rutaSegura("")).toBe("/menu");
    expect(rutaSegura(undefined, "/inicio")).toBe("/inicio");
  });
  it("bloquea redirecciones a otros sitios", () => {
    expect(rutaSegura("https://evil.com")).toBe("/menu");
    expect(rutaSegura("//evil.com")).toBe("/menu");
    expect(rutaSegura("/\\evil.com")).toBe("/menu");
    expect(rutaSegura("javascript:alert(1)")).toBe("/menu");
    expect(rutaSegura("/ok\nSet-Cookie: x")).toBe("/menu");
  });
  it("no redirige de vuelta a páginas públicas", () => {
    expect(rutaSegura("/login")).toBe("/menu");
    expect(rutaSegura("/")).toBe("/menu");
    expect(rutaSegura("/salir")).toBe("/menu");
  });
  it("rechaza destinos demasiado largos", () => {
    expect(rutaSegura("/" + "a".repeat(300))).toBe("/menu");
  });
});

describe("esRutaPublica", () => {
  it("reconoce las rutas públicas", () => {
    expect(esRutaPublica("/")).toBe(true);
    expect(esRutaPublica("/login")).toBe(true);
    expect(esRutaPublica("/auth/confirm")).toBe(true);
  });
  it("no confunde rutas privadas", () => {
    expect(esRutaPublica("/menu")).toBe(false);
    expect(esRutaPublica("/loginx")).toBe(false);
    expect(esRutaPublica("/admin/roles")).toBe(false);
  });
});
