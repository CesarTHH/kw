/** Filtros, nombres y diferencias del visor de auditoría (compartido por la pantalla y la exportación). */

import { terminoBusqueda } from "@/lib/busqueda";

export type FiltrosAuditoria = {
  usuario: string;
  empresa: string;
  modulo?: string;
  accion?: string;
  desde?: string;
  hasta?: string;
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CODIGO = /^[a-z][a-z0-9_.]{0,59}$/;

export function leerFiltrosAuditoria(sp: Record<string, string | undefined>): FiltrosAuditoria {
  return {
    usuario: terminoBusqueda(sp.u),
    empresa: terminoBusqueda(sp.e),
    modulo: sp.m && CODIGO.test(sp.m) ? sp.m : undefined,
    accion: sp.a && CODIGO.test(sp.a) ? sp.a : undefined,
    desde: sp.desde && FECHA.test(sp.desde) ? sp.desde : undefined,
    hasta: sp.hasta && FECHA.test(sp.hasta) ? sp.hasta : undefined,
  };
}

/** Parámetros de URL de los filtros (para enlaces y exportación). */
export function paramsAuditoria(f: FiltrosAuditoria): Record<string, string | undefined> {
  return { u: f.usuario || undefined, e: f.empresa || undefined, m: f.modulo, a: f.accion, desde: f.desde, hasta: f.hasta };
}

export const MODULOS: Record<string, string> = {
  sesion: "Inicio de sesión",
  seguridad: "Usuarios y permisos",
  datos: "Datos",
  maestras: "Tablas maestras",
  catalogos: "Catálogos",
  usuarios: "Usuarios",
  roles: "Roles y permisos",
  registro: "Registro de empresas",
  configuracion: "Configuración",
  correos: "Correos",
  raciones: "Raciones",
  refrigerios: "Refrigerios",
  documentos: "Documentos",
  alertas: "Alertas",
  contactanos: "Contáctanos",
  importador: "Importador",
};

export const ACCIONES: Record<string, string> = {
  login: "Inició sesión",
  logout: "Cerró sesión",
  mfa_activado: "Activó la verificación en dos pasos",
  mfa_verificado: "Verificó el segundo paso",
  cambio_password: "Cambió su contraseña",
  crear: "Creó",
  editar: "Modificó",
  borrar: "Eliminó",
  insert: "Creó",
  update: "Modificó",
  delete: "Eliminó",
  enviar_raciones: "Envió raciones",
  enviar_refrigerios: "Envió refrigerios",
  reducir_refrigerio: "Redujo refrigerios",
  publicar_documento: "Publicó un documento",
  restaurar_documento: "Volvió a publicar una versión",
  enviar_mensaje: "Envió un mensaje",
  reenviar: "Reenvió un correo",
};

export const nombreModulo = (m: string) => MODULOS[m] ?? m;
export const nombreAccion = (a: string) => ACCIONES[a.toLowerCase()] ?? a.replace(/_/g, " ");

type Json = Record<string, unknown> | null;

/** Campos que cambiaron entre "antes" y "después" (sin las marcas de tiempo internas). */
export function diferencias(antes: Json, despues: Json): { campo: string; antes: unknown; despues: unknown }[] {
  const ignorar = new Set(["updated_at", "created_at", "ultimo_acceso"]);
  const claves = new Set([...Object.keys(antes ?? {}), ...Object.keys(despues ?? {})]);
  const salida: { campo: string; antes: unknown; despues: unknown }[] = [];
  for (const c of [...claves].sort()) {
    if (ignorar.has(c)) continue;
    const a = antes?.[c];
    const d = despues?.[c];
    if (JSON.stringify(a) !== JSON.stringify(d)) salida.push({ campo: c, antes: a, despues: d });
  }
  return salida;
}

/** Valor legible para la tabla de cambios. */
export function textoValor(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
