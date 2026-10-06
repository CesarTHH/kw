/** Etiqueta de estado activo / inactivo. */
export function Estado({ activo, si = "Activo", no = "Inactivo" }: { activo: boolean; si?: string; no?: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
        activo ? "bg-green-100 text-green-800" : "bg-neutral-200 text-neutral-600"
      }`}
    >
      {activo ? si : no}
    </span>
  );
}
