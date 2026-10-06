"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { permisoEnAccion } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { asignacionSchema, frenteSchema } from "@/lib/maestras/esquemas";
import { claveError } from "@/lib/maestras/errores";
import { retorno } from "@/lib/maestras/retorno";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/maestras/frentes";

async function exigirPermiso(formData: FormData) {
  const ctx = await permisoEnAccion("maestras.frentes", "editar");
  if (!ctx || ctx.alcance !== "todas") redirect(retorno(RUTA, formData, { error: "permiso" }));
  return ctx;
}

export async function guardarFrente(formData: FormData) {
  await exigirPermiso(formData);
  const id = String(formData.get("id") ?? "");
  const nuevo = id === "nuevo";
  if (!nuevo && !esUuid(id)) redirect(retorno(RUTA, formData, { error: "datos" }));

  const datos = frenteSchema.safeParse({
    proyecto_id: formData.get("proyecto_id"),
    area_id: formData.get("area_id"),
    nombre: formData.get("nombre"),
    sponsor: formData.get("sponsor"),
    contrato_desde: formData.get("contrato_desde"),
    contrato_hasta: formData.get("contrato_hasta"),
  });
  if (!datos.success) redirect(retorno(RUTA, formData, { id, error: "datos" }));

  const supabase = await crearClienteServidor();
  const { data, error } = nuevo
    ? await supabase.from("frentes_trabajo").insert(datos.data).select("id")
    : await supabase.from("frentes_trabajo").update(datos.data).eq("id", id).select("id");
  const fila = data?.[0] as { id: string } | undefined;
  if (error || !fila) redirect(retorno(RUTA, formData, { id, error: error ? claveError(error.code) : "noexiste" }));
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { id: fila.id, ok: nuevo ? "creado" : "guardado" }));
}

export async function cambiarEstadoFrente(formData: FormData) {
  await exigirPermiso(formData);
  const id = formData.get("id");
  if (!esUuid(id)) redirect(retorno(RUTA, formData, { error: "datos" }));
  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from("frentes_trabajo")
    .update({ activo: formData.get("activo") === "1" })
    .eq("id", id);
  if (error) redirect(retorno(RUTA, formData, { id, error: claveError(error.code) }));
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { id, ok: "estado" }));
}

/** Asigna una empresa al frente (o actualiza su contrato y la reactiva). */
export async function asignarEmpresa(formData: FormData) {
  await exigirPermiso(formData);
  const datos = asignacionSchema.safeParse({
    empresa_id: formData.get("empresa_id"),
    frente_id: formData.get("frente_id"),
    contrato_desde: formData.get("contrato_desde"),
    contrato_hasta: formData.get("contrato_hasta"),
  });
  const frenteId = esUuid(formData.get("frente_id")) ? String(formData.get("frente_id")) : undefined;
  if (!datos.success) redirect(retorno(RUTA, formData, { id: frenteId, error: "datos" }));

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from("empresa_frentes")
    .upsert({ ...datos.data, activo: true }, { onConflict: "empresa_id,frente_id" });
  if (error) redirect(retorno(RUTA, formData, { id: frenteId, error: claveError(error.code) }));
  revalidatePath(RUTA);
  revalidatePath("/maestras/clientes");
  redirect(retorno(RUTA, formData, { id: frenteId, ok: "asignado" }));
}

export async function cambiarEstadoAsignacion(formData: FormData) {
  await exigirPermiso(formData);
  const frenteId = formData.get("frente_id");
  const empresaId = formData.get("empresa_id");
  if (!esUuid(frenteId) || !esUuid(empresaId)) redirect(retorno(RUTA, formData, { error: "datos" }));
  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from("empresa_frentes")
    .update({ activo: formData.get("activo") === "1" })
    .eq("frente_id", frenteId)
    .eq("empresa_id", empresaId);
  if (error) redirect(retorno(RUTA, formData, { id: frenteId, error: claveError(error.code) }));
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { id: frenteId, ok: "estado" }));
}
