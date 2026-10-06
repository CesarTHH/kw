import { z } from "zod";
import { rucValido } from "@/lib/ruc";
import { correoSchema } from "@/lib/validaciones";

/** Texto opcional: "" → null. */
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null));

/** Nombre de catálogo: sin espacios dobles y en MAYÚSCULAS (igual que la BD). */
export const nombreCatalogo = (max = 150) =>
  z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(max)
    .transform((v) => v.replace(/\s+/g, " ").toUpperCase());

const fechaOpcional = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Fecha no válida")
  .nullish()
  .transform((v) => (v ? v : null));

export const rucSchema = z
  .string()
  .trim()
  .regex(/^\d{11}$/, "El RUC tiene 11 dígitos")
  .refine(rucValido, "El RUC no es válido (revisa el dígito verificador)");

export const empresaSchema = z.object({
  razon_social: z.string().trim().min(2, "Razón social muy corta").max(200),
  nombre_corto: z.string().trim().min(1, "Indica un nombre corto").max(120),
  direccion: opcional(300),
  tipo: z.enum(["empresa", "persona"]),
  telefonos: opcional(200),
});
export const empresaNuevaSchema = empresaSchema.extend({ ruc: rucSchema });

export const TIPOS_CONTACTO = {
  gestion_raciones: "Gestión de raciones",
  facturacion: "Facturación",
  cobranzas: "Cobranzas",
} as const;

export const contactoSchema = z.object({
  tipo: z.enum(["gestion_raciones", "facturacion", "cobranzas"]),
  nombre: z.string().trim().min(2, "Nombre muy corto").max(150),
  telefono: opcional(60),
  correo: correoSchema,
  recibe_notificaciones: z.boolean(),
});

const rangoContrato = <T extends { contrato_desde: string | null; contrato_hasta: string | null }>(d: T) =>
  !d.contrato_desde || !d.contrato_hasta || d.contrato_hasta >= d.contrato_desde;

export const frenteSchema = z
  .object({
    proyecto_id: z.uuid("Elige un proyecto"),
    area_id: z.uuid("Elige un área"),
    nombre: nombreCatalogo(150),
    sponsor: opcional(150),
    contrato_desde: fechaOpcional,
    contrato_hasta: fechaOpcional,
  })
  .refine(rangoContrato, { message: "La fecha final no puede ser anterior a la inicial", path: ["contrato_hasta"] });

export const asignacionSchema = z
  .object({
    empresa_id: z.uuid("Elige una empresa"),
    frente_id: z.uuid(),
    contrato_desde: fechaOpcional,
    contrato_hasta: fechaOpcional,
  })
  .refine(rangoContrato, { message: "La fecha final no puede ser anterior a la inicial", path: ["contrato_hasta"] });

// -----------------------------------------------------------------------------
// Usuarios
// -----------------------------------------------------------------------------
export const usuarioNuevoSchema = z.object({
  nombre: z.string().trim().min(2, "Nombre muy corto").max(150),
  correo: correoSchema,
  rol_id: z.uuid("Elige un rol"),
  empresa_id: z.uuid().nullable(),
  comedor_id: z.uuid().nullable(),
});

export const usuarioEdicionSchema = z.object({
  id: z.uuid(),
  nombre: z.string().trim().min(2, "Nombre muy corto").max(150),
  rol_id: z.uuid("Elige un rol"),
  empresa_id: z.uuid().nullable(),
  comedor_id: z.uuid().nullable(),
});

/** "" o ausente → null; si no, el valor. */
export function uuidONulo(v: FormDataEntryValue | null): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

// -----------------------------------------------------------------------------
// Registro público de nuevos clientes
// -----------------------------------------------------------------------------
const fechaObligatoria = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica la fecha");

export const frenteSolicitudSchema = z
  .object({
    proyecto_id: z.uuid("Elige un proyecto"),
    area_id: z.uuid("Elige un área"),
    frente: z.string().trim().min(2, "Indica el frente de trabajo").max(150),
    sponsor: z.string().trim().max(150).default(""),
    desde: fechaObligatoria,
    hasta: fechaObligatoria,
  })
  .refine((f) => f.hasta >= f.desde, { message: "La fecha final no puede ser anterior a la inicial", path: ["hasta"] });

const contactoSolicitud = (tipo: keyof typeof TIPOS_CONTACTO) =>
  z.object({
    tipo: z.literal(tipo),
    nombre: z.string().trim().min(2, `Indica el nombre del contacto de ${TIPOS_CONTACTO[tipo].toLowerCase()}`).max(150),
    telefono: z.string().trim().max(60).default(""),
    correo: correoSchema,
  });

export const solicitudSchema = z.object({
  ruc: rucSchema,
  razon_social: z.string().trim().min(2, "Indica la razón social").max(200),
  direccion: z.string().trim().max(300).default(""),
  usuario_nombre: z.string().trim().min(2, "Indica tu nombre").max(150),
  usuario_correo: correoSchema,
  usuario_telefono: z.string().trim().max(30).default(""),
  frentes: z.array(frenteSolicitudSchema).min(1, "Agrega al menos un frente de trabajo").max(30),
  contactos: z.tuple([
    contactoSolicitud("gestion_raciones"),
    contactoSolicitud("facturacion"),
    contactoSolicitud("cobranzas"),
  ]),
  acepta_tyc: z.literal(true, "Debes aceptar los términos y condiciones"),
});
export type DatosSolicitud = z.infer<typeof solicitudSchema>;
