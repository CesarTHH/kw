/** Reglas de catálogo para las pantallas (espejo de las validaciones de la base de datos). */
import type { Catalogo } from "./tipos";

/** ¿El frente está vigente para la fecha (según el contrato asignado a la empresa)? */
export function frenteVigente(c: Catalogo, frenteId: string, fecha: string): boolean {
  const f = c.frentes.find((x) => x.id === frenteId);
  if (!f) return false;
  return (!f.desde || fecha >= f.desde) && (!f.hasta || fecha <= f.hasta);
}

export function ofreceServicio(c: Catalogo, comedorId: string, servicioId: string): boolean {
  return (c.comedorServicios[comedorId] ?? []).includes(servicioId);
}

/** Comedores a los que se puede trasladar desde un comedor (mismo sector según la matriz). */
export function comedoresDestino(c: Catalogo, comedorOrigen: string): string[] {
  const origen = c.comedores.find((x) => x.id === comedorOrigen);
  return c.comedores
    .filter((d) => d.id === comedorOrigen || (!!origen?.sector_id && !!d.sector_id && c.reglasSector.includes(`${origen.sector_id}|${d.sector_id}`)))
    .map((d) => d.id);
}

/** ¿Se puede trasladar de un servicio a otro? (regla explícita o mismo tipo de servicio) */
export function servicioCompatible(c: Catalogo, origen: string, destino: string): boolean {
  const regla = c.reglasServicio[`${origen}|${destino}`];
  if (regla !== undefined) return regla;
  const a = c.servicios.find((s) => s.id === origen);
  const b = c.servicios.find((s) => s.id === destino);
  return !!a && !!b && a.tipo_servicio_id === b.tipo_servicio_id;
}

/** Servicios destino posibles para un traslado (el comedor destino debe ofrecerlos). */
export function serviciosDestino(c: Catalogo, comedorOrigen: string, servicioOrigen: string, comedorDestino: string): string[] {
  return (c.comedorServicios[comedorDestino] ?? []).filter(
    (s) => servicioCompatible(c, servicioOrigen, s) && !(comedorDestino === comedorOrigen && s === servicioOrigen),
  );
}
