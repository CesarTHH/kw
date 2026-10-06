import type { Metadata } from "next";
import { MarcoPublico } from "@/components/MarcoPublico";
import { FormLogin } from "./FormLogin";

export const metadata: Metadata = { title: "Iniciar sesión" };

const AVISOS: Record<string, string> = {
  inactivo: "Tu cuenta está inactiva. Comunícate con el administrador.",
  salida: "Cerraste sesión correctamente.",
  password: "Tu contraseña se actualizó. Ingresa con la nueva.",
  enlace: "El enlace no es válido o ya venció. Solicita uno nuevo.",
  error: "No pudimos cargar tu cuenta. Inténtalo de nuevo o comunícate con el administrador.",
};

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; motivo?: string }>;
}) {
  const { next, motivo } = await searchParams;
  return (
    <MarcoPublico>
      <FormLogin next={next} aviso={motivo ? AVISOS[motivo] : undefined} />
    </MarcoPublico>
  );
}
