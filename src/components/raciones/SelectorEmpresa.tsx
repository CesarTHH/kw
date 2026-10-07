"use client";

import { usePathname } from "next/navigation";
import { useRef } from "react";
import { seleccionarEmpresa } from "@/app/(privado)/raciones/acciones";

/** Selector "Seleccionar empresa" para los roles que operan por cualquier empresa. */
export function SelectorEmpresa({
  empresas,
  actual,
}: {
  empresas: { id: string; nombre: string; ruc: string }[];
  actual: string | null;
}) {
  const ruta = usePathname();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={seleccionarEmpresa} className="flex items-center gap-2">
      <input type="hidden" name="volver" value={ruta} />
      <label className="flex items-center gap-2 text-sm font-semibold text-oliva">
        Empresa
        <select
          name="empresa"
          defaultValue={actual ?? ""}
          onChange={() => form.current?.requestSubmit()}
          className="campo w-72 max-w-full font-normal"
        >
          <option value="">— Seleccionar empresa —</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre} ({e.ruc})
            </option>
          ))}
        </select>
      </label>
      <noscript>
        <button type="submit" className="btn-secundario">
          Elegir
        </button>
      </noscript>
    </form>
  );
}
