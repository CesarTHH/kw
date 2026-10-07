import { describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO as cfg,
  configDesdeFilas,
  diaSemana,
  lunes,
  primeraFechaPermitida,
  rangoFechas,
  sumarDias,
  ultimaFechaProgramable,
  validarPlazo,
} from "./plazos";

const ok = { ok: true };

describe("calendario", () => {
  it("calcula lunes y día de la semana, también en cambios de mes y año", () => {
    expect(diaSemana("2026-10-07")).toBe(3); // miércoles
    expect(diaSemana("2026-10-11")).toBe(7); // domingo
    expect(lunes("2026-10-11")).toBe("2026-10-05");
    expect(lunes("2027-01-01")).toBe("2026-12-28");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(rangoFechas("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("adiciones: hasta las 17:00 del día anterior", () => {
  it("bordes 16:59:59 y 17:00:00", () => {
    expect(validarPlazo("adicion", "2026-10-15", "2026-10-14T16:59:59", cfg)).toEqual(ok);
    expect(validarPlazo("adicion", "2026-10-15", "2026-10-14T17:00:00", cfg)).toEqual({
      ok: false,
      motivo: "El plazo para adicionales del 15/10 venció el 14/10 a las 17:00",
    });
  });
  it("cambio de mes y de año", () => {
    expect(validarPlazo("adicion", "2026-11-01", "2026-10-31T16:00", cfg).ok).toBe(true);
    expect(validarPlazo("adicion", "2027-01-01", "2026-12-31T17:30", cfg).ok).toBe(false);
  });
  it("el mismo día ya no se puede", () => {
    expect(validarPlazo("adicion", "2026-10-14", "2026-10-14T08:00", cfg).ok).toBe(false);
  });
});

describe("reducciones y traslados: 48 horas antes del inicio del día", () => {
  it("bordes", () => {
    // Día D = 15/10 → límite: 13/10 00:00 (último minuto permitido: 12/10 23:59)
    expect(validarPlazo("reduccion", "2026-10-15", "2026-10-12T23:59:59", cfg)).toEqual(ok);
    expect(validarPlazo("reduccion", "2026-10-15", "2026-10-13T00:00:00", cfg)).toEqual({
      ok: false,
      motivo: "El plazo para reducir el 15/10 venció el 12/10 a las 23:59",
    });
    expect(validarPlazo("traslado", "2027-01-02", "2026-12-30T23:00", cfg).ok).toBe(true);
    expect(validarPlazo("traslado", "2027-01-02", "2026-12-31T00:00", cfg).ok).toBe(false);
  });
  it("usa las horas configuradas", () => {
    const c24 = { ...cfg, horasReduccion: 24 };
    expect(validarPlazo("reduccion", "2026-10-15", "2026-10-13T12:00", c24).ok).toBe(true);
    expect(validarPlazo("reduccion", "2026-10-15", "2026-10-14T00:00", c24).ok).toBe(false);
  });
});

describe("programación semanal", () => {
  // Miércoles 07/10/2026. Semana siguiente: lunes 12/10 a domingo 18/10.
  it("la semana siguiente se programa hasta el miércoles 23:59", () => {
    expect(validarPlazo("programacion", "2026-10-12", "2026-10-07T23:59:59", cfg)).toEqual(ok);
    expect(validarPlazo("programacion", "2026-10-18", "2026-10-07T23:59:00", cfg)).toEqual(ok);
    expect(validarPlazo("programacion", "2026-10-12", "2026-10-08T00:00:00", cfg)).toEqual({
      ok: false,
      motivo: "La programación de la semana del 12/10 cerró el miércoles 07/10 a las 23:59: usa Adiciona / Reduce",
    });
  });
  it("la semana en curso no se programa", () => {
    expect(validarPlazo("programacion", "2026-10-09", "2026-10-05T08:00", cfg).ok).toBe(false);
  });
  it("la semana subsiguiente sigue abierta después del cierre", () => {
    expect(validarPlazo("programacion", "2026-10-19", "2026-10-08T10:00", cfg)).toEqual(ok);
  });
  it("máximo 6 semanas (hasta el domingo de la 6.ª semana)", () => {
    expect(validarPlazo("programacion", "2026-11-22", "2026-10-07T10:00", cfg)).toEqual(ok);
    expect(validarPlazo("programacion", "2026-11-23", "2026-10-07T10:00", cfg)).toEqual({
      ok: false,
      motivo: "Solo se puede programar hasta el 22/11 (6 semanas)",
    });
    expect(ultimaFechaProgramable("2026-10-07T10:00", cfg)).toBe("2026-11-22");
  });
  it("fechas pasadas", () => {
    expect(validarPlazo("programacion", "2026-10-01", "2026-10-07T10:00", cfg)).toEqual({ ok: false, motivo: "El 01/10 ya pasó" });
  });
  it("fin de año", () => {
    // Martes 29/12/2026: la semana siguiente empieza el lunes 04/01/2027.
    expect(validarPlazo("programacion", "2027-01-04", "2026-12-29T12:00", cfg).ok).toBe(true);
    expect(validarPlazo("programacion", "2027-01-04", "2026-12-31T00:00", cfg).ok).toBe(false);
  });
  it("con semana en curso permitida aplica el plazo de adiciones", () => {
    const c = { ...cfg, permiteSemanaEnCurso: true };
    expect(validarPlazo("programacion", "2026-10-08", "2026-10-07T16:00", c).ok).toBe(true);
    expect(validarPlazo("programacion", "2026-10-08", "2026-10-07T17:00", c).ok).toBe(false);
  });
  it("primera fecha permitida", () => {
    expect(primeraFechaPermitida("programacion", "2026-10-07T10:00", cfg)).toBe("2026-10-12");
    expect(primeraFechaPermitida("programacion", "2026-10-08T10:00", cfg)).toBe("2026-10-19");
    expect(primeraFechaPermitida("adicion", "2026-10-07T18:00", cfg)).toBe("2026-10-09");
  });
});

describe("configuración desde la base de datos", () => {
  it("lee los valores y usa los por defecto si faltan", () => {
    const c = configDesdeFilas([
      { modulo: "programacion", regla: "semanas_maximas", valor: 4 },
      { modulo: "programacion", regla: "cierre_semana_siguiente", valor: { dia_semana: 2, hora: "12:00" } },
      { modulo: "adicion", regla: "hora_limite_dia_anterior", valor: "18:30" },
    ]);
    expect(c.semanasMaximas).toBe(4);
    expect(c.cierre).toEqual({ diaSemana: 2, hora: "12:00" });
    expect(c.horaLimiteAdicion).toBe("18:30");
    expect(c.horasReduccion).toBe(48);
  });
});
