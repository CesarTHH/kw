"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/BotonEnviar";
import { iniciarAltaMfa, type EstadoAlta } from "./acciones";
import { FormMfa } from "./FormMfa";

export function AltaMfa({ next }: { next?: string }) {
  const [estado, accion] = useActionState<EstadoAlta>(iniciarAltaMfa, {});

  if (!estado.factorId) {
    return (
      <form action={accion} className="flex flex-col items-center gap-4">
        {estado.error && <p role="alert" className="alerta-error">{estado.error}</p>}
        <ol className="list-decimal space-y-1 pl-5 text-sm text-white">
          <li>Instala Google Authenticator o Microsoft Authenticator en tu celular.</li>
          <li>Pulsa el botón para ver el código QR y escanéalo con la app.</li>
          <li>Escribe el código de 6 dígitos que aparece.</li>
        </ol>
        <BotonEnviar className="btn-oliva" pendiente="Generando…">
          Mostrar código QR
        </BotonEnviar>
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- el QR llega como data URL desde Supabase */}
      <img src={estado.qr} alt="Código QR para la app de autenticación" className="size-48 rounded bg-white p-2" />
      <p className="text-center text-xs break-all text-white">
        ¿No puedes escanear? Ingresa esta clave: <span className="font-mono">{estado.secreto}</span>
      </p>
      <FormMfa factorId={estado.factorId} nuevo next={next} />
    </div>
  );
}
