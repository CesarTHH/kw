/** Tipos compartidos entre el servidor y las pantallas de raciones. */
import type { ConfigPlazos } from "./plazos";

export type FrenteOpcion = {
  id: string;
  nombre: string;
  proyecto_id: string;
  proyecto: string;
  area_id: string;
  area: string;
  desde: string | null;
  hasta: string | null;
};
export type ComedorOpcion = { id: string; nombre: string; sector_id: string | null };
export type ServicioOpcion = { id: string; nombre: string; tipo_servicio_id: string; orden: number };

export type Catalogo = {
  frentes: FrenteOpcion[];
  comedores: ComedorOpcion[];
  servicios: ServicioOpcion[];
  /** comedor_id → servicios que ofrece */
  comedorServicios: Record<string, string[]>;
  /** pares "sectorOrigen|sectorDestino" permitidos */
  reglasSector: string[];
  /** "servicioOrigen|servicioDestino" → permitido */
  reglasServicio: Record<string, boolean>;
};

export type ContextoRaciones = {
  empresa: { id: string; nombre: string; ruc: string };
  catalogo: Catalogo;
  config: ConfigPlazos;
  ahora: string;
  superadmin: boolean;
};

/** Saldo vigente de una combinación. */
export type Saldo = {
  fecha: string;
  frente_id: string;
  comedor_id: string;
  servicio_id: string;
  cantidad: number;
};

/** Fila de la grilla de previsualización. */
export type FilaBorrador = {
  id: string;
  fecha: string;
  frente_id: string;
  comedor_id: string;
  servicio_id: string;
  cantidad: number;
  comedor_destino_id?: string;
  servicio_destino_id?: string;
};

export const clave = (f: { fecha: string; frente_id: string; comedor_id: string; servicio_id: string }) =>
  `${f.fecha}|${f.frente_id}|${f.comedor_id}|${f.servicio_id}`;
