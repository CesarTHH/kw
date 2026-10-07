import "server-only";
import { cookies } from "next/headers";
import { esSuperadmin, type Contexto } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { configDesdeFilas, type ConfigPlazos } from "./plazos";
import type { Catalogo, ContextoRaciones, FilaBorrador } from "./tipos";

export const COOKIE_EMPRESA = "kw_empresa";

export type EmpresaResumen = { id: string; nombre: string; ruc: string };

/**
 * Empresa con la que se trabaja:
 *  - alcance "empresa": siempre la del usuario;
 *  - alcance "todas": la elegida en el selector (cookie), verificada con RLS;
 *  - alcance "comedor": ninguna (ve todas las de su comedor).
 */
export async function empresaSeleccionada(ctx: Contexto): Promise<EmpresaResumen | null> {
  let id: string | null = null;
  if (ctx.alcance === "empresa") id = ctx.empresa_id;
  else if (ctx.alcance === "todas") {
    const v = (await cookies()).get(COOKIE_EMPRESA)?.value;
    id = esUuid(v) ? v : null;
  }
  if (!id) return null;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("empresas").select("id, ruc, nombre_corto, activo").eq("id", id).maybeSingle();
  if (!data) return null;
  return { id: data.id as string, ruc: data.ruc as string, nombre: data.nombre_corto as string };
}

/** Empresas activas (para el selector de los roles de alcance "todas"). */
export async function empresasParaSelector(): Promise<EmpresaResumen[]> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("empresas").select("id, ruc, nombre_corto").eq("activo", true).order("nombre_corto").limit(2000);
  return ((data ?? []) as { id: string; ruc: string; nombre_corto: string }[]).map((e) => ({ id: e.id, ruc: e.ruc, nombre: e.nombre_corto }));
}

export async function horaOficial(): Promise<string> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("hora_servidor").maybeSingle();
  const local = (data as { ahora_local?: string } | null)?.ahora_local;
  return local ? local.replace(" ", "T").slice(0, 19) : new Date().toISOString().slice(0, 19);
}

export async function configPlazos(): Promise<ConfigPlazos> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("config_horarios").select("modulo, regla, valor");
  return configDesdeFilas((data ?? []) as { modulo: string; regla: string; valor: unknown }[]);
}

/** Catálogos que usan las pantallas de raciones para una empresa. */
export async function cargarCatalogo(empresaId: string | null): Promise<Catalogo> {
  const supabase = await crearClienteServidor();
  const [frentesR, comedoresR, serviciosR, csR, sectorR, servR] = await Promise.all([
    empresaId
      ? supabase
          .from("empresa_frentes")
          .select("frente_id, contrato_desde, contrato_hasta, frentes_trabajo!inner(nombre, activo, proyecto_id, area_id, proyectos(nombre), areas(nombre))")
          .eq("empresa_id", empresaId)
          .eq("activo", true)
      : Promise.resolve({ data: [] }),
    supabase.from("comedores").select("id, nombre, sector_id").eq("activo", true).eq("habilitado_raciones", true).order("nombre"),
    supabase.from("servicios").select("id, nombre, tipo_servicio_id, orden").eq("activo", true).order("orden").order("nombre"),
    supabase.from("comedor_servicios").select("comedor_id, servicio_id").eq("activo", true),
    supabase.from("traslado_reglas_sector").select("sector_origen_id, sector_destino_id"),
    supabase.from("traslado_reglas_servicio").select("servicio_origen_id, servicio_destino_id, permitido"),
  ]);

  type FilaFrente = {
    frente_id: string;
    contrato_desde: string | null;
    contrato_hasta: string | null;
    frentes_trabajo: {
      nombre: string;
      activo: boolean;
      proyecto_id: string;
      area_id: string;
      proyectos: { nombre: string } | null;
      areas: { nombre: string } | null;
    } | null;
  };
  const frentes = ((frentesR.data ?? []) as unknown as FilaFrente[])
    .filter((f) => f.frentes_trabajo?.activo)
    .map((f) => ({
      id: f.frente_id,
      nombre: f.frentes_trabajo!.nombre,
      proyecto_id: f.frentes_trabajo!.proyecto_id,
      proyecto: f.frentes_trabajo!.proyectos?.nombre ?? "",
      area_id: f.frentes_trabajo!.area_id,
      area: f.frentes_trabajo!.areas?.nombre ?? "",
      desde: f.contrato_desde,
      hasta: f.contrato_hasta,
    }))
    .sort((a, b) => a.proyecto.localeCompare(b.proyecto) || a.area.localeCompare(b.area) || a.nombre.localeCompare(b.nombre));

  const comedorServicios: Record<string, string[]> = {};
  for (const r of (csR.data ?? []) as { comedor_id: string; servicio_id: string }[]) {
    (comedorServicios[r.comedor_id] ??= []).push(r.servicio_id);
  }
  const reglasServicio: Record<string, boolean> = {};
  for (const r of (servR.data ?? []) as { servicio_origen_id: string; servicio_destino_id: string; permitido: boolean }[]) {
    reglasServicio[`${r.servicio_origen_id}|${r.servicio_destino_id}`] = r.permitido;
  }
  return {
    frentes,
    comedores: (comedoresR.data ?? []) as Catalogo["comedores"],
    servicios: (serviciosR.data ?? []) as Catalogo["servicios"],
    comedorServicios,
    reglasSector: ((sectorR.data ?? []) as { sector_origen_id: string; sector_destino_id: string }[]).map(
      (r) => `${r.sector_origen_id}|${r.sector_destino_id}`,
    ),
    reglasServicio,
  };
}

/** Todo lo que necesita una pantalla de registro (programar, adicionar/reducir, trasladar). */
export async function contextoRaciones(ctx: Contexto, empresa: EmpresaResumen): Promise<ContextoRaciones> {
  const [catalogo, config, ahora] = await Promise.all([cargarCatalogo(empresa.id), configPlazos(), horaOficial()]);
  return { empresa, catalogo, config, ahora, superadmin: esSuperadmin(ctx) };
}

export type ModuloBorrador = "programar" | "adicionar_reducir" | "trasladar";

export async function leerBorrador(empresaId: string, modulo: ModuloBorrador): Promise<FilaBorrador[]> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("borradores").select("filas").eq("empresa_id", empresaId).eq("modulo", modulo).maybeSingle();
  const filas = (data as { filas?: unknown } | null)?.filas;
  return Array.isArray(filas) ? (filas as FilaBorrador[]) : [];
}
