/** Tipos y cálculos de refrigerios compartidos entre el servidor y la pantalla. */

export type TipoRefrigerio = "estandar" | "especial" | "estandar_mas_especial";

export const TIPOS_REFRIGERIO: Record<TipoRefrigerio, string> = {
  estandar: "Estándar",
  especial: "Especial",
  estandar_mas_especial: "Estándar + especial",
};

export type ItemPedido = { producto_id: string; cantidad: number };

export type PedidoBorrador = {
  id: string;
  fecha: string;
  comedor_id: string;
  turno_id: string;
  tipo: TipoRefrigerio;
  cantidad: number;
  encargado: string;
  items: ItemPedido[];
};

export type Precios = {
  estandar_precio: number | null;
  estandar_items: ItemPedido[];
  productos: { id: string; nombre: string; precio: number | null }[];
};

/** Precio de UN refrigerio: estándar (si aplica) + productos especiales. Redondeado a céntimos. */
export function precioUnitario(p: Pick<PedidoBorrador, "tipo" | "items">, precios: Precios): number | null {
  let total = 0;
  if (p.tipo !== "especial") {
    if (precios.estandar_precio == null) return null;
    total += Number(precios.estandar_precio);
  }
  for (const it of p.items) {
    const pr = precios.productos.find((x) => x.id === it.producto_id)?.precio;
    if (pr == null) return null;
    total += Number(pr) * it.cantidad;
  }
  return Math.round(total * 100) / 100;
}

/** Composición en texto ("2 SANDWICH…\n1 GASEOSA"), sumando estándar y especiales por producto. */
export function composicion(p: Pick<PedidoBorrador, "tipo" | "items">, precios: Precios): string {
  const cant = new Map<string, number>();
  if (p.tipo !== "especial") for (const it of precios.estandar_items) cant.set(it.producto_id, (cant.get(it.producto_id) ?? 0) + it.cantidad);
  for (const it of p.items) cant.set(it.producto_id, (cant.get(it.producto_id) ?? 0) + it.cantidad);
  return precios.productos
    .filter((x) => cant.has(x.id))
    .map((x) => `${cant.get(x.id)} ${x.nombre}`)
    .join("\n");
}

export const soles = (n: number) => `S/ ${n.toFixed(2).replace(".", ",")}`;
