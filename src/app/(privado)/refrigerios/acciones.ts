"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { permisoEnAccion } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import type { PedidoBorrador } from "@/lib/refrigerios/tipos";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const itemSchema = z.object({ producto_id: z.uuid(), cantidad: z.number().int().min(1).max(100) });
const pedidoSchema = z.object({
  id: z.string().max(60),
  fecha: z.iso.date(),
  comedor_id: z.uuid(),
  turno_id: z.uuid(),
  tipo: z.enum(["estandar", "especial", "estandar_mas_especial"]),
  cantidad: z.number().int().min(1).max(10_000),
  encargado: z.string().trim().max(150),
  items: z.array(itemSchema).max(30),
});
const pedidosSchema = z.array(pedidoSchema).max(300);

export async function guardarBorradorRefrigerios(empresaId: string, pedidos: PedidoBorrador[]): Promise<{ ok: boolean }> {
  if (!esUuid(empresaId) || !(await permisoEnAccion("refrigerios", "enviar"))) return { ok: false };
  const datos = pedidosSchema.safeParse(pedidos);
  if (!datos.success) return { ok: false };
  const supabase = await crearClienteServidor();
  const { error } = datos.data.length
    ? await supabase
        .from("borradores")
        .upsert({ empresa_id: empresaId, modulo: "refrigerios", filas: datos.data }, { onConflict: "usuario_id,empresa_id,modulo" })
    : await supabase.from("borradores").delete().eq("empresa_id", empresaId).eq("modulo", "refrigerios");
  return { ok: !error };
}

export type PedidoRegistrado = {
  id: string;
  fecha: string;
  comedor_id: string;
  turno_id: string;
  tipo: PedidoBorrador["tipo"];
  cantidad: number;
  cantidad_vigente: number;
  encargado: string;
  precio_unitario: number;
  composicion: string;
};

export async function consultarPedidos(empresaId: string, desde: string, hasta: string): Promise<PedidoRegistrado[]> {
  const fecha = z.iso.date();
  if (!esUuid(empresaId) || !fecha.safeParse(desde).success || !fecha.safeParse(hasta).success || hasta < desde) return [];
  if ((Date.parse(hasta) - Date.parse(desde)) / 86_400_000 > 120) return [];
  if (!(await permisoEnAccion("refrigerios", "ver"))) return [];
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from("refrigerio_pedidos")
    .select("id, fecha, comedor_id, turno_id, tipo, cantidad, cantidad_vigente, encargado, precio_unitario, composicion")
    .eq("empresa_id", empresaId)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha")
    .order("hora_entrega")
    .limit(2000);
  return ((data ?? []) as PedidoRegistrado[]).map((p) => ({ ...p, precio_unitario: Number(p.precio_unitario) }));
}

export type Resultado = { ok: true; envioId: string } | { ok: false; error: string };

function mensaje(error: { code?: string; message: string }): string {
  if (error.code === "22023" || error.code === "42501") return error.message;
  console.error("[refrigerios]", error.code, error.message);
  return "No se pudo enviar. Inténtalo de nuevo.";
}

export async function enviarRefrigerios(empresaId: string, pedidos: PedidoBorrador[], clave: string, motivo?: string): Promise<Resultado> {
  if (!esUuid(empresaId) || !esUuid(clave)) return { ok: false, error: "Datos no válidos." };
  if (!(await permisoEnAccion("refrigerios", "enviar"))) return { ok: false, error: "No tienes permiso para registrar refrigerios." };
  const datos = pedidosSchema.min(1, "No hay pedidos para enviar.").safeParse(pedidos);
  if (!datos.success) return { ok: false, error: datos.error.issues[0]?.message ?? "Datos no válidos." };
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("enviar_refrigerios", {
    p_empresa_id: empresaId,
    p_pedidos: datos.data.map(({ id: _id, ...p }) => p),
    p_clave: clave,
    p_motivo: motivo?.trim() || null,
  });
  if (error) return { ok: false, error: mensaje(error) };
  await supabase.from("borradores").delete().eq("empresa_id", empresaId).eq("modulo", "refrigerios");
  revalidatePath("/refrigerios");
  return { ok: true, envioId: String(data) };
}

export async function reducirRefrigerio(pedidoId: string, cantidad: number, clave: string, motivo?: string): Promise<Resultado> {
  if (!esUuid(pedidoId) || !esUuid(clave) || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10_000) {
    return { ok: false, error: "Datos no válidos." };
  }
  if (!(await permisoEnAccion("refrigerios", "enviar"))) return { ok: false, error: "No tienes permiso." };
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("reducir_refrigerio", {
    p_pedido_id: pedidoId,
    p_cantidad: cantidad,
    p_clave: clave,
    p_motivo: motivo?.trim() || null,
  });
  if (error) return { ok: false, error: mensaje(error) };
  revalidatePath("/refrigerios");
  return { ok: true, envioId: String(data) };
}
