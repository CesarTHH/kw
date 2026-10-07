"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { permisoEnAccion } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { catalogoPorCodigo, leerCatalogo } from "@/lib/maestras/catalogos";
import { claveError } from "@/lib/maestras/errores";
import { retorno } from "@/lib/maestras/retorno";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/maestras/catalogos";

async function exigirPermiso(formData: FormData, c: string) {
  const ctx = await permisoEnAccion("maestras.catalogos", "editar");
  if (!ctx) redirect(retorno(RUTA, formData, { c, error: "permiso" }));
}

export async function guardarCatalogo(formData: FormData) {
  const cat = catalogoPorCodigo(formData.get("c"));
  if (!cat) redirect(RUTA);
  await exigirPermiso(formData, cat.codigo);

  const id = String(formData.get("id") ?? "");
  const nuevo = id === "nuevo";
  if (!nuevo && !esUuid(id)) redirect(retorno(RUTA, formData, { c: cat.codigo, error: "datos" }));

  const datos = leerCatalogo(cat, formData);
  if (!datos.success) redirect(retorno(RUTA, formData, { c: cat.codigo, id, error: "datos" }));

  const supabase = await crearClienteServidor();
  const { data, error } = nuevo
    ? await supabase.from(cat.tabla).insert(datos.data).select("id")
    : await supabase.from(cat.tabla).update(datos.data).eq("id", id).select("id");
  const fila = data?.[0] as { id: string } | undefined;
  if (error || !fila) {
    redirect(retorno(RUTA, formData, { c: cat.codigo, id, error: error ? claveError(error.code) : "noexiste" }));
  }
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { c: cat.codigo, id: fila.id, ok: nuevo ? "creado" : "guardado" }));
}

export async function cambiarEstadoCatalogo(formData: FormData) {
  const cat = catalogoPorCodigo(formData.get("c"));
  if (!cat || !cat.tieneActivo) redirect(RUTA);
  await exigirPermiso(formData, cat.codigo);
  const id = formData.get("id");
  if (!esUuid(id)) redirect(retorno(RUTA, formData, { c: cat.codigo, error: "datos" }));

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from(cat.tabla)
    .update({ activo: formData.get("activo") === "1" })
    .eq("id", id);
  if (error) redirect(retorno(RUTA, formData, { c: cat.codigo, id, error: claveError(error.code) }));
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { c: cat.codigo, id, ok: "estado" }));
}

/** Lee pares "a|b" de casillas marcadas (solo UUID válidos). */
function pares(formData: FormData, nombre: string): Set<string> {
  const salida = new Set<string>();
  for (const v of formData.getAll(nombre)) {
    if (typeof v !== "string") continue;
    const [a, b] = v.split("|");
    if (esUuid(a) && esUuid(b)) salida.add(`${a}|${b}`);
  }
  return salida;
}

/** Matriz comedor × servicio: qué servicios ofrece cada comedor. */
export async function guardarComedorServicios(formData: FormData) {
  const c = "comedor_servicios";
  await exigirPermiso(formData, c);
  const marcados = pares(formData, "cs");
  // Solo se tocan las filas que se mostraron en pantalla.
  const visibles = pares(formData, "visible");

  const supabase = await crearClienteServidor();
  const { data: actuales, error: e1 } = await supabase.from("comedor_servicios").select("comedor_id, servicio_id, activo");
  if (e1) redirect(retorno(RUTA, formData, { c, error: "guardar" }));

  const activar = [...marcados].filter((k) => visibles.has(k));
  const desactivar = (actuales ?? [])
    .filter((r) => r.activo && visibles.has(`${r.comedor_id}|${r.servicio_id}`) && !marcados.has(`${r.comedor_id}|${r.servicio_id}`))
    .map((r) => ({ comedor_id: r.comedor_id as string, servicio_id: r.servicio_id as string, activo: false }));

  const filas = [
    ...activar.map((k) => {
      const [comedor_id, servicio_id] = k.split("|") as [string, string];
      return { comedor_id, servicio_id, activo: true };
    }),
    ...desactivar,
  ];
  if (filas.length) {
    const { error } = await supabase.from("comedor_servicios").upsert(filas, { onConflict: "comedor_id,servicio_id" });
    if (error) redirect(retorno(RUTA, formData, { c, error: claveError(error.code) }));
  }
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { c, ok: "guardado" }));
}

/** Matriz sector origen × sector destino: entre qué sectores se permite trasladar. */
export async function guardarTrasladosSector(formData: FormData) {
  const c = "traslados";
  await exigirPermiso(formData, c);
  const marcados = pares(formData, "ts");
  const visibles = pares(formData, "visible");

  const supabase = await crearClienteServidor();
  const { data: actuales, error: e1 } = await supabase.from("traslado_reglas_sector").select("sector_origen_id, sector_destino_id");
  if (e1) redirect(retorno(RUTA, formData, { c, error: "guardar" }));
  const existentes = new Set((actuales ?? []).map((r) => `${r.sector_origen_id}|${r.sector_destino_id}`));

  const nuevos = [...marcados]
    .filter((k) => visibles.has(k) && !existentes.has(k))
    .map((k) => {
      const [sector_origen_id, sector_destino_id] = k.split("|") as [string, string];
      return { sector_origen_id, sector_destino_id };
    });
  const quitar = [...existentes].filter((k) => visibles.has(k) && !marcados.has(k));

  if (nuevos.length) {
    const { error } = await supabase.from("traslado_reglas_sector").insert(nuevos);
    if (error) redirect(retorno(RUTA, formData, { c, error: claveError(error.code) }));
  }
  for (const k of quitar) {
    const [origen, destino] = k.split("|") as [string, string];
    const { error } = await supabase
      .from("traslado_reglas_sector")
      .delete()
      .eq("sector_origen_id", origen)
      .eq("sector_destino_id", destino);
    if (error) redirect(retorno(RUTA, formData, { c, error: claveError(error.code) }));
  }
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { c, ok: "guardado" }));
}

/** Composición del refrigerio estándar: cantidad por producto (0 = no se incluye). */
export async function guardarEstandar(formData: FormData) {
  const c = "estandar";
  await exigirPermiso(formData, c);
  const items: { producto_id: string; cantidad: number }[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("p:") || typeof v !== "string") continue;
    const id = k.slice(2);
    const n = Number.parseInt(v, 10);
    if (!esUuid(id) || !Number.isInteger(n) || n < 0 || n > 100) redirect(retorno(RUTA, formData, { c, error: "datos" }));
    if (n > 0) items.push({ producto_id: id, cantidad: n });
  }
  if (!items.length) redirect(retorno(RUTA, formData, { c, error: "datos" }));

  const supabase = await crearClienteServidor();
  const { error: e1 } = await supabase.from("refrigerio_estandar_items").upsert(items, { onConflict: "producto_id" });
  if (e1) redirect(retorno(RUTA, formData, { c, error: claveError(e1.code) }));
  const ids = items.map((i) => i.producto_id);
  const { error: e2 } = await supabase.from("refrigerio_estandar_items").delete().not("producto_id", "in", `(${ids.join(",")})`);
  if (e2) redirect(retorno(RUTA, formData, { c, error: claveError(e2.code) }));
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { c, ok: "guardado" }));
}
