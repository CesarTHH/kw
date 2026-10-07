import { z } from "zod";
import { nombreCatalogo } from "./esquemas";

/**
 * Catálogos simples (lista + formulario). Una sola definición sirve para la
 * pantalla, la validación del servidor y la exportación a Excel.
 */
export type TipoCampo = "nombre" | "codigo" | "entero" | "decimal" | "fecha" | "booleano" | "referencia" | "hora" | "texto";

export type Campo = {
  nombre: string;
  etiqueta: string;
  tipo: TipoCampo;
  requerido?: boolean;
  /** Para "referencia": tabla y columna a mostrar. */
  referencia?: { tabla: string; columna: string };
  /** Mostrar en la grilla (por defecto sí). */
  enLista?: boolean;
  ayuda?: string;
};

export type Catalogo = {
  codigo: string;
  titulo: string;
  singular: string;
  tabla: string;
  campos: Campo[];
  orden: { columna: string; asc: boolean }[];
  busqueda: string[];
  tieneActivo: boolean;
};

export const CATALOGOS: Catalogo[] = [
  {
    codigo: "proyectos",
    titulo: "Proyectos",
    singular: "proyecto",
    tabla: "proyectos",
    campos: [{ nombre: "nombre", etiqueta: "Nombre", tipo: "nombre", requerido: true }],
    orden: [{ columna: "nombre", asc: true }],
    busqueda: ["nombre"],
    tieneActivo: true,
  },
  {
    codigo: "areas",
    titulo: "Áreas",
    singular: "área",
    tabla: "areas",
    campos: [{ nombre: "nombre", etiqueta: "Nombre", tipo: "nombre", requerido: true }],
    orden: [{ columna: "nombre", asc: true }],
    busqueda: ["nombre"],
    tieneActivo: true,
  },
  {
    codigo: "sectores",
    titulo: "Sectores",
    singular: "sector",
    tabla: "sectores",
    campos: [
      { nombre: "codigo", etiqueta: "Código", tipo: "codigo", requerido: true, ayuda: "MAYÚSCULAS y _ (ej. PARTE_ALTA)" },
      { nombre: "nombre", etiqueta: "Nombre", tipo: "nombre", requerido: true },
    ],
    orden: [{ columna: "nombre", asc: true }],
    busqueda: ["codigo", "nombre"],
    tieneActivo: true,
  },
  {
    codigo: "comedores",
    titulo: "Comedores",
    singular: "comedor",
    tabla: "comedores",
    campos: [
      { nombre: "nombre", etiqueta: "Nombre", tipo: "nombre", requerido: true },
      { nombre: "sector_id", etiqueta: "Sector", tipo: "referencia", referencia: { tabla: "sectores", columna: "nombre" } },
      { nombre: "habilitado_raciones", etiqueta: "Raciones", tipo: "booleano" },
      { nombre: "habilitado_refrigerios", etiqueta: "Refrigerios", tipo: "booleano" },
    ],
    orden: [{ columna: "nombre", asc: true }],
    busqueda: ["nombre"],
    tieneActivo: true,
  },
  {
    codigo: "servicios",
    titulo: "Servicios",
    singular: "servicio",
    tabla: "servicios",
    campos: [
      { nombre: "nombre", etiqueta: "Nombre", tipo: "nombre", requerido: true },
      {
        nombre: "tipo_servicio_id",
        etiqueta: "Tipo",
        tipo: "referencia",
        requerido: true,
        referencia: { tabla: "tipos_servicio", columna: "nombre" },
      },
      { nombre: "es_a_campo", etiqueta: "A campo", tipo: "booleano" },
      { nombre: "orden", etiqueta: "Orden", tipo: "entero" },
    ],
    orden: [
      { columna: "orden", asc: true },
      { columna: "nombre", asc: true },
    ],
    busqueda: ["nombre"],
    tieneActivo: true,
  },
  {
    codigo: "tarifas",
    titulo: "Tarifas",
    singular: "tarifa",
    tabla: "servicio_tarifas",
    campos: [
      {
        nombre: "servicio_id",
        etiqueta: "Servicio",
        tipo: "referencia",
        requerido: true,
        referencia: { tabla: "servicios", columna: "nombre" },
      },
      { nombre: "precio", etiqueta: "Precio (S/)", tipo: "decimal", requerido: true },
      { nombre: "vigente_desde", etiqueta: "Vigente desde", tipo: "fecha", requerido: true },
      {
        nombre: "vigente_hasta",
        etiqueta: "Vigente hasta",
        tipo: "fecha",
        ayuda: "Vacío = sin fecha de fin",
      },
    ],
    orden: [{ columna: "vigente_desde", asc: false }],
    busqueda: [],
    tieneActivo: false,
  },
  {
    codigo: "refrigerio_productos",
    titulo: "Productos de refrigerio",
    singular: "producto",
    tabla: "refrigerio_productos",
    campos: [
      { nombre: "nombre", etiqueta: "Nombre", tipo: "nombre", requerido: true },
      { nombre: "orden", etiqueta: "Orden", tipo: "entero" },
    ],
    orden: [
      { columna: "orden", asc: true },
      { columna: "nombre", asc: true },
    ],
    busqueda: ["nombre"],
    tieneActivo: true,
  },
  {
    codigo: "refrigerio_precios",
    titulo: "Precios de productos",
    singular: "precio",
    tabla: "refrigerio_producto_precios",
    campos: [
      {
        nombre: "producto_id",
        etiqueta: "Producto",
        tipo: "referencia",
        requerido: true,
        referencia: { tabla: "refrigerio_productos", columna: "nombre" },
      },
      { nombre: "precio", etiqueta: "Precio sin IGV (S/)", tipo: "decimal", requerido: true },
      { nombre: "vigente_desde", etiqueta: "Vigente desde", tipo: "fecha", requerido: true },
      { nombre: "vigente_hasta", etiqueta: "Vigente hasta", tipo: "fecha", ayuda: "Vacío = sin fecha de fin" },
    ],
    orden: [{ columna: "vigente_desde", asc: false }],
    busqueda: [],
    tieneActivo: false,
  },
  {
    codigo: "refrigerio_estandar_precios",
    titulo: "Precio del estándar",
    singular: "precio",
    tabla: "refrigerio_estandar_precios",
    campos: [
      { nombre: "precio", etiqueta: "Precio del refrigerio estándar sin IGV (S/)", tipo: "decimal", requerido: true },
      { nombre: "vigente_desde", etiqueta: "Vigente desde", tipo: "fecha", requerido: true },
      { nombre: "vigente_hasta", etiqueta: "Vigente hasta", tipo: "fecha", ayuda: "Vacío = sin fecha de fin" },
    ],
    orden: [{ columna: "vigente_desde", asc: false }],
    busqueda: [],
    tieneActivo: false,
  },
  {
    codigo: "refrigerio_turnos",
    titulo: "Turnos de entrega",
    singular: "turno",
    tabla: "refrigerio_turnos",
    campos: [
      { nombre: "hora", etiqueta: "Hora", tipo: "hora", requerido: true, ayuda: "Dentro del horario de entrega configurado" },
      { nombre: "etiqueta", etiqueta: "Texto que se muestra", tipo: "texto", requerido: true, ayuda: "Por ejemplo: 9:30 am" },
    ],
    orden: [{ columna: "hora", asc: true }],
    busqueda: ["etiqueta"],
    tieneActivo: true,
  },
];

export function catalogoPorCodigo(codigo: unknown): Catalogo | undefined {
  return CATALOGOS.find((c) => c.codigo === codigo);
}

/** Columnas a leer de la tabla. */
export function columnasCatalogo(c: Catalogo): string {
  return ["id", ...c.campos.map((f) => f.nombre), ...(c.tieneActivo ? ["activo"] : [])].join(", ");
}

function esquemaCampo(f: Campo): z.ZodType {
  const vacioANulo = (v: unknown) => (v === "" || v === null || v === undefined ? null : v);
  switch (f.tipo) {
    case "nombre":
      return f.requerido ? nombreCatalogo(150) : z.preprocess(vacioANulo, nombreCatalogo(150).nullable());
    case "codigo":
      return z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z_]{2,30}$/, `${f.etiqueta}: usa solo MAYÚSCULAS y _`);
    case "entero":
      return z.preprocess(
        (v) => (v === "" || v === null || v === undefined ? 0 : v),
        z.coerce.number().int(`${f.etiqueta}: número entero`).min(0).max(100_000),
      );
    case "decimal":
      return z.coerce
        .number(`${f.etiqueta}: indica un número`)
        .min(0, `${f.etiqueta}: no puede ser negativo`)
        .max(100_000)
        .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, `${f.etiqueta}: máximo 2 decimales`);
    case "fecha": {
      const fecha = z.iso.date(`${f.etiqueta}: fecha no válida`);
      return f.requerido ? fecha : z.preprocess(vacioANulo, fecha.nullable());
    }
    case "booleano":
      return z.boolean();
    case "hora":
      return z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, `${f.etiqueta}: hora no válida`);
    case "texto":
      return z.string().trim().min(1, `${f.etiqueta} es obligatorio`).max(40);
    case "referencia": {
      const id = z.uuid(`Elige ${f.etiqueta.toLowerCase()}`);
      return f.requerido ? id : z.preprocess(vacioANulo, id.nullable());
    }
  }
}

/** Lee y valida los campos del catálogo desde un formulario. */
export function leerCatalogo(c: Catalogo, formData: FormData) {
  const forma: Record<string, z.ZodType> = {};
  const crudo: Record<string, unknown> = {};
  for (const f of c.campos) {
    forma[f.nombre] = esquemaCampo(f);
    crudo[f.nombre] = f.tipo === "booleano" ? formData.get(f.nombre) === "on" : (formData.get(f.nombre) ?? "");
  }
  const resultado = z.object(forma).safeParse(crudo);
  if (!resultado.success) return resultado;
  const datos = { ...resultado.data } as Record<string, unknown>;
  // Precios con vigencia: sin fecha de fin = vigente "para siempre" (valor por defecto de la BD).
  if ("vigente_hasta" in datos && datos.vigente_hasta === null) datos.vigente_hasta = "2099-12-31";
  return { success: true as const, data: datos };
}
