/** Documentos PDF publicados: a qué menú de permisos pertenecen y cómo se llaman. */
export const TIPOS_DOCUMENTO = {
  menu_1: { menu: "menu_semanal", nombre: "Menú semanal 1", ruta: "/menu-semanal" },
  menu_2: { menu: "menu_semanal", nombre: "Menú semanal 2", ruta: "/menu-semanal" },
  terminos: { menu: "manual_tyc", nombre: "Términos y condiciones", ruta: "/documentos" },
  manual: { menu: "manual_tyc", nombre: "Manual de uso", ruta: "/documentos" },
} as const;

export type TipoDocumento = keyof typeof TIPOS_DOCUMENTO;

export function esTipoDocumento(v: unknown): v is TipoDocumento {
  return typeof v === "string" && Object.hasOwn(TIPOS_DOCUMENTO, v);
}

export type Documento = {
  id: string;
  tipo: TipoDocumento;
  version: number;
  titulo: string;
  nombre_archivo: string;
  tamano: number;
  vigente: boolean;
  created_at: string;
};
