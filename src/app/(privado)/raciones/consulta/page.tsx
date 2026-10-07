import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { Paginacion } from "@/components/maestras/Paginacion";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { numeroPagina, rango, urlCon } from "@/lib/busqueda";
import { puede } from "@/lib/permisos";
import { aplicarFiltros, leerFiltros, SELECT_MOVIMIENTOS, SELECT_SALDOS, TIPOS_MOVIMIENTO, type FilaConsulta } from "@/lib/raciones/consulta";
import { cargarCatalogo, empresaSeleccionada, horaOficial } from "@/lib/raciones/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Consulta detallada de raciones" };

const RUTA = "/raciones/consulta";
const TAMANO = 50;
const fechaHora = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: "America/Lima" });
const ddmmaaaa = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

export default async function Consulta({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requerirPermiso("raciones.consulta");
  const exportar = puede(await obtenerMenu(), "raciones.consulta", "exportar");
  const sp = await searchParams;
  const hoy = (await horaOficial()).slice(0, 10);
  const f = leerFiltros(sp, hoy);
  const p = numeroPagina(sp.p);
  const empresa = await empresaSeleccionada(ctx);
  const verEmpresa = ctx.alcance !== "empresa" && !empresa;

  const supabase = await crearClienteServidor();
  const movimientos = f.vista === "movimientos";
  const [ini, fin] = rango(p, TAMANO);
  const consulta = async (): Promise<{ data: unknown; count: number | null }> => {
    const empresaId = empresa?.id ?? null;
    if (movimientos) {
      const q = supabase.from("racion_movimientos").select(SELECT_MOVIMIENTOS, { count: "exact" }).order("fecha").order("id");
      const { data, count } = await aplicarFiltros(q, f, empresaId).range(ini, fin);
      return { data, count };
    }
    const q = supabase.from("racion_saldos").select(SELECT_SALDOS, { count: "exact" }).gt("cantidad", 0).order("fecha").order("comedor_id");
    const { data, count } = await aplicarFiltros(q, f, empresaId).range(ini, fin);
    return { data, count };
  };
  const [{ data, count }, catalogo, proyectosR, areasR] = await Promise.all([
    consulta(),
    cargarCatalogo(empresa?.id ?? null),
    supabase.from("proyectos").select("id, nombre").order("nombre"),
    supabase.from("areas").select("id, nombre").order("nombre"),
  ]);
  const filas = (data ?? []) as unknown as FilaConsulta[];
  const proyectos = (proyectosR.data ?? []) as { id: string; nombre: string }[];
  const areas = (areasR.data ?? []) as { id: string; nombre: string }[];
  const params = {
    desde: f.desde,
    hasta: f.hasta,
    proyecto: f.proyecto,
    area: f.area,
    frente: f.frente,
    comedor: f.comedor,
    servicio: f.servicio,
    vista: movimientos ? "movimientos" : undefined,
  };
  const total = filas.reduce((s, x) => s + x.cantidad, 0);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-6">
      <details open className="rounded-xl bg-white p-4 shadow">
        <summary className="cursor-pointer font-semibold text-oliva">Filtros</summary>
        <form method="get" action={RUTA} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="etiqueta">Desde</span>
            <input type="date" name="desde" defaultValue={f.desde} className="campo" />
          </label>
          <label className="block">
            <span className="etiqueta">Hasta</span>
            <input type="date" name="hasta" defaultValue={f.hasta} className="campo" />
          </label>
          <Select nombre="proyecto" etiqueta="Proyecto" valor={f.proyecto} opciones={proyectos} />
          <Select nombre="area" etiqueta="Área" valor={f.area} opciones={areas} />
          {catalogo.frentes.length > 0 && (
            <Select nombre="frente" etiqueta="Frente de trabajo" valor={f.frente} opciones={catalogo.frentes} />
          )}
          <Select nombre="comedor" etiqueta="Comedor" valor={f.comedor} opciones={catalogo.comedores} />
          <Select nombre="servicio" etiqueta="Servicio" valor={f.servicio} opciones={catalogo.servicios} />
          <label className="block">
            <span className="etiqueta">Ver</span>
            <select name="vista" defaultValue={f.vista} className="campo">
              <option value="saldos">Raciones vigentes</option>
              <option value="movimientos">Movimientos (programado, + / −, traslados)</option>
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className="btn-marca">
              Buscar
            </button>
            <Link href={RUTA} className="btn-secundario">
              Limpiar
            </Link>
            {exportar && (
              <a href={urlCon("/raciones/exportar", params)} className="btn-secundario ml-auto">
                <Download className="size-4" aria-hidden /> Excel
              </a>
            )}
          </div>
        </form>
        <p className="mt-2 text-xs text-gris-medio">Rango máximo: 92 días.</p>
      </details>

      <div className="overflow-x-auto rounded-xl shadow">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              {verEmpresa && <th scope="col">Empresa</th>}
              <th scope="col">Proyecto</th>
              <th scope="col">Área</th>
              <th scope="col">Frente trabajo</th>
              <th scope="col">Comedor</th>
              <th scope="col">Servicio</th>
              {movimientos && <th scope="col">Movimiento</th>}
              <th scope="col" className="text-right!">
                Cant.
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((x, i) => (
              <tr key={`${x.id ?? i}-${x.fecha}`}>
                <td className="whitespace-nowrap">{ddmmaaaa(x.fecha)}</td>
                {verEmpresa && <td>{x.empresas?.nombre_corto}</td>}
                <td>{x.frentes_trabajo?.proyectos?.nombre}</td>
                <td>{x.frentes_trabajo?.areas?.nombre}</td>
                <td>{x.frentes_trabajo?.nombre}</td>
                <td>{x.comedores?.nombre}</td>
                <td>{x.servicios?.nombre}</td>
                {movimientos && (
                  <td>
                    {TIPOS_MOVIMIENTO[x.tipo_movimiento ?? ""] ?? x.tipo_movimiento}
                    {x.envios && <span className="block text-xs text-gris-medio">{fechaHora.format(new Date(x.envios.enviado_en))}</span>}
                    {x.envios?.fuera_de_plazo && <span className="block text-xs text-red-800">Fuera de plazo</span>}
                  </td>
                )}
                <td className={`text-right tabular-nums ${x.cantidad < 0 ? "text-red-800" : ""}`}>{x.cantidad}</td>
              </tr>
            ))}
            {!filas.length && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-gris-medio">
                  No hay raciones con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
          {filas.length > 0 && !movimientos && (
            <tfoot>
              <tr>
                <td colSpan={verEmpresa ? 7 : 6} className="text-right font-semibold">
                  Total de esta página
                </td>
                <td className="text-right font-semibold tabular-nums">{total}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <Paginacion base={RUTA} params={params} pagina={p} total={count ?? 0} tamano={TAMANO} />
    </main>
  );
}

function Select({
  nombre,
  etiqueta,
  valor,
  opciones,
}: {
  nombre: string;
  etiqueta: string;
  valor?: string;
  opciones: { id: string; nombre: string }[];
}) {
  return (
    <label className="block">
      <span className="etiqueta">{etiqueta}</span>
      <select name={nombre} defaultValue={valor ?? ""} className="campo">
        <option value="">Todos</option>
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}
