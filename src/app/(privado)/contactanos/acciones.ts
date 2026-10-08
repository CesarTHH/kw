"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { permisoEnAccion } from "@/lib/auth";
import { detectarTipo, nombreSeguro } from "@/lib/archivos";
import { esUuid } from "@/lib/busqueda";
import { leerConfig, numero } from "@/lib/contenido/servidor";
import { Limitador } from "@/lib/limitador";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { registrarError } from "@/lib/errores";

// Además del límite por hora de la base de datos: 5 intentos cada 10 minutos por usuario.
const porUsuario = new Limitador(5, 10 * 60_000);
const correo = z.email().max(254);

export type ResultadoContacto = { ok: true } | { ok: false; error: string };

export async function enviarContacto(formData: FormData): Promise<ResultadoContacto> {
  const ctx = await permisoEnAccion("contactanos", "enviar");
  if (!ctx) return { ok: false, error: "No tienes permiso para enviar mensajes." };
  if (!porUsuario.permitir(ctx.usuario_id)) {
    return { ok: false, error: "Enviaste varios mensajes seguidos. Espera unos minutos e inténtalo de nuevo." };
  }

  const clave = formData.get("clave");
  const asunto = String(formData.get("asunto") ?? "").trim();
  const mensaje = String(formData.get("mensaje") ?? "").trim();
  const cc = String(formData.get("cc") ?? "")
    .split(/[\s,;]+/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (!esUuid(clave)) return { ok: false, error: "Datos no válidos. Recarga la página." };
  if (asunto.length < 1 || asunto.length > 200) return { ok: false, error: "El asunto debe tener entre 1 y 200 caracteres." };
  if (mensaje.length < 1 || mensaje.length > 5000) return { ok: false, error: "El mensaje debe tener entre 1 y 5000 caracteres." };
  if (cc.length > 20 || cc.some((c) => !correo.safeParse(c).success)) {
    return { ok: false, error: "Revisa las direcciones en copia (CC)." };
  }

  const archivos = formData.getAll("adjuntos").filter((a): a is File => a instanceof File && a.size > 0);
  const config = await leerConfig([
    "archivos.contacto_max_bytes",
    "archivos.contacto_tipos",
    "contacto.cc_maximo",
    "contacto.max_por_hora",
  ]);
  const ccMaximo = numero(config.get("contacto.cc_maximo"), 5);
  if (cc.length > ccMaximo) return { ok: false, error: `Puedes poner hasta ${ccMaximo} direcciones en copia.` };

  // Antes de subir archivos: ¿el usuario todavía puede enviar en esta hora? (la base de datos lo vuelve a verificar)
  const supabase = await crearClienteServidor();
  const haceUnaHora = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await supabase
    .from("mensajes_contacto")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", ctx.usuario_id)
    .gte("created_at", haceUnaHora);
  if ((count ?? 0) >= numero(config.get("contacto.max_por_hora"), 10)) {
    return { ok: false, error: "Enviaste demasiados mensajes en la última hora. Inténtalo más tarde." };
  }

  const maximo = numero(config.get("archivos.contacto_max_bytes"), 10_485_760);
  const tipos = config.get("archivos.contacto_tipos");
  const permitidos = Array.isArray(tipos) ? tipos.filter((t): t is string => typeof t === "string") : [];
  if (archivos.length > 10) return { ok: false, error: "Puedes adjuntar hasta 10 archivos." };
  if (archivos.reduce((s, a) => s + a.size, 0) > maximo) {
    return { ok: false, error: `Los adjuntos superan el máximo de ${Math.round((maximo / 1_048_576) * 10) / 10} MB.` };
  }

  // Cada archivo se valida por su contenido real antes de subirlo.
  const listos: { bytes: Uint8Array; mime: string; ext: string; nombre: string }[] = [];
  for (const a of archivos) {
    const bytes = new Uint8Array(await a.arrayBuffer());
    const tipo = detectarTipo(bytes);
    const nombre = nombreSeguro(a.name);
    if (!tipo || !permitidos.includes(tipo.mime)) {
      return { ok: false, error: `"${nombre}" no es de un tipo permitido (PDF, imágenes PNG/JPG, Excel o Word).` };
    }
    listos.push({ bytes, mime: tipo.mime, ext: tipo.ext, nombre });
  }

  const adjuntos: { ruta: string; nombre: string }[] = [];
  for (const a of listos) {
    const ruta = `${ctx.usuario_id}/${crypto.randomUUID()}.${a.ext}`;
    const { error } = await supabase.storage.from("contacto").upload(ruta, a.bytes, { contentType: a.mime, upsert: false });
    if (error) {
      await registrarError("contacto subir", error.message);
      return { ok: false, error: "No se pudo subir un adjunto. Inténtalo de nuevo." };
    }
    adjuntos.push({ ruta, nombre: a.nombre });
  }

  const { error } = await supabase.rpc("enviar_contacto", {
    p_cc: cc,
    p_asunto: asunto,
    p_mensaje: mensaje,
    p_adjuntos: adjuntos,
    p_clave: clave,
  });
  if (error) {
    if (error.code === "22023" || error.code === "42501") return { ok: false, error: error.message };
    await registrarError("contacto", error.code, error.message);
    return { ok: false, error: "No se pudo enviar el mensaje. Inténtalo de nuevo." };
  }
  revalidatePath("/contactanos");
  return { ok: true };
}
