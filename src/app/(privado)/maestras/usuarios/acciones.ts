"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esSuperadmin, permisoEnAccion, type Contexto } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { usuarioEdicionSchema, usuarioNuevoSchema, uuidONulo } from "@/lib/maestras/esquemas";
import { claveError } from "@/lib/maestras/errores";
import { retorno } from "@/lib/maestras/retorno";
import { passwordTemporal } from "@/lib/password-temporal";
import { crearClienteAdmin, hayClaveAdmin } from "@/lib/supabase/admin";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/maestras/usuarios";
const BLOQUEO = "876000h"; // ~100 años: la cuenta queda bloqueada en Auth hasta reactivarla.

type Rol = { id: string; codigo: string; alcance: "empresa" | "todas" | "comedor"; activo: boolean };

/** Lee el rol con la sesión del usuario (RLS) y ajusta empresa/comedor según su alcance. */
async function resolverRol(
  ctx: Contexto,
  rolId: string,
  empresaId: string | null,
  comedorId: string | null,
): Promise<{ rol: Rol; empresa_id: string | null; comedor_id: string | null } | { error: string }> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("roles").select("id, codigo, alcance, activo").eq("id", rolId).maybeSingle();
  const rol = data as Rol | null;
  if (!rol || !rol.activo) return { error: "El rol no existe o está inactivo." };
  if (rol.codigo === "superadmin" && !esSuperadmin(ctx)) return { error: "Solo un Superadmin puede asignar ese rol." };
  if (rol.alcance === "empresa" && !empresaId) return { error: "Elige la empresa del usuario." };
  if (rol.alcance === "comedor" && !comedorId) return { error: "Elige el comedor del usuario." };
  return {
    rol,
    empresa_id: rol.alcance === "empresa" ? empresaId : null,
    comedor_id: rol.alcance === "comedor" ? comedorId : null,
  };
}

/** Datos del usuario objetivo, leídos con RLS (si no lo puede ver, no lo puede tocar). */
async function usuarioVisible(id: string) {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("perfiles").select("id, correo, estado, roles(codigo)").eq("id", id).maybeSingle();
  return data as { id: string; correo: string; estado: string; roles: { codigo: string } | null } | null;
}

export type EstadoNuevoUsuario = { error?: string; correo?: string; password?: string; id?: string };

export async function crearUsuario(_prev: EstadoNuevoUsuario, formData: FormData): Promise<EstadoNuevoUsuario> {
  const ctx = await permisoEnAccion("maestras.usuarios", "crear");
  if (!ctx || ctx.alcance !== "todas") return { error: "No tienes permiso para crear usuarios." };

  const datos = usuarioNuevoSchema.safeParse({
    nombre: formData.get("nombre"),
    correo: formData.get("correo"),
    rol_id: formData.get("rol_id"),
    empresa_id: uuidONulo(formData.get("empresa_id")),
    comedor_id: uuidONulo(formData.get("comedor_id")),
  });
  if (!datos.success) return { error: datos.error.issues[0]?.message ?? "Revisa los datos." };

  const r = await resolverRol(ctx, datos.data.rol_id, datos.data.empresa_id, datos.data.comedor_id);
  if ("error" in r) return { error: r.error };

  if (!hayClaveAdmin()) return { error: "Falta configurar SUPABASE_SECRET_KEY en el servidor." };
  const password = passwordTemporal();
  const { data, error } = await crearClienteAdmin().auth.admin.createUser({
    email: datos.data.correo,
    password,
    email_confirm: true,
    // Rol y empresa en app_metadata: solo el servidor puede escribirlos.
    app_metadata: {
      rol_codigo: r.rol.codigo,
      nombre: datos.data.nombre,
      empresa_id: r.empresa_id,
      comedor_id: r.comedor_id,
      debe_cambiar_password: true,
    },
  });
  if (error || !data.user) {
    const existe = error?.code === "email_exists" || /already|registered|exists/i.test(error?.message ?? "");
    return { error: existe ? "Ya existe un usuario con ese correo." : "No se pudo crear el usuario. Inténtalo de nuevo." };
  }
  revalidatePath(RUTA);
  return { correo: datos.data.correo, password, id: data.user.id };
}

export async function guardarUsuario(formData: FormData) {
  const ctx = await permisoEnAccion("maestras.usuarios", "editar");
  const id = esUuid(formData.get("id")) ? String(formData.get("id")) : undefined;
  if (!ctx) redirect(retorno(RUTA, formData, { id, error: "permiso" }));

  const datos = usuarioEdicionSchema.safeParse({
    id: formData.get("id"),
    nombre: formData.get("nombre"),
    rol_id: formData.get("rol_id"),
    empresa_id: uuidONulo(formData.get("empresa_id")),
    comedor_id: uuidONulo(formData.get("comedor_id")),
  });
  if (!datos.success) redirect(retorno(RUTA, formData, { id, error: "datos" }));

  const r = await resolverRol(ctx, datos.data.rol_id, datos.data.empresa_id, datos.data.comedor_id);
  if ("error" in r) redirect(retorno(RUTA, formData, { id, error: "datos" }));

  // Una cuenta pendiente se activa al recibir su rol (solo si de verdad está pendiente).
  const activar = formData.get("activar") === "1" && (await usuarioVisible(datos.data.id))?.estado === "pendiente";

  // La actualización pasa por RLS y por los triggers que impiden escalar privilegios.
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from("perfiles")
    .update({
      nombre: datos.data.nombre,
      rol_id: r.rol.id,
      empresa_id: r.empresa_id,
      comedor_id: r.comedor_id,
      ...(activar ? { estado: "activo" } : {}),
    })
    .eq("id", datos.data.id)
    .select("id");
  if (error || !data?.length) redirect(retorno(RUTA, formData, { id, error: error ? claveError(error.code) : "noexiste" }));
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { id, ok: "guardado" }));
}

export async function cambiarEstadoUsuario(formData: FormData) {
  const ctx = await permisoEnAccion("maestras.usuarios", "editar");
  const id = formData.get("id");
  // Bloquear en Auth usa la clave secreta: solo roles de alcance "todas".
  if (!ctx || ctx.alcance !== "todas") redirect(retorno(RUTA, formData, { error: "permiso" }));
  if (!esUuid(id)) redirect(retorno(RUTA, formData, { error: "datos" }));
  if (id === ctx.usuario_id) redirect(retorno(RUTA, formData, { id, error: "regla" }));
  if (!hayClaveAdmin()) redirect(retorno(RUTA, formData, { id, error: "guardar" }));
  const activar = formData.get("activo") === "1";

  // 1) El perfil (con RLS y triggers). 2) Recién entonces, el bloqueo en Auth.
  const supabase = await crearClienteServidor();
  const nuevo = activar ? "activo" : "inactivo";
  const anterior = activar ? "inactivo" : "activo";
  // Solo cambia si está en el estado opuesto (así el trigger siempre valida el cambio).
  const { data, error } = await supabase
    .from("perfiles")
    .update({ estado: nuevo })
    .eq("id", id)
    .eq("estado", anterior)
    .select("id");
  if (error || !data?.length) redirect(retorno(RUTA, formData, { id, error: error ? claveError(error.code) : "noexiste" }));

  const { error: e2 } = await crearClienteAdmin().auth.admin.updateUserById(id, {
    ban_duration: activar ? "none" : BLOQUEO,
  });
  if (e2) {
    console.error("[usuarios] ban_duration:", e2.code ?? e2.message);
    // Se deshace el cambio del perfil para que Auth y la app no queden desalineados.
    await supabase.from("perfiles").update({ estado: anterior }).eq("id", id);
    redirect(retorno(RUTA, formData, { id, error: "guardar" }));
  }
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { id, ok: "estado" }));
}

export type EstadoPassword = { error?: string; password?: string; aviso?: string };

/** Genera una contraseña temporal; el usuario deberá cambiarla al ingresar. */
export async function restablecerPassword(_prev: EstadoPassword, formData: FormData): Promise<EstadoPassword> {
  const ctx = await permisoEnAccion("maestras.usuarios", "editar");
  const id = formData.get("id");
  // Cambiar contraseñas usa la clave secreta: solo roles de alcance "todas".
  if (!ctx || ctx.alcance !== "todas") return { error: "No tienes permiso." };
  if (!esUuid(id)) return { error: "Usuario no válido." };
  if (!hayClaveAdmin()) return { error: "Falta configurar SUPABASE_SECRET_KEY en el servidor." };
  if (id === ctx.usuario_id) return { error: "Para cambiar tu propia contraseña usa la opción de tu perfil." };

  const objetivo = await usuarioVisible(id);
  if (!objetivo) return { error: "El usuario no existe o no tienes acceso." };
  if (objetivo.roles?.codigo === "superadmin" && !esSuperadmin(ctx)) {
    return { error: "Solo un Superadmin puede restablecer la contraseña de otro Superadmin." };
  }

  const password = passwordTemporal();
  const { error } = await crearClienteAdmin().auth.admin.updateUserById(id, { password });
  if (error) return { error: "No se pudo restablecer la contraseña." };

  // Después de guardar la contraseña (el trigger de Auth limpia la marca), se obliga a cambiarla.
  const supabase = await crearClienteServidor();
  const { data, error: e2 } = await supabase.from("perfiles").update({ debe_cambiar_password: true }).eq("id", id).select("id");
  if (e2 || !data?.length) {
    return { password, aviso: "No se pudo exigir el cambio de contraseña al ingresar. Pídele al usuario que la cambie." };
  }
  return { password };
}
