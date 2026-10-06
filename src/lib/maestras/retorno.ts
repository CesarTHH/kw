import { numeroPagina, terminoBusqueda, urlCon } from "@/lib/busqueda";

/**
 * URL a la que vuelve una acción, conservando la búsqueda y la página de la
 * lista (campos ocultos "q", "p" y "f"). Los valores se limpian: nunca se
 * redirige a algo armado libremente por el formulario.
 */
export function retorno(
  base: string,
  formData: FormData,
  extra: Record<string, string | number | undefined | null>,
): string {
  const p = numeroPagina(formData.get("p"));
  const f = formData.get("f");
  return urlCon(base, {
    q: terminoBusqueda(formData.get("q")),
    p: p > 1 ? p : undefined,
    f: typeof f === "string" && /^[a-z_]{1,20}$/.test(f) ? f : undefined,
    ...extra,
  });
}
