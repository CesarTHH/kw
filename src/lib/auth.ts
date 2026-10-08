import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { AlertaVisible } from "@/components/contenido/AlertasLogin";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { puede, type Accion, type ItemMenu } from "@/lib/permisos";

export type Contexto = {
  usuario_id: string;
  nombre: string;
  correo: string;
  estado: "pendiente" | "activo" | "inactivo";
  rol_codigo: string | null;
  rol_nombre: string | null;
  alcance: "empresa" | "todas" | "comedor" | null;
  requiere_mfa: boolean;
  mfa_verificado: boolean;
  debe_cambiar_password: boolean;
  empresa_id: string | null;
  empresa_ruc: string | null;
  empresa_nombre: string | null;
  comedor_id: string | null;
  activo: boolean;
};

type Sesion = { contexto: Contexto | null; menu: ItemMenu[]; alertas: AlertaVisible[] };

/**
 * Perfil, menú y alertas del usuario en UNA sola llamada a la base de datos,
 * una vez por petición. El proxy ya validó la firma del token (getClaims);
 * aquí el token lo vuelve a verificar la base de datos (PostgREST), así que un
 * token inválido simplemente no devuelve perfil.
 */
const obtenerSesion = cache(async (): Promise<Sesion> => {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("mi_sesion");
  if (error) {
    // Sin sesión PostgREST responde 401/403: no es un error de la app.
    if (error.code !== "PGRST301" && error.code !== "42501") console.error("[auth] mi_sesion falló:", error.code);
    return { contexto: null, menu: [], alertas: [] };
  }
  const s = (data ?? {}) as Partial<Sesion>;
  return { contexto: s.contexto ?? null, menu: s.menu ?? [], alertas: s.alertas ?? [] };
});

/** Usuario autenticado + su perfil. Se calcula una vez por petición. */
export const obtenerContexto = cache(async (): Promise<Contexto | null> => (await obtenerSesion()).contexto);

/** Menús y acciones permitidas al usuario. Se calcula una vez por petición. */
export const obtenerMenu = cache(async (): Promise<ItemMenu[]> => (await obtenerSesion()).menu);

/** Alertas post-login vigentes para el usuario. */
export const obtenerAlertas = cache(async (): Promise<AlertaVisible[]> => (await obtenerSesion()).alertas);

/**
 * Exige una sesión completa y válida. Redirige según el estado del usuario:
 * sin sesión → login · pendiente → aviso · debe cambiar contraseña · falta MFA.
 */
export async function requerirSesion(): Promise<Contexto> {
  const ctx = await obtenerContexto();
  // Sin perfil o con error: se cierra la sesión (evita bucles entre /login y /menu).
  if (!ctx) redirect("/salir?motivo=error");
  if (ctx.estado === "pendiente") redirect("/pendiente");
  if (ctx.estado === "inactivo") redirect("/salir?motivo=inactivo");
  if (ctx.debe_cambiar_password) redirect("/cambiar-password");
  if (ctx.requiere_mfa && !ctx.mfa_verificado) redirect("/mfa");
  if (!ctx.activo) redirect("/salir?motivo=inactivo");
  return ctx;
}

/**
 * Exige permiso sobre un menú. Úsalo en CADA página y CADA Server Action:
 * ocultar un botón no es seguridad.
 */
export async function requerirPermiso(menu: string, accion: Accion = "ver"): Promise<Contexto> {
  const ctx = await requerirSesion();
  const items = await obtenerMenu();
  if (!puede(items, menu, accion)) notFound();
  return ctx;
}

/** Igual que requerirPermiso, pero para Server Actions: devuelve null en vez de redirigir. */
export async function permisoEnAccion(menu: string, accion: Accion): Promise<Contexto | null> {
  const ctx = await obtenerContexto();
  if (!ctx || ctx.estado !== "activo" || !ctx.activo || ctx.debe_cambiar_password) return null;
  if (ctx.requiere_mfa && !ctx.mfa_verificado) return null;
  const items = await obtenerMenu();
  return puede(items, menu, accion) ? ctx : null;
}

export function esSuperadmin(ctx: Contexto): boolean {
  return ctx.rol_codigo === "superadmin" && ctx.activo;
}
