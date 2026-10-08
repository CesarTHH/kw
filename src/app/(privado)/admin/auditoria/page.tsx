import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { Encabezado } from "@/components/Encabezado";
import { Paginacion } from "@/components/maestras/Paginacion";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import {
  diferencias,
  leerFiltrosAuditoria,
  nombreAccion,
  nombreModulo,
  paramsAuditoria,
  textoValor,
} from "@/lib/auditoria";
import { numeroPagina, rango, urlCon } from "@/lib/busqueda";
import { zonaHoraria } from "@/lib/contenido/servidor";
import { fechaHora } from "@/lib/fechas";
import { puede } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { COLUMNAS_LISTA, consultaAuditoria, nombres, type FilaAuditoria } from "./consulta";

export const metadata: Metadata = { title: "Auditoría" };

const RUTA = "/admin/auditoria";

type Detalle = FilaAuditoria & {
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  detalle: Record<string, unknown> | null;
};

export default async function Pagina({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requerirPermiso("admin.auditoria");
  const exportar = puede(await obtenerMenu(), "admin.auditoria", "exportar");
  const sp = await searchParams;
  const f = leerFiltrosAuditoria(sp);
  const p = numeroPagina(sp.p);
  const idDetalle = sp.id && /^\d{1,18}$/.test(sp.id) ? sp.id : undefined;
  const lista = paramsAuditoria(f);

  const supabase = await crearClienteServidor();
  const consulta = await consultaAuditoria(supabase, f, COLUMNAS_LISTA, { count: "exact" });
  const [ini, fin] = rango(p, 50);
  const [resultado, tiposR, detalleR, zona] = await Promise.all([
    consulta ? consulta.range(ini, fin) : Promise.resolve({ data: [], count: 0 }),
    supabase.rpc("auditoria_tipos"),
    idDetalle ? supabase.from("auditoria").select("*").eq("id", idDetalle).maybeSingle() : Promise.resolve({ data: null }),
    zonaHoraria(),
  ]);
  const filas = (resultado.data ?? []) as unknown as FilaAuditoria[];
  const total = resultado.count ?? 0;
  const tipos = (tiposR.data ?? []) as { modulo: string; accion: string }[];
  const modulos = [...new Set(tipos.map((t) => t.modulo))].sort((a, b) => nombreModulo(a).localeCompare(nombreModulo(b)));
  const acciones = [...new Set(tipos.filter((t) => !f.modulo || t.modulo === f.modulo).map((t) => t.accion))].sort();
  const detalle = detalleR.data as Detalle | null;
  const { usuarios, empresas } = await nombres(supabase, detalle ? [...filas, detalle] : filas);

  const quien = (id: string | null) => (id ? (usuarios.get(id)?.nombre ?? "Usuario eliminado") : "Sistema");
  const empresa = (id: string | null) => (id ? (empresas.get(id)?.nombre_corto ?? "—") : "—");

  return (
    <>
      <Encabezado titulo="Auditoría" ctx={ctx} />
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 xl:grid-cols-[1fr_30rem]">
        <section className="min-w-0 space-y-3">
          <form action={RUTA} method="get" role="search" className="grid gap-2 rounded-xl bg-white p-3 shadow sm:grid-cols-3">
            <label className="block">
              <span className="etiqueta">Usuario (nombre o correo)</span>
              <input name="u" defaultValue={f.usuario} maxLength={60} className="campo" />
            </label>
            <label className="block">
              <span className="etiqueta">Empresa o RUC</span>
              <input name="e" defaultValue={f.empresa} maxLength={60} className="campo" />
            </label>
            <label className="block">
              <span className="etiqueta">Módulo</span>
              <select name="m" defaultValue={f.modulo ?? ""} className="campo">
                <option value="">Todos</option>
                {modulos.map((m) => (
                  <option key={m} value={m}>
                    {nombreModulo(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="etiqueta">Acción</span>
              <select name="a" defaultValue={f.accion ?? ""} className="campo">
                <option value="">Todas</option>
                {acciones.map((a) => (
                  <option key={a} value={a}>
                    {nombreAccion(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="etiqueta">Desde</span>
              <input type="date" name="desde" defaultValue={f.desde} className="campo" />
            </label>
            <label className="block">
              <span className="etiqueta">Hasta</span>
              <input type="date" name="hasta" defaultValue={f.hasta} className="campo" />
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-3">
              <Link href={RUTA} className="text-sm text-oliva underline">
                Limpiar filtros
              </Link>
              {exportar && (
                <a href={urlCon(`${RUTA}/exportar`, lista)} className="btn-secundario inline-flex items-center gap-1">
                  <Download className="size-4" aria-hidden /> Exportar
                </a>
              )}
              <button type="submit" className="btn-marca">
                Buscar
              </button>
            </div>
          </form>

          <div className="overflow-x-auto rounded-xl shadow">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Fecha y hora</th>
                  <th scope="col">Usuario</th>
                  <th scope="col" className="hidden md:table-cell">Empresa</th>
                  <th scope="col">Módulo</th>
                  <th scope="col">Acción</th>
                  <th scope="col" className="hidden lg:table-cell">Registro</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((a) => (
                  <tr key={a.id} className={String(a.id) === idDetalle ? "outline-2 -outline-offset-2 outline-marca" : undefined}>
                    <td className="whitespace-nowrap">
                      <Link href={urlCon(RUTA, { ...lista, p: String(p), id: String(a.id) })} className="font-medium text-oliva hover:underline">
                        {fechaHora(a.en, zona)}
                      </Link>
                    </td>
                    <td>{quien(a.usuario_id)}</td>
                    <td className="hidden md:table-cell">{empresa(a.empresa_id)}</td>
                    <td>{nombreModulo(a.modulo)}</td>
                    <td>{nombreAccion(a.accion)}</td>
                    <td className="hidden max-w-48 truncate text-xs text-gris-medio lg:table-cell" title={a.entidad_id ?? undefined}>
                      {a.entidad ?? ""}
                    </td>
                  </tr>
                ))}
                {!filas.length && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gris-medio">
                      No hay registros que coincidan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Paginacion base={RUTA} params={lista} pagina={p} total={total} tamano={50} />
        </section>

        <aside className="space-y-4">
          {!idDetalle && (
            <p className="panel text-sm text-oliva">
              Elige un registro para ver qué cambió. Aquí queda todo lo que se crea, modifica o envía, los inicios de sesión y
              los cambios de configuración y permisos.
            </p>
          )}
          {idDetalle && !detalle && <p className="alerta-error">El registro no existe.</p>}
          {detalle && <DetalleAuditoria d={detalle} quien={quien(detalle.usuario_id)} empresa={empresa(detalle.empresa_id)} zona={zona} />}
        </aside>
      </main>
    </>
  );
}

function DetalleAuditoria({ d, quien, empresa, zona }: { d: Detalle; quien: string; empresa: string; zona: string }) {
  const cambios = diferencias(d.antes, d.despues);
  const tipo = d.antes && d.despues ? "cambio" : d.despues ? "nuevo" : d.antes ? "borrado" : "evento";
  return (
    <section className="panel space-y-3 text-sm">
      <h2 className="text-base font-semibold text-oliva">
        {nombreModulo(d.modulo)} · {nombreAccion(d.accion)}
      </h2>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
        <dt className="text-gris-medio">Fecha</dt>
        <dd>{fechaHora(d.en, zona)}</dd>
        <dt className="text-gris-medio">Usuario</dt>
        <dd>{quien}</dd>
        <dt className="text-gris-medio">Empresa</dt>
        <dd>{empresa}</dd>
        {d.entidad && (
          <>
            <dt className="text-gris-medio">Registro</dt>
            <dd className="break-all">
              {d.entidad} {d.entidad_id ? `· ${d.entidad_id}` : ""}
            </dd>
          </>
        )}
        {d.ip && (
          <>
            <dt className="text-gris-medio">IP</dt>
            <dd>{d.ip}</dd>
          </>
        )}
      </dl>
      {tipo !== "evento" && (
        <div className="overflow-x-auto">
          <table className="tabla text-xs">
            <caption className="mb-1 text-left font-semibold text-oliva">
              {tipo === "cambio" ? "Campos que cambiaron" : tipo === "nuevo" ? "Datos creados" : "Datos eliminados"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Campo</th>
                {tipo !== "nuevo" && <th scope="col">Antes</th>}
                {tipo !== "borrado" && <th scope="col">Después</th>}
              </tr>
            </thead>
            <tbody>
              {cambios.map((c) => (
                <tr key={c.campo}>
                  <td className="font-medium">{c.campo}</td>
                  {tipo !== "nuevo" && <td className="max-w-48 break-words">{textoValor(c.antes)}</td>}
                  {tipo !== "borrado" && <td className="max-w-48 break-words">{textoValor(c.despues)}</td>}
                </tr>
              ))}
              {!cambios.length && (
                <tr>
                  <td colSpan={3} className="text-gris-medio">
                    Sin cambios visibles.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {d.detalle && (
        <div>
          <p className="etiqueta">Detalle</p>
          <pre className="max-h-64 overflow-auto rounded bg-gris-panel p-2 text-xs whitespace-pre-wrap">{JSON.stringify(d.detalle, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
