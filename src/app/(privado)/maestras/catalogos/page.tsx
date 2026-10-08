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
import { CATALOGOS, catalogoPorCodigo, columnasCatalogo, type Campo, type Catalogo } from "@/lib/maestras/catalogos";
import { puede } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import {
  cambiarEstadoCatalogo,
  guardarCatalogo,
  guardarComedorServicios,
  guardarEstandar,
  guardarTrasladosSector,
} from "./acciones";

export const metadata: Metadata = { title: "Catálogos" };

const RUTA = "/maestras/catalogos";
const MATRICES = [
  { codigo: "comedor_servicios", titulo: "Servicios por comedor" },
  { codigo: "traslados", titulo: "Traslados entre sectores" },
  { codigo: "estandar", titulo: "Refrigerio estándar" },
];
const FIN_INDEFINIDO = "2099-12-31";

type Fila = Record<string, unknown> & { id: string; activo?: boolean };
type Opciones = Record<string, { id: string; nombre: string }[]>;

export default async function PaginaCatalogos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requerirPermiso("maestras.catalogos");
  const menu = await obtenerMenu();
  const editar = puede(menu, "maestras.catalogos", "editar");
  const exportar = puede(menu, "maestras.catalogos", "exportar");
  const sp = await searchParams;
  const c = catalogoPorCodigo(sp.c) ? sp.c! : MATRICES.some((m) => m.codigo === sp.c) ? sp.c! : "proyectos";

  const subpestanas = [...CATALOGOS.map((k) => ({ codigo: k.codigo, titulo: k.titulo })), ...MATRICES];

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-6">
      <nav aria-label="Catálogos" className="flex flex-wrap gap-2">
        {subpestanas.map((s) => (
          <Link
            key={s.codigo}
            href={urlCon(RUTA, { c: s.codigo })}
            aria-current={s.codigo === c ? "page" : undefined}
            className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold ${
              s.codigo === c ? "bg-oliva text-white" : "bg-white text-oliva hover:bg-gris-panel"
            }`}
          >
            {s.titulo}
          </Link>
        ))}
      </nav>
      {c === "comedor_servicios" ? (
        <MatrizComedorServicios editar={editar} ok={sp.ok} error={sp.error} />
      ) : c === "traslados" ? (
        <MatrizTraslados editar={editar} ok={sp.ok} error={sp.error} />
      ) : c === "estandar" ? (
        <ComposicionEstandar editar={editar} ok={sp.ok} error={sp.error} />
      ) : (
        <ListaCatalogo cat={catalogoPorCodigo(c)!} sp={sp} editar={editar} exportar={exportar} />
      )}
    </main>
  );
}

/** Carga las opciones de los campos de referencia (sectores, tipos, servicios…). */
async function cargarOpciones(cat: Catalogo): Promise<Opciones> {
  const supabase = await crearClienteServidor();
  const refs = cat.campos.filter((f) => f.tipo === "referencia" && f.referencia);
  const resultados = await Promise.all(
    refs.map((f) => supabase.from(f.referencia!.tabla).select(`id, nombre:${f.referencia!.columna}`).order(f.referencia!.columna)),
  );
  const opciones: Opciones = {};
  refs.forEach((f, i) => {
    opciones[f.nombre] = (resultados[i]?.data ?? []) as unknown as { id: string; nombre: string }[];
  });
  return opciones;
}

function mostrar(f: Campo, v: unknown, opciones: Opciones): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (f.tipo) {
    case "booleano":
      return v ? "Sí" : "No";
    case "referencia":
      return opciones[f.nombre]?.find((o) => o.id === v)?.nombre ?? "—";
    case "decimal":
      return Number(v).toFixed(2);
    case "fecha":
      return v === FIN_INDEFINIDO ? "Sin fin" : String(v);
    case "hora":
      return String(v).slice(0, 5);
    default:
      return String(v);
  }
}

async function ListaCatalogo({
  cat,
  sp,
  editar,
  exportar,
}: {
  cat: Catalogo;
  sp: Record<string, string | undefined>;
  editar: boolean;
  exportar: boolean;
}) {
  const q = terminoBusqueda(sp.q);
  const p = numeroPagina(sp.p);
  const f = cat.tieneActivo ? filtroEstado(sp.f) : "todos";
  const id = sp.id === "nuevo" && editar ? "nuevo" : esUuid(sp.id) ? sp.id : undefined;
  const lista = { c: cat.codigo, q, p: String(p), f: cat.tieneActivo ? f : undefined };

  const supabase = await crearClienteServidor();
  let consulta = supabase.from(cat.tabla).select(columnasCatalogo(cat), { count: "exact" });
  for (const o of cat.orden) consulta = consulta.order(o.columna, { ascending: o.asc });
  if (q && cat.busqueda.length) consulta = consulta.or(filtroOr(cat.busqueda, q));
  if (cat.tieneActivo && f !== "todos") consulta = consulta.eq("activo", f === "activos");
  const [desde, hasta] = rango(p);

  const [{ data, count }, opciones, actual] = await Promise.all([
    consulta.range(desde, hasta),
    cargarOpciones(cat),
    id && id !== "nuevo"
      ? supabase.from(cat.tabla).select(columnasCatalogo(cat)).eq("id", id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const filas = (data ?? []) as unknown as Fila[];
  const registro = (actual.data ?? null) as unknown as Fila | null;
  const enLista = cat.campos.filter((x) => x.enLista !== false);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1">
            {(cat.busqueda.length > 0 || cat.tieneActivo) && (
              <Buscador accion={RUTA} q={q} placeholder={`Buscar ${cat.titulo.toLowerCase()}`} ocultos={{ c: cat.codigo }}>
                {cat.tieneActivo && <SelectorEstado valor={filtroEstado(sp.f)} />}
              </Buscador>
            )}
          </div>
          {editar && (
            <Link href={urlCon(RUTA, { ...lista, id: "nuevo" })} className="btn-marca">
              <Plus className="size-4" aria-hidden /> Nuevo {cat.singular}
            </Link>
          )}
          {exportar && (
            <a href={urlCon(`/maestras/exportar/${cat.codigo}`, { q, f: lista.f })} className="btn-secundario">
              <Download className="size-4" aria-hidden /> Excel
            </a>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl shadow">
          <table className="tabla">
            <thead>
              <tr>
                {enLista.map((x) => (
                  <th key={x.nombre} scope="col">
                    {x.etiqueta}
                  </th>
                ))}
                {cat.tieneActivo && <th scope="col">Estado</th>}
              </tr>
            </thead>
            <tbody>
              {filas.map((r) => (
                <tr key={r.id} className={r.id === id ? "outline-2 -outline-offset-2 outline-marca" : undefined}>
                  {enLista.map((x, i) => (
                    <td key={x.nombre}>
                      {i === 0 ? (
                        <Link href={urlCon(RUTA, { ...lista, id: r.id })} className="font-medium text-oliva hover:underline">
                          {mostrar(x, r[x.nombre], opciones)}
                        </Link>
                      ) : (
                        mostrar(x, r[x.nombre], opciones)
                      )}
                    </td>
                  ))}
                  {cat.tieneActivo && (
                    <td>
                      <Estado activo={!!r.activo} />
                    </td>
                  )}
                </tr>
              ))}
              {!filas.length && (
                <tr>
                  <td colSpan={enLista.length + 1} className="py-6 text-center text-gris-medio">
                    Sin registros.
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
        {!id && <p className="panel text-sm text-oliva">Elige un registro para verlo o editarlo.</p>}
        {id && id !== "nuevo" && !registro && <p className="alerta-error">El registro no existe.</p>}
        {(id === "nuevo" || registro) && (
          <form action={guardarCatalogo} className="panel space-y-3">
            <h2 className="font-semibold text-oliva">{registro ? `Editar ${cat.singular}` : `Nuevo ${cat.singular}`}</h2>
            <input type="hidden" name="c" value={cat.codigo} />
            <input type="hidden" name="id" value={registro?.id ?? "nuevo"} />
            <EstadoLista q={q} p={p} f={lista.f} />
            {cat.campos.map((x) => (
              <CampoCatalogo key={x.nombre} campo={x} valor={registro?.[x.nombre]} opciones={opciones} editar={editar} />
            ))}
            {editar && (
              <div className="flex justify-end">
                <BotonEnviar pendiente="Guardando…">{registro ? "Guardar" : "Crear"}</BotonEnviar>
              </div>
            )}
          </form>
        )}
        {registro && editar && cat.tieneActivo && (
          <form action={cambiarEstadoCatalogo} className="flex items-center justify-between gap-2 rounded-xl bg-white p-3 shadow">
            <span className="text-sm">
              Estado: <Estado activo={!!registro.activo} />
            </span>
            <input type="hidden" name="c" value={cat.codigo} />
            <input type="hidden" name="id" value={registro.id} />
            <input type="hidden" name="activo" value={registro.activo ? "0" : "1"} />
            <EstadoLista q={q} p={p} f={lista.f} />
            <BotonEnviar className="btn-secundario">{registro.activo ? "Desactivar" : "Activar"}</BotonEnviar>
          </form>
        )}
      </aside>
    </div>
  );
}

function CampoCatalogo({
  campo,
  valor,
  opciones,
  editar,
}: {
  campo: Campo;
  valor: unknown;
  opciones: Opciones;
  editar: boolean;
}) {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  const etiqueta = (
    <span className="etiqueta">
      {campo.etiqueta}
      {campo.requerido ? " *" : ""}
    </span>
  );
  const ayuda = campo.ayuda ? <span className="mt-1 block text-xs text-gris-medio">{campo.ayuda}</span> : null;

  switch (campo.tipo) {
    case "booleano":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name={campo.nombre} defaultChecked={!!valor} disabled={!editar} className="size-4 accent-marca" />
          {campo.etiqueta}
        </label>
      );
    case "referencia":
      return (
        <label className="block">
          {etiqueta}
          <select name={campo.nombre} defaultValue={texto} required={campo.requerido} disabled={!editar} className="campo">
            <option value="">{campo.requerido ? "Elige…" : "(ninguno)"}</option>
            {(opciones[campo.nombre] ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre}
              </option>
            ))}
          </select>
          {ayuda}
        </label>
      );
    case "hora":
      return (
        <label className="block">
          {etiqueta}
          <input type="time" name={campo.nombre} defaultValue={texto.slice(0, 5)} required={campo.requerido} disabled={!editar} className="campo" />
          {ayuda}
        </label>
      );
    case "texto":
      return (
        <label className="block">
          {etiqueta}
          <input name={campo.nombre} defaultValue={texto} required={campo.requerido} maxLength={40} disabled={!editar} className="campo" />
          {ayuda}
        </label>
      );
    case "fecha":
      return (
        <label className="block">
          {etiqueta}
          <input
            type="date"
            name={campo.nombre}
            defaultValue={texto === FIN_INDEFINIDO ? "" : texto}
            required={campo.requerido}
            disabled={!editar}
            className="campo"
          />
          {ayuda}
        </label>
      );
    case "entero":
    case "decimal":
      return (
        <label className="block">
          {etiqueta}
          <input
            type="number"
            name={campo.nombre}
            defaultValue={texto}
            min={0}
            step={campo.tipo === "decimal" ? "0.01" : "1"}
            required={campo.requerido}
            disabled={!editar}
            className="campo"
          />
          {ayuda}
        </label>
      );
    default:
      return (
        <label className="block">
          {etiqueta}
          <input
            name={campo.nombre}
            defaultValue={texto}
            required={campo.requerido}
            maxLength={150}
            disabled={!editar}
            className="campo uppercase"
          />
          {ayuda}
        </label>
      );
  }
}

async function MatrizComedorServicios({ editar, ok, error }: { editar: boolean; ok?: string; error?: string }) {
  const supabase = await crearClienteServidor();
  const [{ data: comedores }, { data: servicios }, { data: actuales }] = await Promise.all([
    supabase.from("comedores").select("id, nombre").eq("activo", true).eq("habilitado_raciones", true).order("nombre"),
    supabase.from("servicios").select("id, nombre").eq("activo", true).order("orden").order("nombre"),
    supabase.from("comedor_servicios").select("comedor_id, servicio_id").eq("activo", true),
  ]);
  const activos = new Set((actuales ?? []).map((r) => `${r.comedor_id}|${r.servicio_id}`));

  return (
    <section className="space-y-3">
      <Avisos ok={ok} error={error} />
      <p className="text-sm text-oliva">
        Marca los servicios que ofrece cada comedor. Solo aparecen los comedores activos habilitados para raciones.
      </p>
      <form action={guardarComedorServicios} className="overflow-x-auto rounded-xl bg-white shadow">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Comedor</th>
              {(servicios ?? []).map((s) => (
                <th key={s.id} scope="col" className="text-center!">
                  {s.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(comedores ?? []).map((c) => (
              <tr key={c.id}>
                <th scope="row" className="bg-transparent! font-semibold! text-neutral-800!">
                  {c.nombre}
                </th>
                {(servicios ?? []).map((s) => {
                  const k = `${c.id}|${s.id}`;
                  return (
                    <td key={s.id} className="text-center">
                      <input type="hidden" name="visible" value={k} />
                      <input
                        type="checkbox"
                        name="cs"
                        value={k}
                        defaultChecked={activos.has(k)}
                        disabled={!editar}
                        aria-label={`${c.nombre}: ${s.nombre}`}
                        className="size-4 accent-marca"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <input type="hidden" name="c" value="comedor_servicios" />
        {editar && (
          <div className="flex justify-end p-4">
            <BotonEnviar pendiente="Guardando…">Guardar</BotonEnviar>
          </div>
        )}
      </form>
    </section>
  );
}

async function MatrizTraslados({ editar, ok, error }: { editar: boolean; ok?: string; error?: string }) {
  const supabase = await crearClienteServidor();
  const [{ data: sectores }, { data: reglas }] = await Promise.all([
    supabase.from("sectores").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("traslado_reglas_sector").select("sector_origen_id, sector_destino_id"),
  ]);
  const permitidos = new Set((reglas ?? []).map((r) => `${r.sector_origen_id}|${r.sector_destino_id}`));

  return (
    <section className="space-y-3">
      <Avisos ok={ok} error={error} />
      <p className="text-sm text-oliva">
        Marca a qué sector (columnas) se pueden trasladar raciones desde cada sector de origen (filas).
      </p>
      <form action={guardarTrasladosSector} className="overflow-x-auto rounded-xl bg-white shadow">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Origen \ Destino</th>
              {(sectores ?? []).map((s) => (
                <th key={s.id} scope="col" className="text-center!">
                  {s.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(sectores ?? []).map((o) => (
              <tr key={o.id}>
                <th scope="row" className="bg-transparent! font-semibold! text-neutral-800!">
                  {o.nombre}
                </th>
                {(sectores ?? []).map((d) => {
                  const k = `${o.id}|${d.id}`;
                  return (
                    <td key={d.id} className="text-center">
                      <input type="hidden" name="visible" value={k} />
                      <input
                        type="checkbox"
                        name="ts"
                        value={k}
                        defaultChecked={permitidos.has(k)}
                        disabled={!editar}
                        aria-label={`De ${o.nombre} a ${d.nombre}`}
                        className="size-4 accent-marca"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {editar && (
          <div className="flex justify-end p-4">
            <BotonEnviar pendiente="Guardando…">Guardar</BotonEnviar>
          </div>
        )}
      </form>
    </section>
  );
}

async function ComposicionEstandar({ editar, ok, error }: { editar: boolean; ok?: string; error?: string }) {
  const supabase = await crearClienteServidor();
  const [{ data: productos }, { data: items }, { data: precio }] = await Promise.all([
    supabase.from("refrigerio_productos").select("id, nombre").eq("activo", true).order("orden").order("nombre"),
    supabase.from("refrigerio_estandar_items").select("producto_id, cantidad"),
    supabase.rpc("precios_refrigerio"),
  ]);
  const cantidades = new Map(((items ?? []) as { producto_id: string; cantidad: number }[]).map((i) => [i.producto_id, i.cantidad]));
  const precioEstandar = (precio as { estandar_precio?: number | null } | null)?.estandar_precio;
  return (
    <section className="max-w-2xl space-y-3">
      <Avisos ok={ok} error={error} />
      <p className="text-sm text-oliva">
        Cantidad de cada producto en <strong>un</strong> refrigerio estándar (0 = no lo incluye). Precio vigente del estándar:{" "}
        <strong>{precioEstandar != null ? `S/ ${Number(precioEstandar).toFixed(2)}` : "sin precio"}</strong> (se cambia en «Precio del estándar»).
      </p>
      <form action={guardarEstandar} className="overflow-x-auto rounded-xl bg-white shadow">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col" className="w-32">
                Cantidad
              </th>
            </tr>
          </thead>
          <tbody>
            {((productos ?? []) as { id: string; nombre: string }[]).map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>
                  <input
                    type="number"
                    name={`p:${p.id}`}
                    min={0}
                    max={100}
                    defaultValue={cantidades.get(p.id) ?? 0}
                    disabled={!editar}
                    aria-label={`Cantidad de ${p.nombre}`}
                    className="campo w-24 py-1!"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editar && (
          <div className="flex justify-end p-4">
            <BotonEnviar pendiente="Guardando…">Guardar composición</BotonEnviar>
          </div>
        )}
      </form>
    </section>
  );
}
