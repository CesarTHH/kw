import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { BotonEnviar } from "@/components/BotonEnviar";
import { Avisos } from "@/components/maestras/Avisos";
import { Buscador } from "@/components/maestras/Buscador";
import { Estado } from "@/components/maestras/Estado";
import { EstadoLista } from "@/components/maestras/EstadoLista";
import { filtroEstado, SelectorEstado } from "@/components/maestras/FiltroEstado";
import { Paginacion } from "@/components/maestras/Paginacion";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { esUuid, filtroOr, numeroPagina, rango, terminoBusqueda, urlCon } from "@/lib/busqueda";
import { puede } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { asignarEmpresa, cambiarEstadoAsignacion, cambiarEstadoFrente, guardarFrente } from "./acciones";

export const metadata: Metadata = { title: "Frentes de trabajo" };

const RUTA = "/maestras/frentes";

type Opcion = { id: string; nombre: string; activo?: boolean };
type Frente = {
  id: string;
  proyecto_id: string;
  area_id: string;
  nombre: string;
  sponsor: string | null;
  contrato_desde: string | null;
  contrato_hasta: string | null;
  activo: boolean;
};
type Asignacion = {
  empresa_id: string;
  contrato_desde: string | null;
  contrato_hasta: string | null;
  activo: boolean;
  empresas: { ruc: string; razon_social: string } | null;
};

export default async function PaginaFrentes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requerirPermiso("maestras.frentes");
  const menu = await obtenerMenu();
  const editar = puede(menu, "maestras.frentes", "editar") && ctx.alcance === "todas";
  const exportar = puede(menu, "maestras.frentes", "exportar");

  const sp = await searchParams;
  const q = terminoBusqueda(sp.q);
  const p = numeroPagina(sp.p);
  const f = filtroEstado(sp.f);
  const pr = esUuid(sp.pr) ? sp.pr : undefined;
  const id = sp.id === "nuevo" && editar ? "nuevo" : esUuid(sp.id) ? sp.id : undefined;
  const lista = { q, p: String(p), f, pr };

  const supabase = await crearClienteServidor();
  let consulta = supabase
    .from("frentes_trabajo")
    .select("id, nombre, sponsor, activo, proyectos(nombre), areas(nombre)", { count: "exact" })
    .order("nombre");
  if (q) consulta = consulta.or(filtroOr(["nombre", "sponsor"], q));
  if (pr) consulta = consulta.eq("proyecto_id", pr);
  if (f !== "todos") consulta = consulta.eq("activo", f === "activos");
  const [desde, hasta] = rango(p);

  const [{ data: filas, count }, { data: proyectosData }, { data: areasData }] = await Promise.all([
    consulta.range(desde, hasta),
    supabase.from("proyectos").select("id, nombre, activo").order("nombre"),
    supabase.from("areas").select("id, nombre, activo").order("nombre"),
  ]);
  const proyectos = (proyectosData ?? []) as Opcion[];
  const areas = (areasData ?? []) as Opcion[];

  let frente: Frente | null = null;
  let asignaciones: Asignacion[] = [];
  let empresas: { id: string; ruc: string; razon_social: string }[] = [];
  if (id && id !== "nuevo") {
    const [fr, a, e] = await Promise.all([
      supabase
        .from("frentes_trabajo")
        .select("id, proyecto_id, area_id, nombre, sponsor, contrato_desde, contrato_hasta, activo")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("empresa_frentes")
        .select("empresa_id, contrato_desde, contrato_hasta, activo, empresas(ruc, razon_social)")
        .eq("frente_id", id),
      editar
        ? supabase.from("empresas").select("id, ruc, razon_social").eq("activo", true).order("razon_social")
        : Promise.resolve({ data: [] }),
    ]);
    frente = (fr.data as Frente | null) ?? null;
    asignaciones = (a.data ?? []) as unknown as Asignacion[];
    empresas = (e.data ?? []) as typeof empresas;
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_28rem]">
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1">
            <Buscador accion={RUTA} q={q} placeholder="Frente o sponsor">
              <label>
                <span className="sr-only">Proyecto</span>
                <select name="pr" defaultValue={pr ?? ""} className="campo w-auto">
                  <option value="">Todos los proyectos</option>
                  {proyectos.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <SelectorEstado valor={f} />
            </Buscador>
          </div>
          {editar && (
            <Link href={urlCon(RUTA, { ...lista, id: "nuevo" })} className="btn-marca">
              <Plus className="size-4" aria-hidden /> Nuevo frente
            </Link>
          )}
          {exportar && (
            <a href={urlCon("/maestras/exportar/frentes", { q, f, pr })} className="btn-secundario">
              <Download className="size-4" aria-hidden /> Excel
            </a>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl shadow">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Frente</th>
                <th scope="col">Proyecto</th>
                <th scope="col" className="hidden md:table-cell">Área</th>
                <th scope="col" className="hidden md:table-cell">Sponsor</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(filas ?? []).map((r) => (
                <tr key={r.id} className={r.id === id ? "outline-2 -outline-offset-2 outline-marca" : undefined}>
                  <td>
                    <Link href={urlCon(RUTA, { ...lista, id: r.id })} className="font-medium text-oliva hover:underline">
                      {r.nombre}
                    </Link>
                  </td>
                  <td>{r.proyectos?.nombre}</td>
                  <td className="hidden md:table-cell">{r.areas?.nombre}</td>
                  <td className="hidden md:table-cell">{r.sponsor}</td>
                  <td>
                    <Estado activo={r.activo} />
                  </td>
                </tr>
              ))}
              {!filas?.length && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gris-medio">
                    No hay frentes que coincidan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginacion base={RUTA} params={lista} pagina={p} total={count ?? 0} />
      </section>

      <aside className="space-y-4">
        <Avisos ok={sp.ok} error={sp.error} />
        {!id && <p className="panel text-sm text-oliva">Elige un frente de la lista para ver sus datos y empresas asignadas.</p>}
        {id && id !== "nuevo" && !frente && <p className="alerta-error">El frente no existe o no tienes acceso.</p>}

        {(id === "nuevo" || frente) && (
          <form action={guardarFrente} className="panel space-y-3">
            <h2 className="font-semibold text-oliva">{frente ? "Datos del frente" : "Nuevo frente de trabajo"}</h2>
            <input type="hidden" name="id" value={frente?.id ?? "nuevo"} />
            <EstadoLista q={q} p={p} f={f} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="etiqueta">Proyecto *</span>
                <select name="proyecto_id" required defaultValue={frente?.proyecto_id ?? ""} disabled={!editar} className="campo">
                  <option value="" disabled>
                    Elige…
                  </option>
                  {proyectos
                    .filter((o) => o.activo || o.id === frente?.proyecto_id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <span className="etiqueta">Área *</span>
                <select name="area_id" required defaultValue={frente?.area_id ?? ""} disabled={!editar} className="campo">
                  <option value="" disabled>
                    Elige…
                  </option>
                  {areas
                    .filter((o) => o.activo || o.id === frente?.area_id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="etiqueta">Nombre del frente *</span>
              <input name="nombre" required maxLength={150} defaultValue={frente?.nombre} disabled={!editar} className="campo uppercase" />
            </label>
            <label className="block">
              <span className="etiqueta">Sponsor</span>
              <input name="sponsor" maxLength={150} defaultValue={frente?.sponsor ?? ""} disabled={!editar} className="campo" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="etiqueta">Contrato desde</span>
                <input type="date" name="contrato_desde" defaultValue={frente?.contrato_desde ?? ""} disabled={!editar} className="campo" />
              </label>
              <label className="block">
                <span className="etiqueta">Contrato hasta</span>
                <input type="date" name="contrato_hasta" defaultValue={frente?.contrato_hasta ?? ""} disabled={!editar} className="campo" />
              </label>
            </div>
            {editar && (
              <div className="flex justify-end">
                <BotonEnviar pendiente="Guardando…">{frente ? "Guardar" : "Crear frente"}</BotonEnviar>
              </div>
            )}
          </form>
        )}

        {frente && editar && (
          <form action={cambiarEstadoFrente} className="flex items-center justify-between gap-2 rounded-xl bg-white p-3 shadow">
            <span className="text-sm">
              Estado: <Estado activo={frente.activo} />
            </span>
            <input type="hidden" name="id" value={frente.id} />
            <input type="hidden" name="activo" value={frente.activo ? "0" : "1"} />
            <EstadoLista q={q} p={p} f={f} />
            <BotonEnviar className="btn-secundario">{frente.activo ? "Desactivar" : "Activar"}</BotonEnviar>
          </form>
        )}

        {frente && (
          <section className="panel space-y-3">
            <h2 className="font-semibold text-oliva">Empresas asignadas</h2>
            {asignaciones.length === 0 && <p className="text-sm text-gris-medio">Ninguna empresa tiene este frente.</p>}
            <ul className="space-y-2 text-sm">
              {asignaciones.map((a) => (
                <li key={a.empresa_id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-3 py-2">
                  <span>
                    <Link href={urlCon("/maestras/clientes", { id: a.empresa_id })} className="font-medium text-oliva hover:underline">
                      {a.empresas?.razon_social}
                    </Link>
                    <span className="block text-gris-medio">
                      {a.empresas?.ruc}
                      {a.contrato_desde ? ` · ${a.contrato_desde} a ${a.contrato_hasta ?? "—"}` : ""}
                    </span>
                  </span>
                  {editar ? (
                    <form action={cambiarEstadoAsignacion}>
                      <input type="hidden" name="frente_id" value={frente.id} />
                      <input type="hidden" name="empresa_id" value={a.empresa_id} />
                      <input type="hidden" name="activo" value={a.activo ? "0" : "1"} />
                      <EstadoLista q={q} p={p} f={f} />
                      <BotonEnviar className="btn-secundario px-3! py-1! text-xs">{a.activo ? "Quitar" : "Reactivar"}</BotonEnviar>
                    </form>
                  ) : (
                    <Estado activo={a.activo} />
                  )}
                </li>
              ))}
            </ul>

            {editar && (
              <details className="rounded-lg bg-white p-3 shadow-sm">
                <summary className="cursor-pointer text-sm font-semibold text-marca">+ Asignar empresa</summary>
                <form action={asignarEmpresa} className="mt-3 space-y-2">
                  <input type="hidden" name="frente_id" value={frente.id} />
                  <EstadoLista q={q} p={p} f={f} />
                  <label className="block">
                    <span className="etiqueta">Empresa *</span>
                    <select name="empresa_id" required defaultValue="" className="campo">
                      <option value="" disabled>
                        Elige…
                      </option>
                      {empresas.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.razon_social} ({e.ruc})
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="etiqueta">Contrato desde</span>
                      <input type="date" name="contrato_desde" defaultValue={frente.contrato_desde ?? ""} className="campo" />
                    </label>
                    <label className="block">
                      <span className="etiqueta">Contrato hasta</span>
                      <input type="date" name="contrato_hasta" defaultValue={frente.contrato_hasta ?? ""} className="campo" />
                    </label>
                  </div>
                  <p className="text-xs text-gris-medio">Si la empresa ya estaba asignada, se actualizan sus fechas y se reactiva.</p>
                  <div className="flex justify-end">
                    <BotonEnviar pendiente="Asignando…">Asignar</BotonEnviar>
                  </div>
                </form>
              </details>
            )}
          </section>
        )}
      </aside>
    </main>
  );
}
