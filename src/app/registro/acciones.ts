"use server";

import { headers } from "next/headers";
import { ipCliente } from "@/lib/ip";
import { Limitador } from "@/lib/limitador";
import { solicitudSchema } from "@/lib/maestras/esquemas";
import { crearClienteAdmin, hayClaveAdmin } from "@/lib/supabase/admin";

// Formulario público: límites estrictos para frenar el abuso.
const porIp = new Limitador(5, 60 * 60_000); // 5 por hora por IP
const porCorreo = new Limitador(3, 24 * 60 * 60_000); // 3 por día por correo

export type EstadoRegistro = { error?: string; enviado?: boolean };

function leerJson(v: FormDataEntryValue | null): unknown {
  if (typeof v !== "string" || v.length > 20_000) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export async function registrarSolicitud(_prev: EstadoRegistro, formData: FormData): Promise<EstadoRegistro> {
  // Campo trampa: invisible para personas; los robots suelen llenarlo.
  if (formData.get("sitio_web")) return { enviado: true };

  const ip = ipCliente((await headers()).get("x-forwarded-for"));
  if (!porIp.permitir(ip)) return { error: "Demasiados envíos desde tu conexión. Inténtalo en una hora." };

  const contacto = (tipo: string) => ({
    tipo,
    nombre: formData.get(`${tipo}.nombre`),
    telefono: formData.get(`${tipo}.telefono`) ?? "",
    correo: formData.get(`${tipo}.correo`),
  });
  const datos = solicitudSchema.safeParse({
    ruc: formData.get("ruc"),
    razon_social: formData.get("razon_social"),
    direccion: formData.get("direccion") ?? "",
    usuario_nombre: formData.get("usuario_nombre"),
    usuario_correo: formData.get("usuario_correo"),
    usuario_telefono: formData.get("usuario_telefono") ?? "",
    frentes: leerJson(formData.get("frentes")),
    contactos: [contacto("gestion_raciones"), contacto("facturacion"), contacto("cobranzas")],
    acepta_tyc: formData.get("acepta_tyc") === "on",
  });
  if (!datos.success) return { error: datos.error.issues[0]?.message ?? "Revisa los datos ingresados." };
  if (!porCorreo.permitir(datos.data.usuario_correo)) {
    return { error: "Ya recibimos varias solicitudes con ese correo hoy. Espera nuestra respuesta." };
  }
  if (!hayClaveAdmin()) return { error: "El registro no está disponible en este momento." };

  const admin = crearClienteAdmin();
  // Los proyectos y áreas deben existir y estar activos.
  const ids = (campo: "proyecto_id" | "area_id") => [...new Set(datos.data.frentes.map((f) => f[campo]))];
  const [pr, ar] = await Promise.all([
    admin.from("proyectos").select("id").in("id", ids("proyecto_id")).eq("activo", true),
    admin.from("areas").select("id").in("id", ids("area_id")).eq("activo", true),
  ]);
  if ((pr.data?.length ?? 0) !== ids("proyecto_id").length || (ar.data?.length ?? 0) !== ids("area_id").length) {
    return { error: "Algún proyecto o área elegido ya no está disponible. Recarga la página." };
  }

  const { error } = await admin.from("solicitudes_registro").insert({
    ...datos.data,
    direccion: datos.data.direccion || null,
    usuario_telefono: datos.data.usuario_telefono || null,
    ip,
  });
  if (error) {
    if (error.code === "23505") {
      return { error: "Ya tenemos una solicitud pendiente con ese correo. Te avisaremos cuando sea revisada." };
    }
    console.error("[registro] insert:", error.code);
    return { error: "No pudimos registrar tu solicitud. Inténtalo de nuevo más tarde." };
  }
  return { enviado: true };
}
