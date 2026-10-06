import { describe, expect, it } from "vitest";
import { esUuid, filtroOr, numeroPagina, rango, terminoBusqueda, urlCon } from "./busqueda";
import { aCsv, celdaCsv } from "./csv";

describe("terminoBusqueda", () => {
  it("quita caracteres que alteran los filtros de PostgREST", () => {
    expect(terminoBusqueda("abc),id.eq.1,(x")).toBe("abc id.eq.1 x");
    expect(terminoBusqueda("a*b%c'\"d")).toBe("a b c d");
  });
  it("conserva tildes, ñ, correos y RUC", () => {
    expect(terminoBusqueda("  Peña  Ñandú ")).toBe("Peña Ñandú");
    expect(terminoBusqueda("ana@kw.pe")).toBe("ana@kw.pe");
    expect(terminoBusqueda("20999999019")).toBe("20999999019");
  });
  it("acepta solo texto y limita el largo", () => {
    expect(terminoBusqueda(undefined)).toBe("");
    expect(terminoBusqueda(["x"])).toBe("");
    expect(terminoBusqueda("x".repeat(100))).toHaveLength(60);
  });
  it("arma el filtro or sin comas extra", () => {
    expect(filtroOr(["ruc", "razon_social"], "a,b")).toBe("ruc.ilike.*a b*,razon_social.ilike.*a b*");
  });
});

describe("paginación", () => {
  it("normaliza la página", () => {
    expect(numeroPagina("3")).toBe(3);
    expect(numeroPagina("-1")).toBe(1);
    expect(numeroPagina("abc")).toBe(1);
    expect(numeroPagina(undefined)).toBe(1);
  });
  it("calcula el rango", () => {
    expect(rango(1, 25)).toEqual([0, 24]);
    expect(rango(3, 10)).toEqual([20, 29]);
  });
  it("arma URLs sin parámetros vacíos", () => {
    expect(urlCon("/x", { q: "a b", p: 2, id: "" })).toBe("/x?q=a+b&p=2");
    expect(urlCon("/x", {})).toBe("/x");
  });
  it("reconoce UUID", () => {
    expect(esUuid("8f14e45f-ceea-467a-9575-1b2c3d4e5f60")).toBe(true);
    expect(esUuid("nuevo")).toBe(false);
  });
});

describe("CSV", () => {
  it("neutraliza fórmulas", () => {
    expect(celdaCsv("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(celdaCsv("-5")).toBe("'-5");
    expect(celdaCsv("@x")).toBe("'@x");
  });
  it("escapa separadores y comillas", () => {
    expect(celdaCsv('a;"b"')).toBe('"a;""b"""');
    expect(celdaCsv(true)).toBe("Sí");
    expect(celdaCsv(null)).toBe("");
  });
  it("genera el archivo con BOM", () => {
    const csv = aCsv([{ a: 1 }], [{ titulo: "A", valor: (f) => f.a }]);
    expect(csv).toBe("﻿A\r\n1\r\n");
  });
});
