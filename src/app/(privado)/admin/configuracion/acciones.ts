"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esSuperadmin, permisoEnAccion } from "@/lib/auth";
import { claveError } from "@/lib/maestras/errores";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { correoSchema } from "@/lib/validaciones";
import { CLAVES_EDITABLES } from "@/lib/configuracion";

const RUTA = "/admin/configuracion";
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Convierte lo escrito en el formulario al mismo tipo JSON que el valor actual. */
function convertir(actual: unknown, crudo: FormDataEntryValue | null): { ok: true; valor: unknown } | { ok: false } {
  if (typeof actual === "boolean") return { ok: true, valor: crudo === "on" };
  if (typeof crudo !== "string") return { ok: false };
  const texto = crudo.trim();
  if (typeof actual === "number") {
    if (!/^\d{1,9}$/.test(texto)) return { ok: false };
    return { ok: true, valor: Number(texto) };
  }
  if (typeof actual === "string") return texto.length <= 300 ? { ok: true, valor: texto } : { ok: false };
  return { ok: false };
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function guardarHorarios(formData: FormData) {
  if (!(await permisoEnAccion("admin.configuracion", "editar"))) redirect(`${RUTA}?error=permiso`);
  const supabase = await crearClienteServidor();
  const { data: reglas, error: e1 } = await supabase.from("config_horarios").select("modulo, regla, valor");
  if (e1 || !reglas) redirect(`${RUTA}?error=guardar`);

  const cambios: { modulo: string; regla: string; valor: unknown }[] = [];
  for (const r of reglas as { modulo: string; regla: string; valor: unknown }[]) {
    const clave = `${r.modulo}.${r.regla}`;
    let nuevo: unknown;
    if (r.valor && typeof r.valor === "object" && !Array.isArray(r.valor)) {
      // { dia_semana, hora }
      const dia = String(formData.get(`${clave}.dia_semana`) ?? "");
      const hora = String(formData.get(`${clave}.hora`) ?? "");
      if (!/^[1-7]$/.test(dia) || !HORA.test(hora)) redirect(`${RUTA}?error=datos`);
      nuevo = { ...(r.valor as Record<string, unknown>), dia_semana: Number(dia), hora };
    } else {
      const c = convertir(r.valor, formData.get(clave));
      if (!c.ok) redirect(`${RUTA}?error=datos`);
      nuevo = c.valor;
      if (typeof r.valor === "string" && !HORA.test(String(nuevo))) redirect(`${RUTA}?error=datos`);
      if (typeof r.valor === "number" && Number(nuevo) > 1000) redirect(`${RUTA}?error=datos`);
    }
    if (!igual(nuevo, r.valor)) cambios.push({ modulo: r.modulo, regla: r.regla, valor: nuevo });
  }

  for (const c of cambios) {
    const { error } = await supabase
      .from("config_horarios")
      .update({ valor: c.valor })
      .eq("modulo", c.modulo)
      .eq("regla", c.regla);
    if (error) redirect(`${RUTA}?error=${claveError(error.code)}`);
  }
  revalidatePath(RUTA);
  redirect(`${RUTA}?ok=guardado`);
}

export async function guardarGeneral(formData: FormData) {
  const ctx = await permisoEnAccion("admin.configuracion", "editar");
  if (!ctx) redirect(`${RUTA}?error=permiso`);
  const superadmin = esSuperadmin(ctx);
  const supabase = await crearClienteServidor();
  const { data: filas, error: e1 } = await supabase
    .from("configuracion")
    .select("clave, valor")
    .in("clave", [...CLAVES_EDITABLES]);
  if (e1 || !filas) redirect(`${RUTA}?error=guardar`);

  const cambios: { clave: string; valor: unknown }[] = [];
  for (const f of filas as { clave: string; valor: unknown }[]) {
    // Remitente, copia oculta y modo de envío: solo el Superadmin (también lo exige la base de datos).
    if (f.clave.startsWith("correo.") && !superadmin) continue;
    const c = convertir(f.valor, formData.get(f.clave));
    if (!c.ok) redirect(`${RUTA}?error=datos`);
    let valor = c.valor;
    if (f.clave === "zona_horaria" && !Intl.supportedValuesOf("timeZone").includes(String(valor))) redirect(`${RUTA}?error=datos`);
    if (f.clave === "correo.modo" && valor !== "registrar" && valor !== "enviar") redirect(`${RUTA}?error=datos`);
    if (f.clave === "app.url") {
      const url = String(valor).replace(/\/+$/, "");
      if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) redirect(`${RUTA}?error=datos`);
      valor = url;
    }
    if (
      (f.clave === "correo.cco_interno" || f.clave === "contacto.destinatario" || f.clave === "correo.remitente_direccion") &&
      valor !== ""
    ) {
      const correo = correoSchema.safeParse(valor);
      if (!correo.success) redirect(`${RUTA}?error=datos`);
      valor = correo.data;
    }
    if (f.clave.startsWith("archivos.") && (Number(valor) < 1024 || Number(valor) > 10 * 1024 * 1024)) {
      redirect(`${RUTA}?error=datos`);
    }
    if ((f.clave === "contacto.cc_maximo" || f.clave === "contacto.max_por_hora") && (Number(valor) < 1 || Number(valor) > 100)) {
      redirect(`${RUTA}?error=datos`);
    }
    if (!igual(valor, f.valor)) cambios.push({ clave: f.clave, valor });
  }

  for (const c of cambios) {
    const { error } = await supabase.from("configuracion").update({ valor: c.valor }).eq("clave", c.clave);
    if (error) redirect(`${RUTA}?error=${claveError(error.code)}`);
  }
  revalidatePath(RUTA);
  redirect(`${RUTA}?ok=guardado`);
}
