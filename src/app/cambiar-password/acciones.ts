"use server";

import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { cambioPasswordSchema, primerError } from "@/lib/validaciones";

export type EstadoCambio = { error?: string };

export async function cambiarPassword(_prev: EstadoCambio, formData: FormData): Promise<EstadoCambio> {
  const datos = cambioPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmacion: formData.get("confirmacion"),
  });
  if (!datos.success) return { error: primerError(datos.error) };

  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({ password: datos.data.password });
  if (error) {
    if (error.code === "same_password") return { error: "La nueva contraseña debe ser distinta de la anterior." };
    if (error.code === "weak_password") return { error: "La contraseña es demasiado débil o muy común." };
    console.error("[cambio de contraseña]", error.code);
    return { error: "No se pudo cambiar la contraseña. Inténtalo de nuevo." };
  }

  // La base de datos levanta la obligación de cambio y lo audita (trigger en auth.users).
  redirect("/menu");
}
