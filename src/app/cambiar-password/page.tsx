import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MarcoPublico } from "@/components/MarcoPublico";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { FormCambio } from "./FormCambio";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default async function PaginaCambioPassword() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Si la cuenta tiene segundo factor, Supabase exige verificarlo antes de cambiar la contraseña.
  const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (nivel && nivel.nextLevel === "aal2" && nivel.currentLevel !== "aal2") {
    redirect("/mfa?next=/cambiar-password");
  }

  return (
    <MarcoPublico version={false}>
      <h1 className="text-center text-2xl font-semibold text-white">Crea tu contraseña</h1>
      <FormCambio />
    </MarcoPublico>
  );
}
