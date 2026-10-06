// Rutas que se pueden visitar sin sesión.
const RUTAS_PUBLICAS = ["/", "/login", "/registro", "/olvide-password", "/auth/confirm"];

export function esRutaPublica(path: string): boolean {
  return RUTAS_PUBLICAS.some((r) => path === r || (r !== "/" && path.startsWith(r + "/")));
}

/**
 * Devuelve una ruta interna segura para redirigir después del login.
 * Evita redirecciones abiertas a otros sitios (//evil.com, /\evil.com, https://…).
 */
export function rutaSegura(destino: string | null | undefined, porDefecto = "/menu"): string {
  if (!destino || typeof destino !== "string") return porDefecto;
  if (destino.length > 200) return porDefecto;
  if (!destino.startsWith("/")) return porDefecto;
  if (destino.startsWith("//") || destino.startsWith("/\\")) return porDefecto;
  if ([...destino].some((c) => c.charCodeAt(0) < 32 || c === "\\")) return porDefecto;
  const ruta = destino.split("?")[0] ?? "";
  if (esRutaPublica(ruta) || ruta === "/salir") return porDefecto;
  return destino;
}
