"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { marcarAlertasVistas } from "@/app/(privado)/alertas-acciones";
import { TextoEnriquecido } from "./TextoEnriquecido";

export type AlertaVisible = { id: string; titulo: string; contenido: string };

/** Ventana con las alertas vigentes al entrar. Se muestran una tras otra. */
export function AlertasLogin({ alertas }: { alertas: AlertaVisible[] }) {
  const [indice, setIndice] = useState(0);
  const [pendiente, startTransition] = useTransition();
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => boton.current?.focus(), [indice]);
  const actual = alertas[indice];
  if (!actual) return null;
  const ultima = indice === alertas.length - 1;

  function cerrar() {
    if (!ultima) return setIndice((i) => i + 1);
    startTransition(async () => {
      await marcarAlertasVistas(alertas.map((a) => a.id));
      setIndice(alertas.length);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="alerta-titulo" className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center gap-2 bg-marca px-5 py-3 text-white">
          <BellRing className="size-5" aria-hidden />
          <h2 id="alerta-titulo" className="flex-1 font-semibold">
            {actual.titulo}
          </h2>
          {alertas.length > 1 && (
            <span className="text-xs opacity-90">
              {indice + 1} de {alertas.length}
            </span>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 text-sm leading-relaxed">
          <TextoEnriquecido texto={actual.contenido} />
        </div>
        <div className="flex justify-end border-t border-gris-medio/20 px-5 py-3">
          <button ref={boton} type="button" onClick={cerrar} disabled={pendiente} className="btn-marca">
            {ultima ? "Entendido" : "Siguiente"}
          </button>
        </div>
      </div>
    </div>
  );
}
