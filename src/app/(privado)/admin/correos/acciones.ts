"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { esSuperadmin, permisoEnAccion } from "@/lib/auth";
import { esUuid, urlCon } from "@/lib/busqueda";
import { claveError } from "@/lib/maestras/errores";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/admin/correos";

export async function reenviarCorreo(formData: FormData) {
  const ctx = await permisoEnAccion("admin.correos", "enviar");
  const id = formData.get("id");
  if (!ctx || ctx.alcance !== "todas") redirect(urlCon(RUTA, { error: "permiso" }));
  if (!esUuid(id)) redirect(urlCon(RUTA, { error: "datos" }));
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("reenviar_correo", { p_id: id });
  if (error) redirect(urlCon(RUTA, { id, error: claveError(error.code) }));
  revalidatePath(RUTA);
  redirect(urlCon(RUTA, { id: String(data), ok: "reenviado" }));
}

const plantillaSchema = z.object({
  codigo: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/),
  asunto: z.string().trim().min(1, "Indica el asunto").max(300),
  html: z
    .string()
    .max(50_000)
    .refine((h) => !/<\s*(script|iframe|object|embed|form)\b/i.test(h), "El HTML no puede incluir scripts, formularios ni contenido incrustado"),
  texto: z.string().max(50_000),
  activo: z.boolean(),
});

export async function guardarPlantilla(formData: FormData) {
  const ctx = await permisoEnAccion("admin.correos", "ver");
  const codigo = String(formData.get("codigo") ?? "");
  if (!ctx || !esSuperadmin(ctx)) redirect(urlCon(RUTA, { vista: "plantillas", error: "permiso" }));
  const datos = plantillaSchema.safeParse({
    codigo,
    asunto: formData.get("asunto"),
    html: formData.get("html"),
    texto: formData.get("texto"),
    activo: formData.get("activo") === "on",
  });
  if (!datos.success) redirect(urlCon(RUTA, { vista: "plantillas", p: codigo, error: "datos" }));

  const supabase = await crearClienteServidor();
  const { codigo: _c, ...cambios } = datos.data;
  const { data, error } = await supabase.from("plantillas_correo").update(cambios).eq("codigo", datos.data.codigo).select("codigo");
  if (error || !data?.length) {
    redirect(urlCon(RUTA, { vista: "plantillas", p: codigo, error: error ? claveError(error.code) : "noexiste" }));
  }
  revalidatePath(RUTA);
  redirect(urlCon(RUTA, { vista: "plantillas", p: codigo, ok: "guardado" }));
}

export async function quitarSuprimido(formData: FormData) {
  const ctx = await permisoEnAccion("admin.correos", "ver");
  const correo = String(formData.get("correo") ?? "").toLowerCase();
  if (!ctx || !esSuperadmin(ctx)) redirect(urlCon(RUTA, { vista: "suprimidos", error: "permiso" }));
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("correos_suprimidos").delete().eq("correo", correo);
  if (error) redirect(urlCon(RUTA, { vista: "suprimidos", error: claveError(error.code) }));
  revalidatePath(RUTA);
  redirect(urlCon(RUTA, { vista: "suprimidos", ok: "estado" }));
}
