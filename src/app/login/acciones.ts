"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ipCliente } from "@/lib/ip";
import { Limitador } from "@/lib/limitador";
import { rutaSegura } from "@/lib/rutas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { loginSchema } from "@/lib/validaciones";

// Además de los límites de Supabase Auth:
// 5 intentos cada 15 min por correo, y 30 cada 15 min por IP.
const porCorreo = new Limitador(5, 15 * 60_000);
const porIp = new Limitador(30, 15 * 60_000);

export type EstadoLogin = { error?: string };

export async function iniciarSesion(_prev: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  const datos = loginSchema.safeParse({
    correo: formData.get("correo"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!datos.success) {
    return { error: "Ingresa un correo y una contraseña válidos." };
  }

  const ip = ipCliente((await headers()).get("x-forwarded-for"));
  if (!porIp.permitir(ip) || !porCorreo.permitir(datos.data.correo)) {
    return { error: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo." };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: datos.data.correo,
    password: datos.data.password,
  });
  if (error) {
    // Mensaje genérico: no revela si el correo existe.
    return { error: "Correo o contraseña incorrectos." };
  }

  porCorreo.reiniciar(datos.data.correo);
  await supabase.rpc("registrar_evento", { p_accion: "login" });
  redirect(rutaSegura(datos.data.next));
}
