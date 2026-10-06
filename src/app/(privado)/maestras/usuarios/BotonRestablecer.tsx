"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/BotonEnviar";
import { restablecerPassword, type EstadoPassword } from "./acciones";
import { PasswordUnaVez } from "./PasswordUnaVez";

export function BotonRestablecer({ id }: { id: string }) {
  const [estado, accion] = useActionState<EstadoPassword, FormData>(restablecerPassword, {});
  if (estado.password) {
    return (
      <div className="space-y-2">
        {estado.aviso && <p className="alerta-error">{estado.aviso}</p>}
        <PasswordUnaVez password={estado.password} />
      </div>
    );
  }
  return (
    <form action={accion} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {estado.error && (
        <p role="alert" className="alerta-error">
          {estado.error}
        </p>
      )}
      <BotonEnviar className="btn-secundario" pendiente="Generando…">
        Generar contraseña temporal
      </BotonEnviar>
    </form>
  );
}
