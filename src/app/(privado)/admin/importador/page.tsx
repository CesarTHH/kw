import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { Encabezado } from "@/components/Encabezado";
import { EjecutarImportacion, SubirArchivos } from "@/components/importador/Importador";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { zonaHoraria } from "@/lib/contenido/servidor";
import { fechaHora } from "@/lib/fechas";
import { puede } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Importar Excel" };

const RUTA = "/admin/importador";
const entero = new Intl.NumberFormat("es-PE");

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  subido: { texto: "Subido", clase: "bg-neutral-200 text-neutral-700" },
  analizado: { texto: "Simulado", clase: "bg-sky-100 text-sky-800" },
  importando: { texto: "En curso", clase: "bg-amber-100 text-amber-800" },
  importado: { texto: "Importado", clase: "bg-green-100 text-green-800" },
  fallido: { texto: "Interrumpido", clase: "bg-red-100 text-red-800" },
};

const ENTIDADES: [string, string][] = [
  ["proyectos", "Proyectos"],
  ["areas", "Áreas"],
  ["frentes", "Frentes de trabajo"],
  ["empresas", "Empresas"],
  ["contactos", "Contactos"],
  ["comedores", "Comedores"],
  ["servicios", "Servicios"],
  ["tarifas", "Tarifas"],
  ["comedor_servicios", "Servicios por comedor"],
  ["empresa_frentes", "Frentes por empresa"],
  ["envios", "Envíos históricos"],
  ["movimientos", "Movimientos de raciones"],
];

type Importacion = {
  id: string;
  created_at: string;
  estado: string;
  archivos: { nombre: string; tamano: number; tipo?: string }[];
  resumen: Record<string, { nuevos: number; existentes: number } | number> | null;
  errores: number;
  advertencias: number;
  lotes_total: number;
  lotes_hechos: number;
  meses: string[];
  meses_hechos: number;
  resultado: { catalogos?: Record<string, number>; saldos_negativos?: number; error?: string } | null;
  terminado_en: string | null;
};
type Problema = { n: number; nivel: string; archivo: string; fila: number | null; columna: string | null; motivo: string };

function Estado({ estado }: { estado: string }) {
  const e = ESTADOS[estado] ?? { texto: estado, clase: "bg-neutral-200 text-neutral-700" };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${e.clase}`}>{e.texto}</span>;
}

export default async function Pagina({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const ctx = await requerirPermiso("admin.importador");
  const enviar = puede(await obtenerMenu(), "admin.importador", "enviar") && ctx.alcance === "todas";
  const { id: idSp } = await searchParams;
  const id = esUuid(idSp) ? idSp : undefined;
  const supabase = await crearClienteServidor();
  const columnas = "id, created_at, estado, archivos, resumen, errores, advertencias, lotes_total, lotes_hechos, meses, meses_hechos, resultado, terminado_en";
  const [{ data: lista }, detalleR, problemasR, zona] = await Promise.all([
    supabase.from("importaciones").select(columnas).order("created_at", { ascending: false }).limit(20),
    id ? supabase.from("importaciones").select(columnas).eq("id", id).maybeSingle() : Promise.resolve({ data: null }),
    id
      ? supabase.from("importacion_problemas").select("n, nivel, archivo, fila, columna, motivo").eq("importacion_id", id).order("nivel").order("n").limit(200)
      : Promise.resolve({ data: [] }),
    zonaHoraria(),
  ]);
  const importaciones = (lista ?? []) as Importacion[];
  const d = detalleR.data as Importacion | null;
  const problemas = (problemasR.data ?? []) as Problema[];

  return (
    <>
      <Encabezado titulo="Importar Excel" ctx={ctx} />
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          {enviar ? <SubirArchivos /> : <p className="panel text-sm">Solo el Superadmin puede importar.</p>}
          <section className="rounded-xl bg-white p-4 shadow">
            <h2 className="mb-2 font-semibold text-oliva">Importaciones</h2>
            {importaciones.length === 0 ? (
              <p className="text-sm text-gris-medio">Todavía no hay importaciones.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {importaciones.map((i) => (
                  <li key={i.id}>
                    <Link
                      href={`${RUTA}?id=${i.id}`}
                      aria-current={i.id === id ? "page" : undefined}
                      className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-gris-claro ${i.id === id ? "bg-gris-claro" : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="block">{fechaHora(i.created_at, zona)}</span>
                        <span className="block truncate text-xs text-gris-medio">{i.archivos.map((a) => a.nombre).join(", ")}</span>
                      </span>
                      <Estado estado={i.estado} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="min-w-0 space-y-4">
          {!d ? (
            <div className="panel space-y-2 text-sm">
              <h2 className="text-lg font-semibold text-oliva">Cómo funciona</h2>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Sube los archivos (puedes subir solo los maestros, solo el historial o todos).</li>
                <li>Revisa la simulación: cuántos registros se crearán y la lista de errores y advertencias.</li>
                <li>Pulsa <strong>Importar</strong>. Se carga por partes con una barra de avance; si se corta, puedes continuar.</li>
              </ol>
              <p>Volver a importar el mismo archivo no duplica nada. La importación no envía correos a las empresas.</p>
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-white p-5 shadow">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-oliva">Importación del {fechaHora(d.created_at, zona)}</h2>
                  <Estado estado={d.estado} />
                </div>
                <p className="mt-1 text-sm text-gris-medio">{d.archivos.map((a) => a.nombre).join(" · ")}</p>
                {d.estado === "subido" && (
                  <p className="mt-3 alerta-error">La simulación no terminó. Vuelve a subir los archivos.</p>
                )}
                {d.resultado?.error && d.estado === "fallido" && <p className="mt-3 alerta-error">{d.resultado.error}</p>}
                {d.estado === "importado" && (
                  <p className="mt-3 alerta-ok">
                    Importación terminada{d.terminado_en ? ` el ${fechaHora(d.terminado_en, zona)}` : ""}.
                    {(d.resultado?.saldos_negativos ?? 0) > 0 &&
                      ` ${entero.format(d.resultado!.saldos_negativos!)} saldos daban menos de 0 y quedaron en 0.`}
                  </p>
                )}
                {d.estado === "importando" && (
                  <p className="mt-3 text-sm">
                    Avance: lotes {entero.format(d.lotes_hechos)} de {entero.format(d.lotes_total)} · saldos {d.meses_hechos} de {d.meses.length} meses.
                  </p>
                )}
              </div>

              {d.resumen && (
                <div className="overflow-x-auto rounded-xl shadow">
                  <table className="tabla">
                    <caption className="bg-white px-3 py-2 text-left font-semibold text-oliva">
                      {d.estado === "importado" ? "Resultado de la simulación" : "Simulación: qué se va a cargar"}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Datos</th>
                        <th scope="col" className="text-right!">
                          Nuevos
                        </th>
                        <th scope="col" className="text-right!">
                          Ya existen (se actualizan o se omiten)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ENTIDADES.filter(([k]) => d.resumen![k] !== undefined).map(([k, t]) => {
                        const v = d.resumen![k]!;
                        const nuevos = typeof v === "number" ? v : v.nuevos;
                        const existentes = typeof v === "number" ? null : v.existentes;
                        return (
                          <tr key={k}>
                            <td>{t}</td>
                            <td className="text-right tabular-nums">{entero.format(nuevos)}</td>
                            <td className="text-right tabular-nums">{existentes === null ? "—" : entero.format(existentes)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {typeof d.resumen.filas_historial === "number" && (
                    <p className="bg-white px-3 py-2 text-xs text-gris-medio">
                      {entero.format(d.resumen.filas_historial)} filas leídas del historial
                      {typeof d.resumen.filas_editadas === "number" && d.resumen.filas_editadas > 0
                        ? ` (${entero.format(d.resumen.filas_editadas)} se editaron en SharePoint después de crearse)`
                        : ""}
                      .
                    </p>
                  )}
                </div>
              )}

              {(d.errores > 0 || d.advertencias > 0) && (
                <div className="rounded-xl bg-white p-5 shadow">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-oliva">
                      {entero.format(d.errores)} errores · {entero.format(d.advertencias)} advertencias
                    </h3>
                    <a href={`${RUTA}/problemas?id=${d.id}`} className="btn-secundario inline-flex items-center gap-1">
                      <Download className="size-4" aria-hidden /> Descargar la lista
                    </a>
                  </div>
                  <p className="mt-1 text-xs text-gris-medio">
                    Las filas con error no se importan. Las advertencias se importan con el ajuste indicado.
                    {problemas.length < d.errores + d.advertencias ? " Aquí se muestran las primeras 200." : ""}
                  </p>
                  <div className="mt-3 max-h-96 overflow-auto">
                    <table className="tabla text-xs">
                      <thead>
                        <tr>
                          <th scope="col">Tipo</th>
                          <th scope="col">Archivo</th>
                          <th scope="col">Fila</th>
                          <th scope="col">Columna</th>
                          <th scope="col">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {problemas.map((p) => (
                          <tr key={p.n}>
                            <td className={p.nivel === "error" ? "font-semibold text-red-800" : "text-amber-800"}>
                              {p.nivel === "error" ? "Error" : "Advertencia"}
                            </td>
                            <td className="max-w-40 truncate" title={p.archivo}>
                              {p.archivo}
                            </td>
                            <td className="tabular-nums">{p.fila ?? "—"}</td>
                            <td>{p.columna ?? "—"}</td>
                            <td>{p.motivo}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {enviar && ["analizado", "importando", "fallido"].includes(d.estado) && (
                <div className="rounded-xl bg-white p-5 shadow">
                  <h3 className="mb-2 font-semibold text-oliva">Importar</h3>
                  <p className="mb-3 text-sm">
                    Se cargan primero las tablas maestras y después el historial en {entero.format(d.lotes_total)} partes; al final se
                    recalculan los saldos. No cierres la página mientras avanza.
                  </p>
                  <EjecutarImportacion id={d.id} estado={d.estado} errores={d.errores} />
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
