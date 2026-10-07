import "server-only";
import { esUuid } from "@/lib/busqueda";
import { diaNumero, sumarDias } from "./plazos";

/** Filtros de la consulta detallada (compartidos por la pantalla y la exportación). */
export type FiltrosConsulta = {
  desde: string;
  hasta: string;
  proyecto?: string;
  area?: string;
  frente?: string;
  comedor?: string;
  servicio?: string;
  vista: "saldos" | "movimientos";
};

export const MAX_DIAS_CONSULTA = 92;

const fechaValida = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function leerFiltros(sp: Record<string, string | null | undefined>, hoy: string): FiltrosConsulta {
  let desde = fechaValida(sp.desde) ? sp.desde : hoy;
  let hasta = fechaValida(sp.hasta) ? sp.hasta : sumarDias(desde, 6);
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  if (diaNumero(hasta) - diaNumero(desde) > MAX_DIAS_CONSULTA) hasta = sumarDias(desde, MAX_DIAS_CONSULTA);
  const id = (v: unknown) => (esUuid(v) ? v : undefined);
  return {
    desde,
    hasta,
    proyecto: id(sp.proyecto),
    area: id(sp.area),
    frente: id(sp.frente),
    comedor: id(sp.comedor),
    servicio: id(sp.servicio),
    vista: sp.vista === "movimientos" ? "movimientos" : "saldos",
  };
}

export const TIPOS_MOVIMIENTO: Record<string, string> = {
  programacion: "Programación",
  adicion: "Adición",
  reduccion: "Reducción",
  traslado_salida: "Traslado (sale)",
  traslado_entrada: "Traslado (entra)",
  migracion: "Histórico",
};

/**
 * Columnas a leer. El frente se une con !inner solo si se filtra por proyecto o área:
 * así no desaparecen raciones de un frente que luego se quitó a la empresa.
 */
export function selectSaldos(f: FiltrosConsulta): string {
  const frente = f.proyecto || f.area ? "frentes_trabajo!inner" : "frentes_trabajo";
  return `empresa_id, fecha, cantidad, frente_id, comedor_id, servicio_id, empresas(nombre_corto, ruc), ${frente}(nombre, proyecto_id, area_id, proyectos(nombre), areas(nombre)), comedores(nombre), servicios(nombre)`;
}
export function selectMovimientos(f: FiltrosConsulta): string {
  const frente = f.proyecto || f.area ? "frentes_trabajo!inner" : "frentes_trabajo";
  return `id, empresa_id, fecha, cantidad, tipo_movimiento, envio_id, frente_id, comedor_id, servicio_id, empresas(nombre_corto, ruc), envios(enviado_en, fuera_de_plazo), ${frente}(nombre, proyecto_id, area_id, proyectos(nombre), areas(nombre)), comedores(nombre), servicios(nombre)`;
}

export type FilaConsulta = {
  id?: number;
  empresa_id: string;
  fecha: string;
  cantidad: number;
  tipo_movimiento?: string;
  envios?: { enviado_en: string; fuera_de_plazo: boolean } | null;
  empresas: { nombre_corto: string; ruc: string } | null;
  frentes_trabajo: { nombre: string; proyectos: { nombre: string } | null; areas: { nombre: string } | null } | null;
  comedores: { nombre: string } | null;
  servicios: { nombre: string } | null;
};

/** Aplica los filtros a una consulta de saldos o movimientos (supabase-js sin tipos generados). */
export function aplicarFiltros<Q>(q: Q, f: FiltrosConsulta, empresaId: string | null): Q {
  type Filtrable = { eq(c: string, v: unknown): Filtrable; gte(c: string, v: unknown): Filtrable; lte(c: string, v: unknown): Filtrable };
  let r = (q as unknown as Filtrable).gte("fecha", f.desde).lte("fecha", f.hasta);
  if (empresaId) r = r.eq("empresa_id", empresaId);
  if (f.proyecto) r = r.eq("frentes_trabajo.proyecto_id", f.proyecto);
  if (f.area) r = r.eq("frentes_trabajo.area_id", f.area);
  if (f.frente) r = r.eq("frente_id", f.frente);
  if (f.comedor) r = r.eq("comedor_id", f.comedor);
  if (f.servicio) r = r.eq("servicio_id", f.servicio);
  return r as unknown as Q;
}
