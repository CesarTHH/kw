"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, UserRound } from "lucide-react";
import { BotonEnviar } from "@/components/BotonEnviar";
import { iniciarSesion, type EstadoLogin } from "./acciones";

export function FormLogin({ next, aviso }: { next?: string; aviso?: string }) {
  const [estado, accion] = useActionState<EstadoLogin, FormData>(iniciarSesion, {});
  const [ver, setVer] = useState(false);

  return (
    <form action={accion} className="flex w-full flex-col items-center gap-4">
      <UserRound className="size-16 text-white" strokeWidth={1.5} aria-hidden />
      <h1 className="text-2xl font-semibold text-white">Ingrese sus credenciales</h1>

      {aviso && <p className="alerta-ok w-full">{aviso}</p>}
      {estado.error && (
        <p role="alert" className="alerta-error w-full">
          {estado.error}
        </p>
      )}

      <input type="hidden" name="next" value={next ?? ""} />
      <label className="w-full">
        <span className="sr-only">Correo</span>
        <input name="correo" type="email" autoComplete="username" required placeholder="Correo" className="campo" />
      </label>
      <label className="relative w-full">
        <span className="sr-only">Contraseña</span>
        <input
          name="password"
          type={ver ? "text" : "password"}
          autoComplete="current-password"
          required
          placeholder="Contraseña"
          className="campo pr-10"
        />
        <button
          type="button"
          onClick={() => setVer((v) => !v)}
          className="absolute inset-y-0 right-1 inline-flex w-9 items-center justify-center text-gris-medio hover:text-oliva"
          aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {ver ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </label>
      <Link href="/olvide-password" className="self-end text-xs text-white underline-offset-2 hover:underline">
        ¿Olvidó su contraseña?
      </Link>
      <BotonEnviar className="btn-oliva" pendiente="Ingresando…">
        Iniciar
      </BotonEnviar>
    </form>
  );
}
