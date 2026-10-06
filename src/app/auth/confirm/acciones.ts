"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const TIPOS: EmailOtpType[] = ["recovery", "invite", "email", "email_change", "magiclink", "signup"];

export async function confirmarEnlace(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const tipo = String(formData.get("type") ?? "") as EmailOtpType;

  if (!/^[A-Za-z0-9_-]{10,200}$/.test(tokenHash) || !TIPOS.includes(tipo)) {
    redirect("/login?motivo=enlace");
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash });
  if (error) redirect("/login?motivo=enlace");

  redirect(tipo === "recovery" || tipo === "invite" ? "/cambiar-password" : "/menu");
}
