"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { permisoEnAccion } from "@/lib/auth";
import { detectarTipo, nombreSeguro } from "@/lib/archivos";
import { esUuid } from "@/lib/busqueda";
import { leerConfig, numero } from "@/lib/contenido/servidor";
import { esTipoDocumento, TIPOS_DOCUMENTO } from "@/lib/contenido/tipos";
import { claveError } from "@/lib/maestras/errores";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { registrarError } from "@/lib/errores";

/** Publica una nueva versión de un PDF (menú semanal, términos o manual). */
export async function publicarDocumento(formData: FormData) {
  const tipo = formData.get("tipo");
  if (!esTipoDocumento(tipo)) redirect("/menu");
  const { menu, ruta: volver } = TIPOS_DOCUMENTO[tipo];
  const ir: (q: string) => never = (q) => redirect(`${volver}?${q}#${tipo}`);

  if (!(await permisoEnAccion(menu, "editar"))) ir("error=permiso");
  const archivo = formData.get("archivo");
  const titulo = String(formData.get("titulo") ?? "").trim();
  if (!(archivo instanceof File) || archivo.size === 0 || titulo.length < 1 || titulo.length > 120) ir("error=datos");
  const pdf = archivo as File;

  const config = await leerConfig(["archivos.pdf_menu_max_bytes", "archivos.documento_max_bytes"]);
  const limite = tipo.startsWith("menu_")
    ? numero(config.get("archivos.pdf_menu_max_bytes"), 1_048_576)
    : numero(config.get("archivos.documento_max_bytes"), 10_485_760);
  if (pdf.size > limite) ir(`error=tamano&max=${Math.floor(limite / 1024)}`);

  const bytes = new Uint8Array(await pdf.arrayBuffer());
  if (detectarTipo(bytes)?.mime !== "application/pdf") ir("error=archivo");

  const supabase = await crearClienteServidor();
  const ruta = `${tipo}/${crypto.randomUUID()}.pdf`;
  const { error: eSubir } = await supabase.storage
    .from("documentos")
    .upload(ruta, bytes, { contentType: "application/pdf", upsert: false, cacheControl: "0" });
  if (eSubir) {
    await registrarError("documentos subir", eSubir.message);
    ir("error=guardar");
  }
  const { error } = await supabase.rpc("registrar_documento", {
    p_tipo: tipo,
    p_ruta: ruta,
    p_nombre: nombreSeguro(pdf.name, "documento.pdf"),
    p_titulo: titulo,
  });
  if (error) ir(`error=${claveError(error.code)}`);
  revalidatePath(volver);
  ir("ok=publicado");
}

/** Vuelve a publicar una versión anterior. */
export async function restaurarDocumento(formData: FormData) {
  const tipo = formData.get("tipo");
  const id = formData.get("id");
  if (!esTipoDocumento(tipo) || !esUuid(id)) redirect("/menu");
  const { menu, ruta: volver } = TIPOS_DOCUMENTO[tipo];
  if (!(await permisoEnAccion(menu, "editar"))) redirect(`${volver}?error=permiso#${tipo}`);
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("restaurar_documento", { p_id: id });
  if (error) redirect(`${volver}?error=${claveError(error.code)}#${tipo}`);
  revalidatePath(volver);
  redirect(`${volver}?ok=restaurado#${tipo}`);
}
