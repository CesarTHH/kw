/** Selector activos / inactivos / todos (parte del formulario de búsqueda). */
export const FILTROS_ESTADO = { activos: "Activos", inactivos: "Inactivos", todos: "Todos" } as const;
export type FiltroEstado = keyof typeof FILTROS_ESTADO;

export function filtroEstado(v: unknown): FiltroEstado {
  return v === "inactivos" || v === "todos" ? v : "activos";
}

export function SelectorEstado({ valor }: { valor: FiltroEstado }) {
  return (
    <label>
      <span className="sr-only">Estado</span>
      <select name="f" defaultValue={valor} className="campo w-auto">
        {Object.entries(FILTROS_ESTADO).map(([k, t]) => (
          <option key={k} value={k}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}
