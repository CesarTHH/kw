"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { obtenerContexto, permisoEnAccion } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { rutaSegura } from "@/lib/rutas";
import { COOKIE_EMPRESA, type ModuloBorrador } from "@/lib/raciones/servidor";
import type { FilaBorrador, Saldo } from "@/lib/raciones/tipos";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const fecha = z.iso.date();
const filaSchema = z.object({
  id: z.string().max(60),
  fecha,
  frente_id: z.uuid(),
  comedor_id: z.uuid(),
  servicio_id: z.uuid(),
  cantidad: z.number().int().min(-10_000).max(10_000),
  comedor_destino_id: z.uuid().optional(),
  servicio_destino_id: z.uuid().optional(),
});
const filasSchema = z.array(filaSchema).max(500);

const MENU: Record<ModuloBorrador, string> = {
  programar: "raciones.programar",
  adicionar_reducir: "raciones.adicionar_reducir",
  trasladar: "raciones.trasladar",
};
const TIPO: Record<ModuloBorrador, "programacion" | "adicion_reduccion" | "traslado"> = {
  programar: "programacion",
  adicionar_reducir: "adicion_reduccion",
  trasladar: "traslado",
};

/** Selector de empresa (solo roles de alcance "todas"). Se recuerda en una cookie. */
export async function seleccionarEmpresa(formData: FormData) {
  const ctx = await obtenerContexto();
  const volver = rutaSegura(String(formData.get("volver") ?? ""), "/raciones");
  if (!ctx || ctx.alcance !== "todas") redirect(volver);
  const id = formData.get("empresa");
  const jar = await cookies();
  if (esUuid(id)) {
    jar.set(COOKIE_EMPRESA, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  } else {
    jar.delete(COOKIE_EMPRESA);
  }
  redirect(volver);
}

/** Guarda la grilla de previsualización (se llama sola mientras el usuario trabaja). */
export async function guardarBorrador(modulo: ModuloBorrador, empresaId: string, filas: FilaBorrador[]): Promise<{ ok: boolean }> {
  if (!Object.hasOwn(MENU, modulo) || !esUuid(empresaId)) return { ok: false };
  if (!(await permisoEnAccion(MENU[modulo], "enviar"))) return { ok: false };
  const datos = filasSchema.safeParse(filas);
  if (!datos.success) return { ok: false };
  const supabase = await crearClienteServidor();
  const { error } = datos.data.length
    ? await supabase.from("borradores").upsert({ empresa_id: empresaId, modulo, filas: datos.data }, { onConflict: "usuario_id,empresa_id,modulo" })
    : await supabase.from("borradores").delete().eq("empresa_id", empresaId).eq("modulo", modulo);
  return { ok: !error };
}

/** Saldos vigentes de la empresa en un rango de fechas (máximo 120 días). */
export async function consultarSaldos(empresaId: string, desde: string, hasta: string): Promise<Saldo[]> {
  if (!esUuid(empresaId) || !fecha.safeParse(desde).success || !fecha.safeParse(hasta).success || hasta < desde) return [];
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
  if (dias > 120) return [];
  if (!(await permisoEnAccion("raciones", "ver"))) return [];
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from("racion_saldos")
    .select("fecha, frente_id, comedor_id, servicio_id, cantidad")
    .eq("empresa_id", empresaId)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .gt("cantidad", 0)
    .order("fecha")
    .limit(5000);
  return (data ?? []) as Saldo[];
}

export type ResultadoEnvio = { ok: true; envioId: string; filas: number } | { ok: false; error: string };

/** Envía la grilla. La base de datos vuelve a validar todo (permisos, plazos, catálogos y saldos). */
export async function enviarRaciones(
  modulo: ModuloBorrador,
  empresaId: string,
  filas: FilaBorrador[],
  clave: string,
  motivo?: string,
): Promise<ResultadoEnvio> {
  if (!Object.hasOwn(MENU, modulo) || !esUuid(empresaId) || !esUuid(clave)) return { ok: false, error: "Datos no válidos." };
  const ctx = await permisoEnAccion(MENU[modulo], "enviar");
  if (!ctx) return { ok: false, error: "No tienes permiso para enviar raciones." };
  const datos = filasSchema.min(1, "No hay filas para enviar.").safeParse(filas);
  if (!datos.success) return { ok: false, error: datos.error.issues[0]?.message ?? "Datos no válidos." };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("enviar_raciones", {
    p_tipo: TIPO[modulo],
    p_empresa_id: empresaId,
    p_filas: datos.data.map(({ id: _id, ...f }) => f),
    p_clave: clave,
    p_motivo: motivo?.trim() || null,
  });
  if (error) {
    // Los mensajes de validación de la base de datos (código 22023) están pensados para el usuario.
    if (error.code === "22023") return { ok: false, error: error.message };
    if (error.code === "42501") return { ok: false, error: error.message || "No tienes permiso." };
    console.error("[raciones] enviar_raciones:", error.code, error.message);
    return { ok: false, error: "No se pudo enviar. Inténtalo de nuevo." };
  }
  await supabase.from("borradores").delete().eq("empresa_id", empresaId).eq("modulo", modulo);
  revalidatePath("/raciones", "layout");
  return { ok: true, envioId: String(data), filas: datos.data.length };
}
