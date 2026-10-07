import "server-only";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/** Valores de la tabla configuracion visibles para el usuario (las públicas, o todas para Admin). */
export async function leerConfig(claves: string[]): Promise<Map<string, unknown>> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("configuracion").select("clave, valor").in("clave", claves);
  return new Map(((data ?? []) as { clave: string; valor: unknown }[]).map((f) => [f.clave, f.valor]));
}

export async function zonaHoraria(): Promise<string> {
  const v = (await leerConfig(["zona_horaria"])).get("zona_horaria");
  return typeof v === "string" && v ? v : "America/Lima";
}

export const numero = (v: unknown, defecto: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : defecto);

/** Instante actual (UTC, ISO) para comparar vigencias en el servidor. */
export async function ahoraIso(): Promise<string> {
  return new Date().toISOString();
}
