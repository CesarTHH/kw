"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BotonEnviar } from "@/components/BotonEnviar";
import { MarcoPublico } from "@/components/MarcoPublico";
import { solicitarRecuperacion, type EstadoOlvido } from "./acciones";

export default function PaginaOlvido() {
  const [estado, accion] = useActionState<EstadoOlvido, FormData>(solicitarRecuperacion, {});
  return (
    <MarcoPublico>
      <h1 className="text-center text-2xl font-semibold text-white">Recuperar contraseña</h1>
      {estado.enviado ? (
        <p className="alerta-ok w-full">
          Si el correo está registrado, recibirás un enlace para crear una nueva contraseña. Revisa también la carpeta de
          spam.
        </p>
      ) : (
        <form action={accion} className="flex w-full flex-col gap-4">
          {estado.error && <p role="alert" className="alerta-error">{estado.error}</p>}
          <label>
            <span className="sr-only">Correo</span>
            <input name="correo" type="email" required autoComplete="email" placeholder="Tu correo" className="campo" />
          </label>
          <BotonEnviar className="btn-oliva" pendiente="Enviando…">
            Enviar enlace
          </BotonEnviar>
        </form>
      )}
      <Link href="/login" className="text-sm text-white underline">
        Volver al inicio de sesión
      </Link>
    </MarcoPublico>
  );
}
