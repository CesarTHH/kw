import { describe, expect, it } from "vitest";
import { Limitador } from "./limitador";

describe("Limitador", () => {
  it("bloquea al superar el máximo dentro de la ventana", () => {
    const l = new Limitador(3, 60_000);
    expect(l.permitir("a", 0)).toBe(true);
    expect(l.permitir("a", 1)).toBe(true);
    expect(l.permitir("a", 2)).toBe(true);
    expect(l.permitir("a", 3)).toBe(false);
  });
  it("vuelve a permitir cuando pasa la ventana", () => {
    const l = new Limitador(1, 1_000);
    expect(l.permitir("a", 0)).toBe(true);
    expect(l.permitir("a", 500)).toBe(false);
    expect(l.permitir("a", 1_001)).toBe(true);
  });
  it("las claves son independientes y se pueden reiniciar", () => {
    const l = new Limitador(1, 60_000);
    expect(l.permitir("a", 0)).toBe(true);
    expect(l.permitir("b", 0)).toBe(true);
    expect(l.permitir("a", 1)).toBe(false);
    l.reiniciar("a");
    expect(l.permitir("a", 2)).toBe(true);
  });
});
