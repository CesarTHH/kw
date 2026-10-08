import "server-only";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * Deja un error inesperado en el log del servidor y en la tabla de errores
 * (para "Métricas de uso"). Nunca lanza: si no se puede registrar, sigue.
 * No incluir datos personales ni contraseñas en el detalle.
 */
export async function registrarError(origen: string, ...detalle: unknown[]): Promise<void> {
  const texto = detalle.map((d) => (d instanceof Error ? d.message : String(d ?? ""))).join(" ").slice(0, 500);
  console.error(`[${origen}]`, texto);
  try {
    const supabase = await crearClienteServidor();
    await supabase.rpc("registrar_error", { p_origen: origen.slice(0, 60), p_detalle: texto });
  } catch {
    // Sin conexión o sin sesión: basta con el log del servidor.
  }
}
