import { describe, expect, it } from "vitest";
import { hijos, menuPrincipal, puede, type ItemMenu } from "./permisos";

const menu: ItemMenu[] = [
  { codigo: "raciones", padre_codigo: null, nombre: "Raciones", icono: "utensils", ruta: "/raciones", orden: 20, acciones: ["ver"] },
  { codigo: "raciones.consulta", padre_codigo: "raciones", nombre: "Consulta", icono: null, ruta: "/raciones/consulta", orden: 22, acciones: ["ver", "exportar"] },
  { codigo: "raciones.programar", padre_codigo: "raciones", nombre: "Programar", icono: null, ruta: "/raciones/programar", orden: 23, acciones: ["ver", "enviar"] },
  { codigo: "contactanos", padre_codigo: null, nombre: "Contáctanos", icono: "mail", ruta: "/contactanos", orden: 60, acciones: ["ver"] },
  { codigo: "maestras", padre_codigo: null, nombre: "Maestras", icono: "database", ruta: "/maestras", orden: 10, acciones: ["ver"] },
];

describe("puede", () => {
  it("permite acciones asignadas", () => {
    expect(puede(menu, "raciones.consulta", "exportar")).toBe(true);
    expect(puede(menu, "raciones.programar", "enviar")).toBe(true);
  });
  it("niega acciones no asignadas o menús ausentes", () => {
    expect(puede(menu, "raciones.consulta", "enviar")).toBe(false);
    expect(puede(menu, "admin.roles")).toBe(false);
  });
  it("por defecto evalúa 'ver'", () => {
    expect(puede(menu, "contactanos")).toBe(true);
  });
});

describe("menuPrincipal", () => {
  it("devuelve solo el primer nivel ordenado", () => {
    expect(menuPrincipal(menu).map((m) => m.codigo)).toEqual(["maestras", "raciones", "contactanos"]);
  });
});

describe("hijos", () => {
  it("devuelve las pestañas de un menú", () => {
    expect(hijos(menu, "raciones").map((m) => m.codigo)).toEqual(["raciones.consulta", "raciones.programar"]);
  });
});
