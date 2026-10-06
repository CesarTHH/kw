export const ACCIONES = ["ver", "crear", "editar", "enviar", "exportar", "aprobar"] as const;
export type Accion = (typeof ACCIONES)[number];

export type ItemMenu = {
  codigo: string;
  padre_codigo: string | null;
  nombre: string;
  icono: string | null;
  ruta: string | null;
  orden: number;
  acciones: string[] | null;
};

/** ¿El menú del usuario permite la acción sobre el código indicado? */
export function puede(menu: readonly ItemMenu[], codigo: string, accion: Accion = "ver"): boolean {
  const item = menu.find((m) => m.codigo === codigo);
  return !!item && !!item.acciones && item.acciones.includes(accion);
}

/** Ítems de primer nivel (los íconos del menú principal), en orden. */
export function menuPrincipal(menu: readonly ItemMenu[]): ItemMenu[] {
  return menu
    .filter((m) => m.padre_codigo === null && m.ruta)
    .slice()
    .sort((a, b) => a.orden - b.orden);
}

/** Pestañas / submenús permitidos de un menú padre. */
export function hijos(menu: readonly ItemMenu[], padre: string): ItemMenu[] {
  return menu
    .filter((m) => m.padre_codigo === padre && m.acciones?.includes("ver"))
    .slice()
    .sort((a, b) => a.orden - b.orden);
}
