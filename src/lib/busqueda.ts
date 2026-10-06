/** Utilidades para listas con búsqueda y paginación del lado del servidor. */

export const TAMANO_PAGINA = 25;

/**
 * Limpia el texto de búsqueda. Solo deja letras, números, espacios y . @ - _
 * Así el término no puede romper los filtros de PostgREST (comas, paréntesis,
 * asteriscos o comillas alterarían la consulta).
 */
export function terminoBusqueda(q: unknown): string {
  if (typeof q !== "string") return "";
  return q
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} .@_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** Filtro "or" de PostgREST: cualquiera de las columnas contiene el término. */
export function filtroOr(columnas: readonly string[], termino: string): string {
  const t = terminoBusqueda(termino);
  return columnas.map((c) => `${c}.ilike.*${t}*`).join(",");
}

/** Número de página (1 en adelante). */
export function numeroPagina(p: unknown): number {
  const n = typeof p === "string" ? Number.parseInt(p, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
}

/** Rango [desde, hasta] para .range() de Supabase. */
export function rango(pagina: number, tamano = TAMANO_PAGINA): [number, number] {
  const desde = (pagina - 1) * tamano;
  return [desde, desde + tamano - 1];
}

/** Construye una URL con parámetros, omitiendo los vacíos. */
export function urlCon(base: string, params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function esUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}
