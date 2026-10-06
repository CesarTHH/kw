"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/BotonEnviar";
import { verificarMfa, type EstadoMfa } from "./acciones";

export function FormMfa({ factorId, nuevo, next }: { factorId: string; nuevo: boolean; next?: string }) {
  const [estado, accion] = useActionState<EstadoMfa, FormData>(verificarMfa, {});
  return (
    <form action={accion} className="flex w-full flex-col gap-4">
      {estado.error && <p role="alert" className="alerta-error">{estado.error}</p>}
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="nuevo" value={nuevo ? "1" : "0"} />
      <input type="hidden" name="next" value={next ?? ""} />
      <label>
        <span className="sr-only">Código de 6 dígitos</span>
        <input name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required
          placeholder="Código de 6 dígitos" className="campo text-center text-lg tracking-[0.4em]" />
      </label>
      <BotonEnviar className="btn-oliva" pendiente="Verificando…">
        Verificar
      </BotonEnviar>
    </form>
  );
}
