"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { permisoEnAccion } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { zonaHoraria } from "@/lib/contenido/servidor";
import { localAUtc } from "@/lib/fechas";
import { claveError } from "@/lib/maestras/errores";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/admin/alertas";

export async function guardarAlerta(formData: FormData) {
  if (!(await permisoEnAccion("admin.alertas", "editar"))) redirect(`${RUTA}?error=permiso`);
  const id = String(formData.get("id") ?? "");
  const nueva = id === "nueva";
  if (!nueva && !esUuid(id)) redirect(`${RUTA}?error=datos`);

  const zona = await zonaHoraria();
  const titulo = String(formData.get("titulo") ?? "").trim();
  const contenido = String(formData.get("contenido") ?? "").trim();
  const desde = localAUtc(String(formData.get("desde") ?? ""), zona);
  const hasta = localAUtc(String(formData.get("hasta") ?? ""), zona);
  const roles = [...new Set(formData.getAll("roles").map(String))].filter((r) => /^[a-z_]{2,40}$/.test(r));
  const unaVez = formData.get("una_vez") !== "cada_login";
  const volverA = `${RUTA}?id=${nueva ? "nueva" : id}`;
  if (!titulo || titulo.length > 120 || !contenido || contenido.length > 4000 || !desde || !hasta || !roles.length) {
    redirect(`${volverA}&error=datos`);
  }
  if (hasta <= desde) redirect(`${volverA}&error=fechas`);

  const fila = { titulo, contenido, desde, hasta, roles, una_vez: unaVez };
  const supabase = await crearClienteServidor();
  const { data, error } = nueva
    ? await supabase.from("alertas").insert(fila).select("id")
    : await supabase.from("alertas").update(fila).eq("id", id).select("id");
  const guardada = (data as { id: string }[] | null)?.[0];
  if (error || !guardada) redirect(`${volverA}&error=${error ? claveError(error.code) : "noexiste"}`);
  revalidatePath(RUTA);
  redirect(`${RUTA}?id=${guardada.id}&ok=${nueva ? "creado" : "guardado"}`);
}

export async function cambiarEstadoAlerta(formData: FormData) {
  if (!(await permisoEnAccion("admin.alertas", "editar"))) redirect(`${RUTA}?error=permiso`);
  const id = formData.get("id");
  if (!esUuid(id)) redirect(`${RUTA}?error=datos`);
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("alertas").update({ activo: formData.get("activo") === "1" }).eq("id", id);
  if (error) redirect(`${RUTA}?error=${claveError(error.code)}`);
  revalidatePath(RUTA);
  redirect(`${RUTA}?ok=estado`);
}
