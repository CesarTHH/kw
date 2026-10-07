import { describe, expect, it } from "vitest";
import { composicion, precioUnitario, soles, type Precios } from "./tipos";

const precios: Precios = {
  estandar_precio: 29.78,
  estandar_items: [
    { producto_id: "s", cantidad: 2 },
    { producto_id: "f", cantidad: 2 },
  ],
  productos: [
    { id: "s", nombre: "SANDWICH", precio: 8 },
    { id: "f", nombre: "FRUTA", precio: 1.5 },
    { id: "g", nombre: "GASEOSA", precio: 3 },
  ],
};

describe("refrigerios", () => {
  it("precio por refrigerio", () => {
    expect(precioUnitario({ tipo: "estandar", items: [] }, precios)).toBe(29.78);
    expect(precioUnitario({ tipo: "estandar_mas_especial", items: [{ producto_id: "f", cantidad: 5 }] }, precios)).toBe(37.28);
    expect(precioUnitario({ tipo: "especial", items: [{ producto_id: "g", cantidad: 2 }] }, precios)).toBe(6);
    expect(precioUnitario({ tipo: "estandar", items: [] }, { ...precios, estandar_precio: null })).toBeNull();
  });
  it("composición sumando estándar y especiales", () => {
    expect(composicion({ tipo: "estandar_mas_especial", items: [{ producto_id: "f", cantidad: 5 }] }, precios)).toBe("2 SANDWICH\n7 FRUTA");
    expect(composicion({ tipo: "especial", items: [{ producto_id: "g", cantidad: 1 }] }, precios)).toBe("1 GASEOSA");
  });
  it("formato de soles", () => {
    expect(soles(119.12)).toBe("S/ 119,12");
  });
});
