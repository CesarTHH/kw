import { describe, expect, it } from "vitest";
import { ipCliente } from "./ip";

describe("ipCliente", () => {
  it("toma la IP agregada por el balanceador, no la enviada por el cliente", () => {
    expect(ipCliente("1.1.1.1, 200.1.2.3, 35.191.0.1")).toBe("200.1.2.3");
  });
  it("funciona con una sola IP (desarrollo)", () => {
    expect(ipCliente("127.0.0.1")).toBe("127.0.0.1");
  });
  it("sin cabecera", () => {
    expect(ipCliente(null)).toBe("sin-ip");
  });
});
