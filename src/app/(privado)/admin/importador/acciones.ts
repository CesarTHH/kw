"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { permisoEnAccion } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { registrarError } from "@/lib/errores";
import {
  MAX_BYTES_IMPORTACION,
  MIME_ARCHIVO,
  rutaArchivo,
  rutaCatalogos,
  rutaLote,
  tipoArchivo,
} from "@/lib/importador/archivos";
import { analizar, type Actual, type Archivo } from "@/lib/importador/plan";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/admin/importador";
const BUCKET = "importaciones";
type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;
export type Respuesta<T = undefined> = { ok: true; datos: T } | { ok: false; error: string };

async function exigirPermiso(): Promise<Cliente | null> {
  return (await permisoEnAccion("admin.importador", "enviar")) ? crearClienteServidor() : null;
}

function mensaje(error: { code?: string; message: string }): string {
  return error.code === "22023" || error.code === "42501" ? error.message : "No se pudo completar el paso. Inténtalo de nuevo.";
}

// ---------------------------------------------------------------------------
// 1. Registrar la importación y dar a la pantalla direcciones firmadas para subir los archivos.
// ---------------------------------------------------------------------------
const archivosSchema = z
  .array(z.object({ nombre: z.string().trim().min(1).max(200), tamano: z.number().int().min(1).max(MAX_BYTES_IMPORTACION) }))
  .min(1)
  .max(10);

export async function crearImportacion(
  archivos: { nombre: string; tamano: number }[],
): Promise<Respuesta<{ id: string; subidas: { ruta: string; url: string; tipo: string }[] }>> {
  const supabase = await exigirPermiso();
  if (!supabase) return { ok: false, error: "No tienes permiso para importar." };
  const datos = archivosSchema.safeParse(archivos);
  if (!datos.success) return { ok: false, error: "Elige entre 1 y 10 archivos de hasta 50 MB." };
  const desconocidos = datos.data.filter((a) => !tipoArchivo(a.nombre));
  if (desconocidos.length) return { ok: false, error: `No se reconoce el archivo "${desconocidos[0]!.nombre}". Usa los nombres de los archivos actuales.` };

  const { data: id, error } = await supabase.rpc("importacion_crear", {
    p_archivos: datos.data.map((a) => ({ ...a, tipo: tipoArchivo(a.nombre) })),
  });
  if (error || typeof id !== "string") return { ok: false, error: error ? mensaje(error) : "No se pudo registrar la importación." };

  const subidas: { ruta: string; url: string; tipo: string }[] = [];
  for (const [n, a] of datos.data.entries()) {
    const ruta = rutaArchivo(id, n, a.nombre);
    const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUploadUrl(ruta);
    if (e || !data) {
      await registrarError("importador firmar subida", e?.message);
      return { ok: false, error: "No se pudo preparar la subida de los archivos." };
    }
    subidas.push({ ruta, url: data.signedUrl, tipo: MIME_ARCHIVO(a.nombre) });
  }
  return { ok: true, datos: { id, subidas } };
}

// ---------------------------------------------------------------------------
// 2. Simulación: lee los archivos, valida y prepara los lotes (no toca los datos).
// ---------------------------------------------------------------------------
async function leerTodo<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const salida: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await pedir(desde, desde + 999);
    if (error) throw new Error("No se pudieron leer los catálogos actuales");
    const pagina = (data ?? []) as T[];
    salida.push(...pagina);
    if (pagina.length < 1000) return salida;
  }
}

async function catalogosActuales(supabase: Cliente): Promise<Actual> {
  type F = { nombre: string; proyectos: { nombre: string } | null; areas: { nombre: string } | null };
  type T = { vigente_desde: string; vigente_hasta: string; servicios: { nombre: string } | null };
  const [proyectos, areas, frentes, empresas, contactos, comedores, servicios, tarifas] = await Promise.all([
    leerTodo<{ nombre: string; activo: boolean }>((d, h) => supabase.from("proyectos").select("nombre, activo").order("nombre").range(d, h)),
    leerTodo<{ nombre: string; activo: boolean }>((d, h) => supabase.from("areas").select("nombre, activo").order("nombre").range(d, h)),
    leerTodo<F>((d, h) => supabase.from("frentes_trabajo").select("nombre, proyectos(nombre), areas(nombre)").order("id").range(d, h)),
    leerTodo<{ ruc: string; nombre_corto: string }>((d, h) => supabase.from("empresas").select("ruc, nombre_corto").order("ruc").range(d, h)),
    leerTodo<{ origen_id: string }>((d, h) => supabase.from("empresa_contactos").select("origen_id").not("origen_id", "is", null).order("id").range(d, h)),
    leerTodo<{ nombre: string }>((d, h) => supabase.from("comedores").select("nombre").order("nombre").range(d, h)),
    leerTodo<{ nombre: string }>((d, h) => supabase.from("servicios").select("nombre").order("nombre").range(d, h)),
    leerTodo<T>((d, h) => supabase.from("servicio_tarifas").select("vigente_desde, vigente_hasta, servicios(nombre)").order("id").range(d, h)),
  ]);
  return {
    proyectos,
    areas,
    frentes: frentes.map((f) => ({ nombre: f.nombre, proyecto: f.proyectos?.nombre ?? "", area: f.areas?.nombre ?? "" })),
    empresas,
    contactos: contactos.map((c) => c.origen_id),
    comedores,
    servicios,
    tarifas: tarifas.map((t) => ({ servicio: t.servicios?.nombre ?? "", desde: t.vigente_desde, hasta: t.vigente_hasta })),
  };
}

type Registro = {
  id: string;
  estado: string;
  archivos: { nombre: string; tamano: number }[];
  lotes_total: number;
  catalogos_hechos: boolean;
  meses: string[];
  meses_listos: string[];
};

async function leerImportacion(supabase: Cliente, id: string): Promise<Registro | null> {
  const { data } = await supabase
    .from("importaciones")
    .select("id, estado, archivos, lotes_total, catalogos_hechos, meses, meses_listos")
    .eq("id", id)
    .maybeSingle();
  return data as Registro | null;
}

async function subirJson(supabase: Cliente, ruta: string, contenido: unknown) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, new Blob([JSON.stringify(contenido)], { type: "application/json" }), { contentType: "application/json", upsert: false });
  if (error) throw new Error(`No se pudo guardar ${ruta}: ${error.message}`);
}

export async function simularImportacion(id: string): Promise<Respuesta> {
  const supabase = await exigirPermiso();
  if (!supabase) return { ok: false, error: "No tienes permiso para importar." };
  if (!esUuid(id)) return { ok: false, error: "Importación no válida." };
  const reg = await leerImportacion(supabase, id);
  if (!reg || !["subido", "analizado"].includes(reg.estado)) return { ok: false, error: "Esta importación ya se ejecutó o no existe." };

  try {
    const archivos: Archivo[] = [];
    for (const [n, a] of reg.archivos.entries()) {
      const { data, error } = await supabase.storage.from(BUCKET).download(rutaArchivo(id, n, a.nombre));
      if (error || !data) return { ok: false, error: `No se encontró el archivo "${a.nombre}". Vuelve a subirlo.` };
      archivos.push({ nombre: a.nombre, bytes: Buffer.from(await data.arrayBuffer()) });
    }
    const actual = await catalogosActuales(supabase);
    const r = await analizar(archivos, actual, async (origenes) => {
      const { data, error } = await supabase.rpc("importacion_existentes", { p_origenes: origenes });
      if (error) throw new Error(error.message);
      return Number(data) || 0;
    });

    // Lotes preparados (se borran los de una simulación anterior).
    const { data: viejos } = await supabase.storage.from(BUCKET).list(`${id}/lotes`, { limit: 1000 });
    if (viejos?.length) await supabase.storage.from(BUCKET).remove(viejos.map((o) => `${id}/lotes/${o.name}`));
    await subirJson(supabase, rutaCatalogos(id), r.catalogos);
    for (let i = 0; i < r.lotes.length; i += 6) {
      await Promise.all(r.lotes.slice(i, i + 6).map((l, k) => subirJson(supabase, rutaLote(id, i + k), l)));
    }

    const { error } = await supabase.rpc("importacion_guardar_analisis", {
      p_id: id,
      p_resumen: r.resumen,
      p_problemas: r.problemas,
      p_errores: r.errores,
      p_advertencias: r.advertencias,
      p_lotes: r.lotes.length,
      p_meses: r.meses,
    });
    if (error) return { ok: false, error: mensaje(error) };
  } catch (e) {
    await registrarError("importador simular", e);
    return { ok: false, error: "No se pudo leer los archivos. Revisa que sean los del formato actual." };
  }
  revalidatePath(RUTA);
  return { ok: true, datos: undefined };
}

// ---------------------------------------------------------------------------
// 3. Importación paso a paso (la pantalla los llama en orden y muestra el avance).
// ---------------------------------------------------------------------------
export type Paso =
  | { tipo: "inicio" }
  | { tipo: "catalogos" }
  | { tipo: "lote"; n: number }
  | { tipo: "saldos"; mes: string }
  | { tipo: "fin" }
  | { tipo: "fallo"; detalle: string };

const pasoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("inicio") }),
  z.object({ tipo: z.literal("catalogos") }),
  z.object({ tipo: z.literal("lote"), n: z.number().int().min(0).max(10_000) }),
  z.object({ tipo: z.literal("saldos"), mes: z.iso.date() }),
  z.object({ tipo: z.literal("fin") }),
  z.object({ tipo: z.literal("fallo"), detalle: z.string().max(500) }),
]);

async function leerJson(supabase: Cliente, ruta: string): Promise<unknown> {
  const { data, error } = await supabase.storage.from(BUCKET).download(ruta);
  if (error || !data) throw new Error("No se encontró el lote preparado. Vuelve a ejecutar la simulación.");
  return JSON.parse(await data.text());
}

export async function importarPaso(id: string, paso: Paso): Promise<Respuesta<Record<string, unknown> | null>> {
  const supabase = await exigirPermiso();
  if (!supabase) return { ok: false, error: "No tienes permiso para importar." };
  const p = pasoSchema.safeParse(paso);
  if (!esUuid(id) || !p.success) return { ok: false, error: "Paso no válido." };

  try {
    switch (p.data.tipo) {
      case "inicio": {
        const { error } = await supabase.rpc("importacion_marcar", { p_id: id, p_estado: "importando" });
        if (error) return { ok: false, error: mensaje(error) };
        return { ok: true, datos: null };
      }
      case "catalogos": {
        const datos = await leerJson(supabase, rutaCatalogos(id));
        const { data, error } = await supabase.rpc("importacion_catalogos", { p_id: id, p_datos: datos });
        if (error) return { ok: false, error: mensaje(error) };
        return { ok: true, datos: data as Record<string, unknown> };
      }
      case "lote": {
        const datos = await leerJson(supabase, rutaLote(id, p.data.n));
        const { data, error } = await supabase.rpc("importacion_movimientos", { p_id: id, p_lote: p.data.n, p_datos: datos });
        if (error) return { ok: false, error: mensaje(error) };
        return { ok: true, datos: data as Record<string, unknown> };
      }
      case "saldos": {
        const { data, error } = await supabase.rpc("importacion_saldos", { p_id: id, p_mes: p.data.mes });
        if (error) return { ok: false, error: mensaje(error) };
        return { ok: true, datos: data as Record<string, unknown> };
      }
      case "fin": {
        const { error } = await supabase.rpc("importacion_finalizar", { p_id: id });
        if (error) return { ok: false, error: mensaje(error) };
        // Los archivos ya no hacen falta (los datos están en la base): se borran.
        const reg = await leerImportacion(supabase, id);
        const rutas = [
          ...(reg?.archivos ?? []).map((a, n) => rutaArchivo(id, n, a.nombre)),
          rutaCatalogos(id),
          ...Array.from({ length: reg?.lotes_total ?? 0 }, (_, n) => rutaLote(id, n)),
        ];
        for (let i = 0; i < rutas.length; i += 100) await supabase.storage.from(BUCKET).remove(rutas.slice(i, i + 100));
        revalidatePath(RUTA);
        return { ok: true, datos: null };
      }
      case "fallo": {
        await supabase.rpc("importacion_marcar", { p_id: id, p_estado: "fallido", p_detalle: p.data.detalle });
        revalidatePath(RUTA);
        return { ok: true, datos: null };
      }
    }
  } catch (e) {
    await registrarError("importador paso", e);
    return { ok: false, error: e instanceof Error && e.message.startsWith("No se encontró") ? e.message : "No se pudo completar el paso. Inténtalo de nuevo." };
  }
}

/** Lo que falta para terminar (para continuar una importación interrumpida). */
export async function pendientesImportacion(
  id: string,
): Promise<Respuesta<{ estado: string; catalogos: boolean; lotes: number[]; meses: string[] }>> {
  const supabase = await exigirPermiso();
  if (!supabase || !esUuid(id)) return { ok: false, error: "No tienes permiso para importar." };
  const reg = await leerImportacion(supabase, id);
  if (!reg) return { ok: false, error: "La importación no existe." };
  const { data } = await supabase.from("importacion_lotes").select("lote").eq("importacion_id", id).limit(10_000);
  const hechos = new Set(((data ?? []) as { lote: number }[]).map((l) => l.lote));
  return {
    ok: true,
    datos: {
      estado: reg.estado,
      catalogos: !reg.catalogos_hechos,
      lotes: Array.from({ length: reg.lotes_total }, (_, n) => n).filter((n) => !hechos.has(n)),
      meses: reg.meses.filter((m) => !reg.meses_listos.includes(m)),
    },
  };
}
