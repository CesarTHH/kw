import type { Metadata } from "next";
import Link from "next/link";
import { BotonEnviar } from "@/components/BotonEnviar";
import { FormAlerta } from "@/components/contenido/FormAlerta";
import { TextoEnriquecido } from "@/components/contenido/TextoEnriquecido";
import { Encabezado } from "@/components/Encabezado";
import { Avisos } from "@/components/maestras/Avisos";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { ahoraIso, zonaHoraria } from "@/lib/contenido/servidor";
import { fechaHora, utcALocal } from "@/lib/fechas";
import { puede } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { cambiarEstadoAlerta, guardarAlerta } from "./acciones";

export const metadata: Metadata = { title: "Alertas post-login" };

type Alerta = {
  id: string;
  titulo: string;
  contenido: string;
  desde: string;
  hasta: string;
  roles: string[];
  una_vez: boolean;
  activo: boolean;
};

export default async function Pagina({ searchParams }: { searchParams: Promise<{ id?: string; ok?: string; error?: string }> }) {
  const ctx = await requerirPermiso("admin.alertas");
  const editar = puede(await obtenerMenu(), "admin.alertas", "editar");
  const { id, ok, error } = await searchParams;
  const supabase = await crearClienteServidor();
  const [zona, ahora, { data: alertasData }, { data: rolesData }, { data: vistasData }] = await Promise.all([
    zonaHoraria(),
    ahoraIso(),
    supabase.from("alertas").select("id, titulo, contenido, desde, hasta, roles, una_vez, activo").order("desde", { ascending: false }).limit(100),
    supabase.from("roles").select("codigo, nombre").eq("activo", true).order("nombre"),
    supabase.from("alertas_vistas").select("alerta_id, usuario_id").limit(20000),
  ]);
  const alertas = (alertasData ?? []) as Alerta[];
  const roles = (rolesData ?? []) as { codigo: string; nombre: string }[];
  const nombreRol = new Map(roles.map((r) => [r.codigo, r.nombre]));
  const vistas = new Map<string, Set<string>>();
  for (const v of (vistasData ?? []) as { alerta_id: string; usuario_id: string }[]) {
    if (!vistas.has(v.alerta_id)) vistas.set(v.alerta_id, new Set());
    vistas.get(v.alerta_id)!.add(v.usuario_id);
  }
  const enUnaSemana = new Date(Date.parse(ahora) + 7 * 86_400_000).toISOString();
  const editando = id === "nueva" ? null : esUuid(id) ? alertas.find((a) => a.id === id) : undefined;
  const mostrarForm = editar && (id === "nueva" || editando);

  const estado = (a: Alerta) =>
    !a.activo ? "Desactivada" : a.hasta <= ahora ? "Terminada" : a.desde > ahora ? "Programada" : "Vigente";

  return (
    <>
      <Encabezado titulo="Alertas post-login" ctx={ctx} />
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[3fr_2fr]">
        <section className="space-y-3">
          <Avisos ok={ok} error={error === "fechas" ? "datos" : error} detalle={error === "fechas" ? "La fecha final debe ser posterior a la inicial." : undefined} />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-oliva">Alertas</h2>
            {editar && (
              <Link href="/admin/alertas?id=nueva" className="btn-marca">
                Nueva alerta
              </Link>
            )}
          </div>
          {alertas.length === 0 ? (
            <p className="panel text-sm text-gris-medio">Aún no hay alertas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabla w-full text-sm">
                <thead>
                  <tr>
                    <th>Título</th>
                    <th>Vigencia</th>
                    <th>Roles</th>
                    <th>Se muestra</th>
                    <th>Vista por</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {alertas.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/admin/alertas?id=${a.id}`} className="font-semibold text-oliva underline">
                          {a.titulo}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {fechaHora(a.desde, zona)}
                        <br />
                        {fechaHora(a.hasta, zona)}
                      </td>
                      <td className="text-xs">{a.roles.map((r) => nombreRol.get(r) ?? r).join(", ")}</td>
                      <td className="text-xs">{a.una_vez ? "Una vez por usuario" : "En cada inicio de sesión"}</td>
                      <td className="text-right tabular-nums">{vistas.get(a.id)?.size ?? 0}</td>
                      <td className="text-xs">{estado(a)}</td>
                      <td>
                        {editar && (
                          <form action={cambiarEstadoAlerta}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="activo" value={a.activo ? "0" : "1"} />
                            <BotonEnviar className="btn-secundario px-2 py-1 text-xs" pendiente="…">
                              {a.activo ? "Desactivar" : "Activar"}
                            </BotonEnviar>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          {mostrarForm ? (
            <FormAlerta action={guardarAlerta} className="panel space-y-3">
              <h2 className="text-lg font-semibold text-oliva">{editando ? "Editar alerta" : "Nueva alerta"}</h2>
              <input type="hidden" name="id" value={editando?.id ?? "nueva"} />
              <label className="block">
                <span className="etiqueta">Título</span>
                <input name="titulo" required maxLength={120} defaultValue={editando?.titulo} className="campo" />
              </label>
              <label className="block">
                <span className="etiqueta">Mensaje</span>
                <textarea name="contenido" required maxLength={4000} rows={7} defaultValue={editando?.contenido} className="campo" />
                <span className="mt-1 block text-xs text-gris-medio">
                  Formato: **negrita**, *cursiva*, líneas que empiezan con «- » para listas, una línea en blanco para separar
                  párrafos. Los enlaces https:// se activan solos.
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="etiqueta">Desde ({zona})</span>
                  <input
                    name="desde"
                    type="datetime-local"
                    required
                    defaultValue={utcALocal(editando?.desde ?? ahora, zona)}
                    className="campo"
                  />
                </label>
                <label className="block">
                  <span className="etiqueta">Hasta</span>
                  <input
                    name="hasta"
                    type="datetime-local"
                    required
                    defaultValue={utcALocal(editando?.hasta ?? enUnaSemana, zona)}
                    className="campo"
                  />
                </label>
              </div>
              <fieldset>
                <legend className="etiqueta">Para los roles</legend>
                <div className="grid gap-1 min-[400px]:grid-cols-2">
                  {roles.map((r) => (
                    <label key={r.codigo} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="roles"
                        value={r.codigo}
                        defaultChecked={editando ? editando.roles.includes(r.codigo) : r.codigo === "contratista"}
                        className="size-4 accent-marca"
                      />
                      {r.nombre}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="etiqueta">Mostrar</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="una_vez" value="una_vez" defaultChecked={editando ? editando.una_vez : true} className="accent-marca" />
                  Una sola vez por usuario
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="una_vez" value="cada_login" defaultChecked={editando ? !editando.una_vez : false} className="accent-marca" />
                  En cada inicio de sesión
                </label>
              </fieldset>
              <div className="flex justify-end gap-2">
                <Link href="/admin/alertas" className="btn-secundario">
                  Cancelar
                </Link>
                <BotonEnviar pendiente="Guardando…">Guardar</BotonEnviar>
              </div>
              {editando && (
                <div className="rounded border border-gris-medio/30 p-3 text-sm">
                  <p className="etiqueta">Así se ve</p>
                  <p className="font-semibold">{editando.titulo}</p>
                  <TextoEnriquecido texto={editando.contenido} />
                </div>
              )}
            </FormAlerta>
          ) : editando ? (
            <div className="panel space-y-2 text-sm">
              <h2 className="text-lg font-semibold text-oliva">{editando.titulo}</h2>
              <TextoEnriquecido texto={editando.contenido} />
            </div>
          ) : (
            <p className="panel text-sm text-gris-medio">
              Las alertas aparecen en una ventana al entrar al portal, solo para los roles elegidos y dentro de sus fechas.
            </p>
          )}
        </section>
      </main>
    </>
  );
}
