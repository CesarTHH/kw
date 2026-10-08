import { Search } from "lucide-react";

/** Formulario de búsqueda (GET): conserva los filtros extra como campos ocultos. */
export function Buscador({
  accion,
  q,
  placeholder = "Buscar…",
  ocultos = {},
  children,
}: {
  accion: string;
  q: string;
  placeholder?: string;
  ocultos?: Record<string, string | undefined>;
  children?: React.ReactNode;
}) {
  return (
    <form action={accion} method="get" role="search" className="flex flex-wrap items-center gap-2">
      {Object.entries(ocultos).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="relative min-w-0 flex-[1_1_14rem]">
        <span className="sr-only">{placeholder}</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gris-medio" aria-hidden />
        <input name="q" defaultValue={q} placeholder={placeholder} maxLength={60} className="campo pl-9" />
      </label>
      {children}
      <button type="submit" className="btn-secundario">Buscar</button>
    </form>
  );
}
