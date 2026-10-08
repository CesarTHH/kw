import { describe, expect, it } from "vitest";
import { tipoArchivo } from "./archivos";
import { analizar, type Actual } from "./plan";
import { booleano, clave, fechaDmy, fechaSerie, instanteSerie, leerCsv, monto, ruc } from "./texto";
import { celdasDeFila, indiceColumna } from "./xlsx";

const vacio: Actual = { proyectos: [], areas: [], frentes: [], empresas: [], contactos: [], comedores: [], servicios: [], tarifas: [] };
const csv = (nombre: string, filas: string[][]) => ({
  nombre,
  bytes: Buffer.from("﻿" + filas.map((f) => f.map((c) => `"${c}"`).join(",")).join("\r\n"), "utf8"),
});

describe("limpieza de datos", () => {
  it("compara nombres sin tildes ni espacios de más", () => {
    expect(clave("  Iluminación   LQ ")).toBe("ILUMINACION LQ");
    expect(clave("KM 52")).toBe("KM 52");
  });
  it("reconoce los booleanos del maestro", () => {
    expect(booleano("Verdadero")).toBe(true);
    expect(booleano("Inactivo")).toBe(false);
    expect(booleano("quizás")).toBeNull();
  });
  it("lee fechas d/mm/aaaa y números de serie de Excel", () => {
    expect(fechaDmy("1/08/2022")).toBe("2022-08-01");
    expect(fechaDmy("31/02/2022")).toBeNull();
    expect(fechaSerie(45658)).toBe("2025-01-01");
    // 13/12/2024 11:30 en Lima = 16:30 UTC
    expect(instanteSerie(45639.479166666664)).toBe("2024-12-13T16:30:00.000Z");
  });
  it("montos y RUC", () => {
    expect(monto("24.07")).toBe(24.07);
    expect(monto("24,5")).toBe(24.5);
    expect(ruc("00000000000")).toBe("00000000000");
    expect(ruc("2049165161")).toBeNull();
  });
  it("lee CSV con comillas, comas y saltos dentro de una celda", () => {
    expect(leerCsv('﻿"A","B"\r\n"x, y","línea 1\nlínea 2"\r\n"z ""cita""",""\r\n')).toEqual([
      ["A", "B"],
      ["x, y", "línea 1\nlínea 2"],
      ['z "cita"', ""],
    ]);
  });
  it("reconoce los archivos por su nombre", () => {
    expect(tipoArchivo("MAESTRO DE ÁREAS v2.csv")).toBe("areas");
    expect(tipoArchivo("MAESTRO DE PROYECTO - CLIENTE v2.csv")).toBe("frentes");
    expect(tipoArchivo("MAESTRO DE PROYECTOS v2.csv")).toBe("proyectos");
    expect(tipoArchivo("DATA SOLICITUD v3.xlsx")).toBe("historial");
    expect(tipoArchivo("otro.pdf")).toBeNull();
  });
});

describe("lector de Excel", () => {
  it("lee celdas de texto compartido, números, booleanos y huecos", () => {
    const fila = '<c r="A2" s="7"><v>45658</v></c><c r="C2" t="s"><v>1</v></c><c r="D2" t="b"><v>1</v></c><c r="E2" t="inlineStr"><is><t>A &amp; B</t></is></c>';
    expect(celdasDeFila(fila, ["cero", "KM 37"])).toEqual([45658, null, "KM 37", true, "A & B"]);
    expect(indiceColumna("AB")).toBe(27);
  });
});

describe("simulación con los maestros", () => {
  it("cuenta lo nuevo, une frentes repetidos y avisa lo que falta", async () => {
    const r = await analizar(
      [
        csv("MAESTRO DE PROYECTOS v2.csv", [["NOMBRE PROYECTO", "ESTADO"], ["YANACOCHA", "Activo"]]),
        csv("MAESTRO DE ÁREAS v2.csv", [["NOMBRE AREA", "ESTADO"], ["PROCESOS", "Activo"]]),
        csv("MAESTRO DE PROYECTO - CLIENTE v2.csv", [
          ["PROYECTO", "ÁREA", "PROYECTO MENOR", "SPONSOR", "CONTRATO DESDE", "CONTRATO HASTA"],
          ["YANACOCHA", "PROCESOS", "LABORATORIO", "Ana", "1/08/2022", "31/10/2026"],
          ["YANACOCHA", "PROCESOS", "LABORATORIO ", "Ana", "1/01/2020", "31/12/2026"],
          ["SULFUROS", "PROCESOS", "KM52", "", "", ""],
        ]),
        csv("MAESTRO DE SERVICIOS v2.csv", [
          ["NOMBRE SERVICIO", "COSTO SERVICIO", "TIPO SERVICIO", "DESDE", "HASTA"],
          ["ALMUERZO", "24.07", "ALMUERZO", "1/04/2023", "30/04/2024"],
          ["ALMUERZO", "25.00", "ALMUERZO", "1/04/2024", "30/04/2025"],
        ]),
      ],
      { ...vacio, proyectos: [{ nombre: "YANACOCHA", activo: true }] },
      async () => 0,
    );
    expect(r.resumen.proyectos).toEqual({ nuevos: 1, existentes: 1 });
    expect(r.catalogos.frentes.find((f) => f.nombre === "LABORATORIO")).toMatchObject({ desde: "2020-01-01", hasta: "2026-12-31" });
    expect(r.catalogos.frentes).toHaveLength(2);
    expect(r.problemas.some((p) => p.motivo.includes('"SULFUROS" no está en el maestro'))).toBe(true);
    expect(r.errores).toBe(1); // la segunda tarifa de ALMUERZO se cruza con la primera
    expect(r.catalogos.tarifas).toHaveLength(1);
  });
});
