import type { Metadata } from "next";
import { BotonEnviar } from "@/components/BotonEnviar";
import { MarcoPublico } from "@/components/MarcoPublico";
import { confirmarEnlace } from "./acciones";

export const metadata: Metadata = { title: "Confirmar" };

/**
 * Los enlaces de correo llegan aquí. El código se usa recién al pulsar el botón (POST):
 * así los antivirus de correo que "abren" los enlaces no lo gastan antes que el usuario.
 */
export default async function PaginaConfirmar({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash, type } = await searchParams;
  const titulo = type === "invite" ? "Activa tu cuenta" : "Crea una nueva contraseña";
  return (
    <MarcoPublico version={false}>
      <h1 className="text-center text-2xl font-semibold text-white">{titulo}</h1>
      <form action={confirmarEnlace} className="flex flex-col items-center gap-4">
        <input type="hidden" name="token_hash" value={token_hash ?? ""} />
        <input type="hidden" name="type" value={type ?? ""} />
        <BotonEnviar className="btn-oliva" pendiente="Verificando…">
          Continuar
        </BotonEnviar>
      </form>
    </MarcoPublico>
  );
}
