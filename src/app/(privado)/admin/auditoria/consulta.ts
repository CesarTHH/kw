import "server-only";
import type { FiltrosAuditoria } from "@/lib/auditoria";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export type FilaAuditoria = {
  id: number;
  en: string;
  usuario_id: string | null;
  empresa_id: string | null;
  modulo: string;
  accion: string;
  entidad: string | null;
  entidad_id: string | null;
  ip: string | null;
};

export const COLUMNAS_LISTA = "id, en, usuario_id, empresa_id, modulo, accion, entidad, entidad_id, ip";

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

/**
 * Consulta de auditoría con los filtros. El texto de usuario y de empresa se
 * convierte primero en una lista de ids (máximo 200 coincidencias de cada uno).
 * Devuelve null si un filtro de texto no coincide con nadie (resultado vacío).
 * La consulta va dentro de un objeto: si se devolviera sola, el await la ejecutaría.
 */
export async function consultaAuditoria(supabase: Cliente, f: FiltrosAuditoria, columnas: string, opciones?: { count?: "exact" }) {
  const [usuarios, empresas] = await Promise.all([
    f.usuario
      ? supabase.from("perfiles").select("id").or(`nombre.ilike.*${f.usuario}*,correo.ilike.*${f.usuario}*`).limit(200)
      : Promise.resolve(null),
    f.empresa
      ? supabase.from("empresas").select("id").or(`nombre_corto.ilike.*${f.empresa}*,razon_social.ilike.*${f.empresa}*,ruc.ilike.*${f.empresa}*`).limit(200)
      : Promise.resolve(null),
  ]);
  const idsUsuario = usuarios ? ((usuarios.data ?? []) as { id: string }[]).map((x) => x.id) : null;
  const idsEmpresa = empresas ? ((empresas.data ?? []) as { id: string }[]).map((x) => x.id) : null;
  if ((idsUsuario && !idsUsuario.length) || (idsEmpresa && !idsEmpresa.length)) return null;

  let q = supabase.from("auditoria").select(columnas, opciones).order("en", { ascending: false }).order("id", { ascending: false });
  if (idsUsuario) q = q.in("usuario_id", idsUsuario);
  if (idsEmpresa) q = q.in("empresa_id", idsEmpresa);
  if (f.modulo) q = q.eq("modulo", f.modulo);
  if (f.accion) q = q.eq("accion", f.accion);
  if (f.desde) q = q.gte("en", `${f.desde}T00:00:00-05:00`);
  if (f.hasta) q = q.lte("en", `${f.hasta}T23:59:59.999-05:00`);
  return { q };
}

/** Pide filas por id en tandas de 150 (la URL de cada pedido no puede ser muy larga). */
async function porTandas<T>(ids: string[], pedir: (tanda: string[]) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const salida: T[] = [];
  for (let i = 0; i < ids.length; i += 150) salida.push(...(((await pedir(ids.slice(i, i + 150))).data ?? []) as T[]));
  return salida;
}

/** Nombres de usuarios y empresas para mostrar (sin depender de que sigan existiendo). */
export async function nombres(supabase: Cliente, filas: { usuario_id: string | null; empresa_id: string | null }[]) {
  const us = [...new Set(filas.map((f) => f.usuario_id).filter((x): x is string => !!x))];
  const em = [...new Set(filas.map((f) => f.empresa_id).filter((x): x is string => !!x))];
  const [u, e] = await Promise.all([
    porTandas<{ id: string; nombre: string; correo: string }>(us, (t) => supabase.from("perfiles").select("id, nombre, correo").in("id", t)),
    porTandas<{ id: string; nombre_corto: string; ruc: string }>(em, (t) => supabase.from("empresas").select("id, nombre_corto, ruc").in("id", t)),
  ]);
  return { usuarios: new Map(u.map((x) => [x.id, x])), empresas: new Map(e.map((x) => [x.id, x])) };
}
