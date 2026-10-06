"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/BotonEnviar";
import { cambiarPassword, type EstadoCambio } from "./acciones";

export function FormCambio() {
  const [estado, accion] = useActionState<EstadoCambio, FormData>(cambiarPassword, {});
  return (
    <form action={accion} className="flex w-full flex-col gap-4">
      {estado.error && <p role="alert" className="alerta-error">{estado.error}</p>}
      <label>
        <span className="sr-only">Nueva contraseña</span>
        <input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={72}
          placeholder="Nueva contraseña" className="campo" />
      </label>
      <label>
        <span className="sr-only">Repite la contraseña</span>
        <input name="confirmacion" type="password" autoComplete="new-password" required placeholder="Repite la contraseña"
          className="campo" />
      </label>
      <p className="text-xs text-white">Mínimo 10 caracteres, con mayúsculas, minúsculas y números.</p>
      <BotonEnviar className="btn-oliva" pendiente="Guardando…">
        Guardar contraseña
      </BotonEnviar>
    </form>
  );
}
