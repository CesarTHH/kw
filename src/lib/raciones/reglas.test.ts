import { describe, expect, it } from "vitest";
import { comedoresDestino, frenteVigente, ofreceServicio, servicioCompatible, serviciosDestino } from "./reglas";
import type { Catalogo } from "./tipos";

const c: Catalogo = {
  frentes: [{ id: "f1", nombre: "F1", proyecto_id: "p", proyecto: "P", area_id: "a", area: "A", desde: "2026-01-01", hasta: "2026-12-31" }],
  comedores: [
    { id: "km52", nombre: "KM 52", sector_id: "alta" },
    { id: "talleres", nombre: "TALLERES", sector_id: "alta" },
    { id: "km37", nombre: "KM 37", sector_id: "baja" },
  ],
  servicios: [
    { id: "alm", nombre: "ALMUERZO", tipo_servicio_id: "T-ALM", orden: 1 },
    { id: "almc", nombre: "ALMUERZO A CAMPO", tipo_servicio_id: "T-ALM", orden: 2 },
    { id: "cena", nombre: "CENA", tipo_servicio_id: "T-CENA", orden: 3 },
  ],
  comedorServicios: { km52: ["alm", "almc", "cena"], talleres: ["alm"], km37: ["alm"] },
  reglasSector: ["alta|alta", "baja|baja"],
  reglasServicio: { "cena|alm": true },
};

describe("reglas de raciones", () => {
  it("frente vigente según el contrato", () => {
    expect(frenteVigente(c, "f1", "2026-06-01")).toBe(true);
    expect(frenteVigente(c, "f1", "2027-01-01")).toBe(false);
    expect(frenteVigente(c, "x", "2026-06-01")).toBe(false);
  });
  it("servicios por comedor", () => {
    expect(ofreceServicio(c, "talleres", "alm")).toBe(true);
    expect(ofreceServicio(c, "talleres", "cena")).toBe(false);
  });
  it("traslados: mismo sector y servicio compatible", () => {
    expect(comedoresDestino(c, "km52").sort()).toEqual(["km52", "talleres"]);
    expect(servicioCompatible(c, "alm", "almc")).toBe(true);
    expect(servicioCompatible(c, "alm", "cena")).toBe(false);
    expect(servicioCompatible(c, "cena", "alm")).toBe(true); // regla explícita
    expect(serviciosDestino(c, "km52", "alm", "km52")).toEqual(["almc"]);
    expect(serviciosDestino(c, "km52", "alm", "talleres")).toEqual(["alm"]);
  });
});
