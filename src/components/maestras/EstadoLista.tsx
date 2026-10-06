/** Campos ocultos para que la acción vuelva a la misma búsqueda y página. */
export function EstadoLista({ q, p, f }: { q?: string; p?: number; f?: string }) {
  return (
    <>
      {q ? <input type="hidden" name="q" value={q} /> : null}
      {p && p > 1 ? <input type="hidden" name="p" value={p} /> : null}
      {f ? <input type="hidden" name="f" value={f} /> : null}
    </>
  );
}
