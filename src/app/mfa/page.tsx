import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MarcoPublico } from "@/components/MarcoPublico";
import { rutaSegura } from "@/lib/rutas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { AltaMfa } from "./AltaMfa";
import { FormMfa } from "./FormMfa";

export const metadata: Metadata = { title: "Verificación en dos pasos" };

export default async function PaginaMfa({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (nivel?.currentLevel === "aal2") redirect(rutaSegura(next));

  const { data: factores } = await supabase.auth.mfa.listFactors();
  const verificado = factores?.totp?.[0];

  if (verificado) {
    return (
      <MarcoPublico version={false}>
        <h1 className="text-center text-2xl font-semibold text-white">Verificación en dos pasos</h1>
        <p className="text-center text-sm text-white">Ingresa el código que muestra tu app de autenticación.</p>
        <FormMfa factorId={verificado.id} nuevo={false} next={next} />
      </MarcoPublico>
    );
  }

  return (
    <MarcoPublico version={false}>
      <h1 className="text-center text-2xl font-semibold text-white">Activa la verificación en dos pasos</h1>
      <AltaMfa next={next} />
    </MarcoPublico>
  );
}
