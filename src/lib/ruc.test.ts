import { describe, expect, it } from "vitest";
import { rucValido } from "./ruc";

describe("rucValido", () => {
  it("acepta RUC con dígito verificador correcto", () => {
    expect(rucValido("20999999019")).toBe(true);
    expect(rucValido("20999999027")).toBe(true);
  });
  it("rechaza dígito verificador incorrecto", () => {
    expect(rucValido("20999999010")).toBe(false);
    expect(rucValido("00000000000")).toBe(false);
  });
  it("rechaza formatos inválidos", () => {
    expect(rucValido("2099999901")).toBe(false);
    expect(rucValido("209999990199")).toBe(false);
    expect(rucValido("2099999901a")).toBe(false);
    expect(rucValido("")).toBe(false);
  });
});
