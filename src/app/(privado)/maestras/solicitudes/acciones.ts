"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { permisoEnAccion } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { claveError } from "@/lib/maestras/errores";
import { retorno } from "@/lib/maestras/retorno";
import { passwordTemporal } from "@/lib/password-temporal";
import { crearClienteAdmin, hayClaveAdmin } from "@/lib/supabase/admin";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/maestras/solicitudes";

async function aprobador() {
  const ctx = await permisoEnAccion("maestras.solicitudes", "aprobar");
  return ctx && ctx.alcance === "todas" ? ctx : null;
}

export type EstadoAprobacion = { error?: string; correo?: string; password?: string; aviso?: string };

/**
 * Aprueba la solicitud (crea o reutiliza la empresa, sus contactos y frentes) y
 * crea la cuenta del usuario como Contratista de esa empresa. Si la solicitud ya
 * estaba aprobada pero sin usuario, solo intenta crear la cuenta.
 */
export async function aprobarSolicitud(_prev: EstadoAprobacion, formData: FormData): Promise<EstadoAprobacion> {
  if (!(await aprobador())) return { error: "No tienes permiso para aprobar solicitudes." };
  const id = formData.get("id");
  if (!esUuid(id)) return { error: "Solicitud no válida." };
  if (!hayClaveAdmin()) return { error: "Falta configurar SUPABASE_SECRET_KEY en el servidor." };

  const supabase = await crearClienteServidor();
  const { data: s } = await supabase
    .from("solicitudes_registro")
    .select("id, ruc, estado, usuario_nombre, usuario_correo, empresa_id, usuario_id")
    .eq("id", id)
    .maybeSingle();
  if (!s) return { error: "La solicitud no existe." };
  if (s.estado === "rechazada" || (s.estado === "aprobada" && s.usuario_id)) return { error: "La solicitud ya fue revisada." };

  let empresaId = s.empresa_id as string | null;
  if (s.estado === "pendiente") {
    // Si el RUC ya existe, el solicitante tendrá acceso a los datos de esa empresa:
    // se exige que quien aprueba confirme expresamente que pertenece a ella.
    const { data: existente } = await supabase.from("empresas").select("id").eq("ruc", s.ruc).maybeSingle();
    if (existente && formData.get("confirmar_empresa") !== "on") {
      return { error: "Ese RUC ya existe. Confirma que el solicitante pertenece a esa empresa antes de aprobar." };
    }
    const { data, error } = await supabase.rpc("aprobar_solicitud", { p_id: id });
    if (error) {
      console.error("[solicitudes] aprobar:", error.code);
      return { error: "No se pudo aprobar. Revisa que los datos de la solicitud sean válidos." };
    }
    empresaId = data as string;
    revalidatePath(RUTA);
  }

  const admin = crearClienteAdmin();
  const password = passwordTemporal();
  const { data: creado, error: e2 } = await admin.auth.admin.createUser({
    email: s.usuario_correo,
    password,
    email_confirm: true,
    app_metadata: {
      rol_codigo: "contratista",
      nombre: s.usuario_nombre,
      // Hace que el correo automático sea el de "registro aprobado".
      solicitud_id: id,
      empresa_id: empresaId,
      debe_cambiar_password: true,
    },
  });
  if (e2 || !creado.user) {
    const existe = e2?.code === "email_exists" || /already|registered|exists/i.test(e2?.message ?? "");
    return {
      aviso: existe
        ? "La empresa quedó registrada, pero ya existe una cuenta con ese correo. Asígnale la empresa desde Usuarios."
        : "La empresa quedó registrada, pero no se pudo crear la cuenta. Usa “Crear usuario” para reintentar.",
    };
  }

  const { error: e3 } = await supabase.rpc("vincular_usuario_solicitud", { p_id: id, p_usuario_id: creado.user.id });
  revalidatePath(RUTA);
  if (e3) {
    console.error("[solicitudes] vincular:", e3.code);
    return {
      correo: s.usuario_correo,
      password,
      aviso: "La cuenta se creó, pero no quedó enlazada a la solicitud. No es necesario reintentar.",
    };
  }
  return { correo: s.usuario_correo, password };
}

const motivoSchema = z.string().trim().min(5, "Indica el motivo (mínimo 5 caracteres)").max(500);

export async function rechazarSolicitud(formData: FormData) {
  const id = formData.get("id");
  if (!(await aprobador())) redirect(retorno(RUTA, formData, { error: "permiso" }));
  if (!esUuid(id)) redirect(retorno(RUTA, formData, { error: "datos" }));
  const motivo = motivoSchema.safeParse(formData.get("motivo"));
  if (!motivo.success) redirect(retorno(RUTA, formData, { id, error: "datos" }));

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("rechazar_solicitud", { p_id: id, p_motivo: motivo.data });
  if (error) redirect(retorno(RUTA, formData, { id, error: claveError(error.code) }));
  revalidatePath(RUTA);
  redirect(retorno(RUTA, formData, { id, ok: "rechazada" }));
}
