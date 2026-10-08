"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Muestra una contraseña temporal una sola vez, con botón para copiarla. */
export function PasswordUnaVez({ correo, password }: { correo?: string; password: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(password);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-marca bg-white p-3 text-sm">
      {correo && (
        <p>
          Usuario: <strong>{correo}</strong>
        </p>
      )}
      <p className="flex flex-wrap items-center gap-2">
        Contraseña temporal: <code className="rounded bg-gris-claro px-2 py-1 font-mono text-base">{password}</code>
        <button type="button" onClick={copiar} className="btn-secundario min-h-8! px-3! py-1! text-xs" aria-label="Copiar contraseña">
          {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copiado ? "Copiada" : "Copiar"}
        </button>
      </p>
      <p className="text-xs text-red-800">
        Guárdala o entrégala ahora por un canal seguro: no se volverá a mostrar. El usuario deberá cambiarla al ingresar.
      </p>
    </div>
  );
}
