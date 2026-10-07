"use server";

import { esUuid } from "@/lib/busqueda";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/** Marca como vistas las alertas que el usuario cerró (la base de datos vuelve a verificar cuáles le corresponden). */
export async function marcarAlertasVistas(ids: string[]): Promise<void> {
  const validos = Array.isArray(ids) ? ids.filter(esUuid).slice(0, 20) : [];
  if (!validos.length) return;
  const supabase = await crearClienteServidor();
  await supabase.rpc("marcar_alertas_vistas", { p_ids: validos });
}
