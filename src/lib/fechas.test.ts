import { describe, expect, it } from "vitest";
import { fechaHora, localAUtc, utcALocal } from "./fechas";

describe("zonas horarias", () => {
  it("Lima es UTC-5 todo el año", () => {
    expect(localAUtc("2026-10-15T08:30", "America/Lima")).toBe("2026-10-15T13:30:00.000Z");
    expect(localAUtc("2026-12-31T23:59", "America/Lima")).toBe("2027-01-01T04:59:00.000Z");
  });
  it("respeta el horario de verano de otras zonas", () => {
    expect(localAUtc("2026-07-01T12:00", "America/New_York")).toBe("2026-07-01T16:00:00.000Z");
    expect(localAUtc("2026-01-01T12:00", "America/New_York")).toBe("2026-01-01T17:00:00.000Z");
  });
  it("ida y vuelta", () => {
    expect(utcALocal("2026-10-15T13:30:00.000Z", "America/Lima")).toBe("2026-10-15T08:30");
    expect(fechaHora("2026-10-15T13:30:00+00:00", "America/Lima")).toBe("15/10/2026 08:30");
  });
  it("rechaza fechas inválidas", () => {
    expect(localAUtc("2026-02-30T10:00", "America/Lima")).toBeNull();
    expect(localAUtc("mañana", "America/Lima")).toBeNull();
  });
});
