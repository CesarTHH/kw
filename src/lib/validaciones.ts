import { z } from "zod";

export const correoSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "El correo es demasiado largo")
  .pipe(z.email("Ingresa un correo válido"));

/** Debe coincidir con la política de Supabase Auth (supabase/config.toml). */
export const passwordSchema = z
  .string()
  .min(10, "La contraseña debe tener al menos 10 caracteres")
  .max(72, "La contraseña no puede tener más de 72 caracteres")
  .regex(/[a-z]/, "Debe incluir al menos una letra minúscula")
  .regex(/[A-Z]/, "Debe incluir al menos una letra mayúscula")
  .regex(/\d/, "Debe incluir al menos un número");

export const loginSchema = z.object({
  correo: correoSchema,
  password: z.string().min(1, "Ingresa tu contraseña").max(72),
  // El destino se valida aparte con rutaSegura(); aquí solo se acepta texto.
  next: z.string().optional(),
});

export const cambioPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmacion: z.string(),
  })
  .refine((d) => d.password === d.confirmacion, {
    message: "Las contraseñas no coinciden",
    path: ["confirmacion"],
  });

export const codigoMfaSchema = z.object({
  factorId: z.uuid(),
  codigo: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 dígitos"),
});

export const rolNuevoSchema = z.object({
  codigo: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,40}$/, "Usa solo letras minúsculas, números y _ (empieza con letra)")
    .refine((c) => c !== "superadmin", "Ese código está reservado"),
  nombre: z.string().trim().min(2, "Nombre muy corto").max(60),
  descripcion: z.string().trim().max(300).optional(),
  alcance: z.enum(["empresa", "todas", "comedor"]),
  requiere_mfa: z.boolean(),
});

/** Primer mensaje de error legible de un resultado de Zod. */
export function primerError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos no válidos";
}
