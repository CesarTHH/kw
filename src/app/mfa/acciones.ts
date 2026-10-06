"use server";

import { redirect } from "next/navigation";
import { rutaSegura } from "@/lib/rutas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { codigoMfaSchema, primerError } from "@/lib/validaciones";

export type EstadoMfa = { error?: string };

export async function verificarMfa(_prev: EstadoMfa, formData: FormData): Promise<EstadoMfa> {
  const datos = codigoMfaSchema.safeParse({
    factorId: formData.get("factorId"),
    codigo: formData.get("codigo"),
  });
  if (!datos.success) return { error: primerError(datos.error) };
  const nuevo = formData.get("nuevo") === "1";

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: datos.data.factorId,
    code: datos.data.codigo,
  });
  if (error) {
    return { error: "Código incorrecto o vencido. Revisa la hora de tu celular e inténtalo de nuevo." };
  }

  await supabase.rpc("registrar_evento", { p_accion: nuevo ? "mfa_activado" : "mfa_verificado" });
  redirect(rutaSegura(String(formData.get("next") ?? "")));
}

export type EstadoAlta = { factorId?: string; qr?: string; secreto?: string; error?: string };

/** Registra un autenticador nuevo. Se ejecuta solo al pulsar el botón (no al cargar la página). */
export async function iniciarAltaMfa(_prev: EstadoAlta): Promise<EstadoAlta> {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: factores } = await supabase.auth.mfa.listFactors();
  if (factores?.totp?.length) return { error: "Ya tienes un autenticador activo. Recarga la página." };
  for (const f of factores?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data: alta, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Autenticador ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !alta) return { error: "No se pudo generar el código. Inténtalo de nuevo." };
  return { factorId: alta.id, qr: alta.totp.qr_code, secreto: alta.totp.secret };
}
