"use server";

import { headers } from "next/headers";
import { SITE_URL } from "@/lib/env";
import { ipCliente } from "@/lib/ip";
import { Limitador } from "@/lib/limitador";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { correoSchema } from "@/lib/validaciones";

const porCorreo = new Limitador(3, 60 * 60_000);
const porIp = new Limitador(20, 60 * 60_000);

export type EstadoOlvido = { enviado?: boolean; error?: string };

export async function solicitarRecuperacion(_prev: EstadoOlvido, formData: FormData): Promise<EstadoOlvido> {
  const correo = correoSchema.safeParse(formData.get("correo"));
  if (!correo.success) return { error: "Ingresa un correo válido." };

  const ip = ipCliente((await headers()).get("x-forwarded-for"));
  if (!porIp.permitir(ip) || !porCorreo.permitir(correo.data)) {
    // Misma respuesta que el caso exitoso: no se revela nada.
    return { enviado: true };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.resetPasswordForEmail(correo.data, {
    redirectTo: `${SITE_URL}/auth/confirm?next=/cambiar-password`,
  });
  if (error) console.error("[recuperación] error de Supabase:", error.status);

  // Siempre la misma respuesta, exista o no la cuenta.
  return { enviado: true };
}
