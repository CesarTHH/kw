"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { esSuperadmin, permisoEnAccion } from "@/lib/auth";
import { ACCIONES } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { rolNuevoSchema } from "@/lib/validaciones";

const RUTA = "/admin/roles";

async function exigirSuperadmin() {
  const ctx = await permisoEnAccion("admin.roles", "ver");
  if (!ctx || !esSuperadmin(ctx)) redirect(`${RUTA}?error=permiso`);
  return ctx;
}

const permisoSchema = z.string().regex(/^[a-z][a-z0-9_.]{1,60}\|[a-z]+$/);

export async function guardarPermisos(formData: FormData) {
  await exigirSuperadmin();
  const rolId = z.uuid().safeParse(formData.get("rolId"));
  if (!rolId.success) redirect(`${RUTA}?error=datos`);

  // "menu|accion" → { menu: [acciones] }
  const mapa = new Map<string, Set<string>>();
  for (const valor of formData.getAll("p")) {
    const v = permisoSchema.safeParse(valor);
    if (!v.success) continue;
    const [menu, accion] = v.data.split("|") as [string, string];
    if (!(ACCIONES as readonly string[]).includes(accion)) continue;
    if (!mapa.has(menu)) mapa.set(menu, new Set());
    mapa.get(menu)!.add(accion);
  }

  // Cualquier acción implica "ver"; ver un submenú implica ver su menú padre.
  for (const [menu, acciones] of [...mapa]) {
    acciones.add("ver");
    const padre = menu.includes(".") ? menu.split(".")[0]! : null;
    if (padre) {
      if (!mapa.has(padre)) mapa.set(padre, new Set());
      mapa.get(padre)!.add("ver");
    }
  }

  const permisos = [...mapa].map(([menu, acciones]) => ({ menu, acciones: [...acciones] }));
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("guardar_permisos_rol", { p_rol_id: rolId.data, p_permisos: permisos });
  if (error) {
    console.error("[roles] guardar_permisos_rol:", error.code);
    redirect(`${RUTA}?rol=${rolId.data}&error=guardar`);
  }
  revalidatePath(RUTA);
  redirect(`${RUTA}?rol=${rolId.data}&ok=permisos`);
}

export async function crearRol(formData: FormData) {
  await exigirSuperadmin();
  const datos = rolNuevoSchema.safeParse({
    codigo: formData.get("codigo"),
    nombre: formData.get("nombre"),
    descripcion: formData.get("descripcion") || undefined,
    alcance: formData.get("alcance"),
    requiere_mfa: formData.get("requiere_mfa") === "on",
  });
  if (!datos.success) redirect(`${RUTA}?error=datos`);

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.from("roles").insert(datos.data).select("id").single();
  if (error || !data) {
    redirect(`${RUTA}?error=${error?.code === "23505" ? "duplicado" : "guardar"}`);
  }
  revalidatePath(RUTA);
  redirect(`${RUTA}?rol=${data.id}&ok=creado`);
}

export async function cambiarEstadoRol(formData: FormData) {
  await exigirSuperadmin();
  const rolId = z.uuid().safeParse(formData.get("rolId"));
  const activo = formData.get("activo") === "1";
  if (!rolId.success) redirect(`${RUTA}?error=datos`);

  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("roles").update({ activo }).eq("id", rolId.data).neq("codigo", "superadmin");
  if (error) redirect(`${RUTA}?rol=${rolId.data}&error=guardar`);
  revalidatePath(RUTA);
  redirect(`${RUTA}?rol=${rolId.data}&ok=estado`);
}

export async function cambiarMfaRol(formData: FormData) {
  await exigirSuperadmin();
  const rolId = z.uuid().safeParse(formData.get("rolId"));
  const requiere = formData.get("requiere_mfa") === "1";
  if (!rolId.success) redirect(`${RUTA}?error=datos`);

  const supabase = await crearClienteServidor();
  // El Superadmin siempre exige verificación en dos pasos.
  const { error } = await supabase
    .from("roles")
    .update({ requiere_mfa: requiere })
    .eq("id", rolId.data)
    .neq("codigo", "superadmin");
  if (error) redirect(`${RUTA}?rol=${rolId.data}&error=guardar`);
  revalidatePath(RUTA);
  redirect(`${RUTA}?rol=${rolId.data}&ok=estado`);
}
