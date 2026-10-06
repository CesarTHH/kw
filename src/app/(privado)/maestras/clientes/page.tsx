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
import { TIPOS_CONTACTO } from "@/lib/maestras/esquemas";
import { puede } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { cambiarEstadoContacto, cambiarEstadoEmpresa, guardarContacto, guardarEmpresa } from "./acciones";

export const metadata: Metadata = { title: "Clientes y contactos" };

const RUTA = "/maestras/clientes";

type Empresa = {
  id: string;
  ruc: string;
  razon_social: string;
  nombre_corto: string;
  direccion: string | null;
  tipo: "empresa" | "persona";
  telefonos: string | null;
  activo: boolean;
};
type Contacto = {
  id: string;
  tipo: keyof typeof TIPOS_CONTACTO;
  nombre: string;
  telefono: string | null;
  correo: string;
  recibe_notificaciones: boolean;
  activo: boolean;
};
type Asignacion = {
  frente_id: string;
  contrato_desde: string | null;
  contrato_hasta: string | null;
  activo: boolean;
  frentes_trabajo: { nombre: string; proyectos: { nombre: string } | null; areas: { nombre: string } | null } | null;
};

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requerirPermiso("maestras.clientes");
  const menu = await obtenerMenu();
  const editar = puede(menu, "maestras.clientes", "editar");
  const exportar = puede(menu, "maestras.clientes", "exportar");
  const crear = editar && ctx.alcance === "todas";

  const sp = await searchParams;
  const q = terminoBusqueda(sp.q);
  const p = numeroPagina(sp.p);
  const f = filtroEstado(sp.f);
  const id = sp.id === "nuevo" && crear ? "nuevo" : esUuid(sp.id) ? sp.id : undefined;
  const lista = { q, p: String(p), f };

  const supabase = await crearClienteServidor();
  let consulta = supabase
    .from("empresas")
    .select("id, ruc, razon_social, nombre_corto, activo", { count: "exact" })
    .order("razon_social");
  if (q) consulta = consulta.or(filtroOr(["ruc", "razon_social", "nombre_corto"], q));
  if (f !== "todos") consulta = consulta.eq("activo", f === "activos");
  const [desde, hasta] = rango(p);
  const { data: filas, count } = await consulta.range(desde, hasta);

  let empresa: Empresa | null = null;
  let contactos: Contacto[] = [];
  let asignaciones: Asignacion[] = [];
  if (id && id !== "nuevo") {
    const [e, c, a] = await Promise.all([
      supabase.from("empresas").select("id, ruc, razon_social, nombre_corto, direccion, tipo, telefonos, activo").eq("id", id).maybeSingle(),
      supabase
        .from("empresa_contactos")
        .select("id, tipo, nombre, telefono, correo, recibe_notificaciones, activo")
        .eq("empresa_id", id)
        .order("activo", { ascending: false })
        .order("tipo")
        .order("nombre"),
      supabase
        .from("empresa_frentes")
        .select("frente_id, contrato_desde, contrato_hasta, activo, frentes_trabajo(nombre, proyectos(nombre), areas(nombre))")
        .eq("empresa_id", id),
    ]);
    empresa = (e.data as Empresa | null) ?? null;
    contactos = (c.data ?? []) as Contacto[];
    asignaciones = (a.data ?? []) as unknown as Asignacion[];
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_28rem]">
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1">
            <Buscador accion={RUTA} q={q} placeholder="RUC, razón social o nombre corto">
              <SelectorEstado valor={f} />
            </Buscador>
          </div>
          {crear && (
            <Link href={urlCon(RUTA, { ...lista, id: "nuevo" })} className="btn-marca">
              <Plus className="size-4" aria-hidden /> Nuevo cliente
            </Link>
          )}
          {exportar && (
            <a href={urlCon("/maestras/exportar/clientes", { q, f })} className="btn-secundario">
              <Download className="size-4" aria-hidden /> Excel
            </a>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl shadow">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">RUC</th>
                <th scope="col">Razón social</th>
                <th scope="col" className="hidden md:table-cell">Nombre corto</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(filas ?? []).map((r) => (
                <tr key={r.id} className={r.id === id ? "outline-2 -outline-offset-2 outline-marca" : undefined}>
                  <td className="font-mono">{r.ruc}</td>
                  <td>
                    <Link href={urlCon(RUTA, { ...lista, id: r.id })} className="font-medium text-oliva hover:underline">
                      {r.razon_social}
                    </Link>
                  </td>
                  <td className="hidden md:table-cell">{r.nombre_corto}</td>
                  <td>
                    <Estado activo={r.activo} />
                  </td>
                </tr>
              ))}
              {!filas?.length && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gris-medio">
                    No hay clientes que coincidan.
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

        {!id && <p className="panel text-sm text-oliva">Elige un cliente de la lista para ver sus datos y contactos.</p>}

        {id && id !== "nuevo" && !empresa && <p className="alerta-error">El cliente no existe o no tienes acceso.</p>}

        {(id === "nuevo" || empresa) && (
          <form action={guardarEmpresa} className="panel space-y-3">
            <h2 className="font-semibold text-oliva">{empresa ? "Datos del cliente" : "Nuevo cliente"}</h2>
            <input type="hidden" name="id" value={empresa?.id ?? "nuevo"} />
            <EstadoLista {...lista} p={p} />
            <label className="block">
              <span className="etiqueta">RUC *</span>
              {empresa ? (
                <input value={empresa.ruc} readOnly disabled className="campo font-mono" />
              ) : (
                <input name="ruc" required inputMode="numeric" pattern="\d{11}" maxLength={11} className="campo font-mono" />
              )}
            </label>
            <label className="block">
              <span className="etiqueta">Razón social *</span>
              <input name="razon_social" required maxLength={200} defaultValue={empresa?.razon_social} disabled={!editar} className="campo" />
            </label>
            <label className="block">
              <span className="etiqueta">Nombre corto *</span>
              <input name="nombre_corto" required maxLength={120} defaultValue={empresa?.nombre_corto} disabled={!editar} className="campo" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="etiqueta">Tipo</span>
                <select name="tipo" defaultValue={empresa?.tipo ?? "empresa"} disabled={!editar} className="campo">
                  <option value="empresa">Empresa</option>
                  <option value="persona">Persona natural</option>
                </select>
              </label>
              <label className="block">
                <span className="etiqueta">Teléfonos</span>
                <input name="telefonos" maxLength={200} defaultValue={empresa?.telefonos ?? ""} disabled={!editar} className="campo" />
              </label>
            </div>
            <label className="block">
              <span className="etiqueta">Dirección</span>
              <input name="direccion" maxLength={300} defaultValue={empresa?.direccion ?? ""} disabled={!editar} className="campo" />
            </label>
            {editar && (
              <div className="flex flex-wrap justify-end gap-2">
                <BotonEnviar pendiente="Guardando…">{empresa ? "Guardar" : "Crear cliente"}</BotonEnviar>
              </div>
            )}
          </form>
        )}

        {empresa && editar && ctx.alcance === "todas" && (
          <form action={cambiarEstadoEmpresa} className="flex items-center justify-between gap-2 rounded-xl bg-white p-3 shadow">
            <span className="text-sm">
              Estado: <Estado activo={empresa.activo} />
            </span>
            <input type="hidden" name="id" value={empresa.id} />
            <input type="hidden" name="activo" value={empresa.activo ? "0" : "1"} />
            <EstadoLista {...lista} p={p} />
            <BotonEnviar className="btn-secundario">{empresa.activo ? "Desactivar" : "Activar"}</BotonEnviar>
          </form>
        )}

        {empresa && (
          <section className="panel space-y-3">
            <h2 className="font-semibold text-oliva">Contactos</h2>
            {contactos.length === 0 && <p className="text-sm text-gris-medio">Sin contactos registrados.</p>}
            <ul className="space-y-2">
              {contactos.map((c) => (
                <li key={c.id} className="rounded-lg bg-white p-3 text-sm shadow-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                      <span className="font-semibold">{c.nombre}</span>
                      <span className="text-gris-medio">· {TIPOS_CONTACTO[c.tipo]}</span>
                      {!c.activo && <Estado activo={false} />}
                      <span className="w-full truncate text-gris-medio">
                        {c.correo}
                        {c.telefono ? ` · ${c.telefono}` : ""}
                        {c.recibe_notificaciones ? " · recibe notificaciones" : ""}
                      </span>
                    </summary>
                    {editar && (
                      <div className="mt-3 space-y-2">
                        <FormContacto empresaId={empresa.id} contacto={c} lista={lista} p={p} />
                        <form action={cambiarEstadoContacto} className="flex justify-end">
                          <input type="hidden" name="empresa_id" value={empresa.id} />
                          <input type="hidden" name="contacto_id" value={c.id} />
                          <input type="hidden" name="activo" value={c.activo ? "0" : "1"} />
                          <EstadoLista {...lista} p={p} />
                          <BotonEnviar className="btn-secundario">{c.activo ? "Desactivar contacto" : "Activar contacto"}</BotonEnviar>
                        </form>
                      </div>
                    )}
                  </details>
                </li>
              ))}
            </ul>
            {editar && (
              <details className="rounded-lg bg-white p-3 shadow-sm">
                <summary className="cursor-pointer text-sm font-semibold text-marca">+ Agregar contacto</summary>
                <div className="mt-3">
                  <FormContacto empresaId={empresa.id} lista={lista} p={p} />
                </div>
              </details>
            )}
          </section>
        )}

        {empresa && (
          <section className="panel space-y-2">
            <h2 className="font-semibold text-oliva">Frentes de trabajo asignados</h2>
            {asignaciones.length === 0 && <p className="text-sm text-gris-medio">Sin frentes asignados.</p>}
            <ul className="space-y-1 text-sm">
              {asignaciones.map((a) => (
                <li key={a.frente_id} className="rounded bg-white px-3 py-2">
                  <Link href={urlCon("/maestras/frentes", { id: a.frente_id })} className="font-medium text-oliva hover:underline">
                    {a.frentes_trabajo?.nombre}
                  </Link>{" "}
                  <span className="text-gris-medio">
                    · {a.frentes_trabajo?.proyectos?.nombre} / {a.frentes_trabajo?.areas?.nombre}
                    {a.contrato_desde ? ` · ${a.contrato_desde} a ${a.contrato_hasta ?? "—"}` : ""}
                  </span>{" "}
                  {!a.activo && <Estado activo={false} />}
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </main>
  );
}

function FormContacto({
  empresaId,
  contacto,
  lista,
  p,
}: {
  empresaId: string;
  contacto?: Contacto;
  lista: { q: string; f: string };
  p: number;
}) {
  return (
    <form action={guardarContacto} className="space-y-2">
      <input type="hidden" name="empresa_id" value={empresaId} />
      <input type="hidden" name="contacto_id" value={contacto?.id ?? "nuevo"} />
      <EstadoLista q={lista.q} f={lista.f} p={p} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="etiqueta">Tipo *</span>
          <select name="tipo" defaultValue={contacto?.tipo ?? "gestion_raciones"} className="campo">
            {Object.entries(TIPOS_CONTACTO).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="etiqueta">Teléfono</span>
          <input name="telefono" maxLength={60} defaultValue={contacto?.telefono ?? ""} className="campo" />
        </label>
      </div>
      <label className="block">
        <span className="etiqueta">Nombre *</span>
        <input name="nombre" required maxLength={150} defaultValue={contacto?.nombre} className="campo" />
      </label>
      <label className="block">
        <span className="etiqueta">Correo *</span>
        <input name="correo" type="email" required maxLength={254} defaultValue={contacto?.correo} className="campo" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="recibe_notificaciones" defaultChecked={contacto?.recibe_notificaciones} className="size-4 accent-marca" />
        Recibe las confirmaciones por correo
      </label>
      <div className="flex justify-end">
        <BotonEnviar pendiente="Guardando…">{contacto ? "Guardar contacto" : "Agregar contacto"}</BotonEnviar>
      </div>
    </form>
  );
}
