"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/BotonEnviar";
import { PasswordUnaVez } from "../usuarios/PasswordUnaVez";
import { aprobarSolicitud, type EstadoAprobacion } from "./acciones";

export function BotonAprobar({
  id,
  soloUsuario,
  empresaExistente,
}: {
  id: string;
  soloUsuario: boolean;
  empresaExistente?: string;
}) {
  const [estado, accion] = useActionState<EstadoAprobacion, FormData>(aprobarSolicitud, {});
  if (estado.password) {
    return (
      <div className="space-y-2">
        <p className="alerta-ok">Solicitud aprobada y cuenta creada.</p>
        {estado.aviso && <p className="alerta-error">{estado.aviso}</p>}
        <PasswordUnaVez correo={estado.correo} password={estado.password} />
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
      {estado.aviso && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{estado.aviso}</p>}
      {empresaExistente && !soloUsuario && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirmar_empresa" required className="mt-0.5 size-4 accent-marca" />
          <span>
            Confirmo que el solicitante pertenece a <strong>{empresaExistente}</strong> y puede ver sus raciones.
          </span>
        </label>
      )}
      <BotonEnviar pendiente="Procesando…">{soloUsuario ? "Crear usuario" : "Aprobar y crear usuario"}</BotonEnviar>
    </form>
  );
}
