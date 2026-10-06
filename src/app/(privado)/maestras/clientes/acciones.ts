"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { permisoEnAccion } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { contactoSchema, empresaNuevaSchema, empresaSchema } from "@/lib/maestras/esquemas";
import { claveError } from "@/lib/maestras/errores";
import { retorno } from "@/lib/maestras/retorno";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/maestras/clientes";

export async function guardarEmpresa(formData: FormData) {
  const ctx = await permisoEnAccion("maestras.clientes", "editar");
  const id = formData.get("id");
  const nuevo = id === "nuevo";
  if (!ctx || (nuevo && ctx.alcance !== "todas")) redirect(retorno(RUTA, formData, { error: "permiso" }));
  if (!nuevo && !esUuid(id)) redirect(retorno(RUTA, formData, { error: "datos" }));

  const crudo = {
    ruc: formData.get("ruc"),
    razon_social: formData.get("razon_social"),
    nombre_corto: formData.get("nombre_corto"),
    direccion: formData.get("direccion"),
    tipo: formData.get("tipo"),
    telefonos: formData.get("telefonos"),
  };
  const datos = nuevo ? empresaNuevaSchema.safeParse(crudo) : empresaSchema.safeParse(crudo);
  if (!datos.success) redirect(retorno(RUTA, formData, { id: String(id), error: "datos" }));

  const supabase = await crearClienteServidor();
  if (nuevo) {
    const { data, error } = await supabase.from("empresas").insert(datos.data).select("id").single();
    if (error || !data) redirect(retorno(RUTA, formData, { id: "nuevo", error: claveError(error?.code) }));
    revalidatePath(RUTA);
    redirect(retorno(RUTA, formData, { id: data.id, ok: "creado" }));
  }
  const { data, error } = await supabase.from("empresas").update(datos.data).eq("id", String(id)).select("id");
  if (error || !data?.length) redirect(retorno(RUTA, formData, { id: String(id), error: error ? claveError(error.code) : "noexiste" }));
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { id: String(id), ok: "guardado" }));
}

export async function cambiarEstadoEmpresa(formData: FormData) {
  const ctx = await permisoEnAccion("maestras.clientes", "editar");
  const id = formData.get("id");
  if (!ctx || ctx.alcance !== "todas") redirect(retorno(RUTA, formData, { error: "permiso" }));
  if (!esUuid(id)) redirect(retorno(RUTA, formData, { error: "datos" }));

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from("empresas")
    .update({ activo: formData.get("activo") === "1" })
    .eq("id", id);
  if (error) redirect(retorno(RUTA, formData, { id, error: claveError(error.code) }));
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { id, ok: "estado" }));
}

export async function guardarContacto(formData: FormData) {
  const ctx = await permisoEnAccion("maestras.clientes", "editar");
  const empresaId = formData.get("empresa_id");
  const contactoId = formData.get("contacto_id");
  if (!ctx) redirect(retorno(RUTA, formData, { error: "permiso" }));
  if (!esUuid(empresaId) || (contactoId !== "nuevo" && !esUuid(contactoId))) {
    redirect(retorno(RUTA, formData, { error: "datos" }));
  }

  const datos = contactoSchema.safeParse({
    tipo: formData.get("tipo"),
    nombre: formData.get("nombre"),
    telefono: formData.get("telefono"),
    correo: formData.get("correo"),
    recibe_notificaciones: formData.get("recibe_notificaciones") === "on",
  });
  if (!datos.success) redirect(retorno(RUTA, formData, { id: empresaId, error: "datos" }));

  const supabase = await crearClienteServidor();
  const { data, error } =
    contactoId === "nuevo"
      ? await supabase.from("empresa_contactos").insert({ ...datos.data, empresa_id: empresaId }).select("id")
      : await supabase.from("empresa_contactos").update(datos.data).eq("id", contactoId).eq("empresa_id", empresaId).select("id");
  if (error || !data?.length) {
    redirect(retorno(RUTA, formData, { id: empresaId, error: error ? claveError(error.code) : "noexiste" }));
  }
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { id: empresaId, ok: "guardado" }));
}

export async function cambiarEstadoContacto(formData: FormData) {
  const ctx = await permisoEnAccion("maestras.clientes", "editar");
  const empresaId = formData.get("empresa_id");
  const contactoId = formData.get("contacto_id");
  if (!ctx) redirect(retorno(RUTA, formData, { error: "permiso" }));
  if (!esUuid(empresaId) || !esUuid(contactoId)) redirect(retorno(RUTA, formData, { error: "datos" }));

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from("empresa_contactos")
    .update({ activo: formData.get("activo") === "1" })
    .eq("id", contactoId)
    .eq("empresa_id", empresaId);
  if (error) redirect(retorno(RUTA, formData, { id: empresaId, error: claveError(error.code) }));
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { id: empresaId, ok: "estado" }));
}
