import type { Metadata } from "next";
import Link from "next/link";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";
import { urlCon } from "@/lib/busqueda";
import { zonaHoraria } from "@/lib/contenido/servidor";
import { fechaHora } from "@/lib/fechas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Métricas de uso" };

const RUTA = "/admin/metricas";
const PERIODOS = [7, 30, 90] as const;
const entero = new Intl.NumberFormat("es-PE");
const TIPOS_ENVIO: Record<string, string> = {
  programacion: "Programación de raciones",
  adicion_reduccion: "Adiciones y reducciones",
  traslado: "Traslados",
  refrigerio: "Refrigerios",
};

type Dia = { fecha: string; usuarios: number; logins: number; envios: number };
type Metricas = {
  desde: string;
  hasta: string;
  por_dia: Dia[];
  por_semana: { semana: string; usuarios: number }[];
  totales: { usuarios_activos: number; logins: number; usuarios_registrados: number; empresas_activas: number };
  envios_por_tipo: Record<string, number>;
  empresas_sin_actividad: { ruc: string; nombre: string; ultimo_envio: string | null }[];
  errores: { en: string; origen: string; detalle: string | null }[];
  errores_total: number;
  correos_fallidos: number;
};

const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

export default async function Pagina({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const [ctx, { dias: d }] = await Promise.all([requerirPermiso("admin.metricas"), searchParams]);
  const dias = PERIODOS.find((p) => String(p) === d) ?? 30;
  const supabase = await crearClienteServidor();
  const [{ data, error }, zona] = await Promise.all([supabase.rpc("metricas_uso", { p_dias: dias }), zonaHoraria()]);
  const m = data as Metricas | null;

  return (
    <>
      <Encabezado titulo="Métricas de uso" ctx={ctx} />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6">
        <nav aria-label="Periodo" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gris-medio">Periodo:</span>
          {PERIODOS.map((p) => (
            <Link
              key={p}
              href={urlCon(RUTA, { dias: p === 30 ? undefined : p })}
              aria-current={p === dias ? "page" : undefined}
              className={`inline-flex min-h-10 items-center rounded-full px-4 font-semibold ${p === dias ? "bg-oliva text-white" : "bg-white text-oliva shadow hover:bg-gris-claro"}`}
            >
              Últimos {p} días
            </Link>
          ))}
        </nav>

        {error || !m ? (
          <p className="alerta-error">No se pudieron calcular las métricas. Inténtalo de nuevo.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador titulo="Usuarios activos" valor={entero.format(m.totales.usuarios_activos)} nota={`de ${entero.format(m.totales.usuarios_registrados)} con cuenta activa`} />
              <Indicador titulo="Inicios de sesión" valor={entero.format(m.totales.logins)} />
              <Indicador
                titulo="Envíos"
                valor={entero.format(Object.values(m.envios_por_tipo).reduce((a, b) => a + b, 0))}
                nota="raciones y refrigerios"
              />
              <Indicador
                titulo="Errores"
                valor={entero.format(m.errores_total)}
                nota={`${entero.format(m.correos_fallidos)} correos no enviados`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Barras titulo="Usuarios activos por día" datos={m.por_dia.map((x) => ({ etiqueta: ddmm(x.fecha), valor: x.usuarios }))} unidad="usuarios" />
              <Barras titulo="Inicios de sesión por día" datos={m.por_dia.map((x) => ({ etiqueta: ddmm(x.fecha), valor: x.logins }))} unidad="inicios" />
              <Barras titulo="Envíos por día" datos={m.por_dia.map((x) => ({ etiqueta: ddmm(x.fecha), valor: x.envios }))} unidad="envíos" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl bg-white p-5 shadow">
                <h2 className="font-semibold text-oliva">Usuarios activos por semana</h2>
                <Lista
                  filas={m.por_semana.map((s) => ({ etiqueta: `Semana del ${ddmm(s.semana.slice(0, 10))}`, valor: s.usuarios }))}
                  vacio="Sin actividad."
                />
              </section>
              <section className="rounded-xl bg-white p-5 shadow">
                <h2 className="font-semibold text-oliva">Envíos por módulo</h2>
                <Lista
                  filas={Object.entries(TIPOS_ENVIO).map(([k, t]) => ({ etiqueta: t, valor: m.envios_por_tipo[k] ?? 0 }))}
                  vacio="Sin envíos en el periodo."
                />
              </section>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl bg-white p-5 shadow">
                <h2 className="font-semibold text-oliva">
                  Empresas sin actividad <span className="text-sm font-normal text-gris-medio">({m.empresas_sin_actividad.length})</span>
                </h2>
                {m.empresas_sin_actividad.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gris-medio">Todas las empresas activas enviaron algo en el periodo.</p>
                ) : (
                  <div className="mt-3 max-h-96 overflow-auto">
                    <table className="tabla">
                      <thead>
                        <tr>
                          <th scope="col">Empresa</th>
                          <th scope="col">RUC</th>
                          <th scope="col">Último envío</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.empresas_sin_actividad.map((e) => (
                          <tr key={e.ruc}>
                            <td>{e.nombre}</td>
                            <td className="tabular-nums">{e.ruc}</td>
                            <td className="whitespace-nowrap">{e.ultimo_envio ? fechaHora(e.ultimo_envio, zona).slice(0, 10) : "Nunca"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="rounded-xl bg-white p-5 shadow">
                <h2 className="font-semibold text-oliva">Errores recientes</h2>
                {m.errores.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gris-medio">Sin errores en el periodo.</p>
                ) : (
                  <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto text-sm">
                    {m.errores.map((e, i) => (
                      <li key={i} className="rounded border border-gris-medio/30 p-2">
                        <p className="text-xs text-gris-medio">
                          {fechaHora(e.en, zona)} · {e.origen}
                        </p>
                        {e.detalle && <p className="break-words">{e.detalle}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                {m.correos_fallidos > 0 && (
                  <p className="mt-3 text-sm">
                    {entero.format(m.correos_fallidos)} correos no se pudieron enviar.{" "}
                    <Link href="/admin/correos?est=fallido" className="text-oliva underline">
                      Ver en el historial de correos
                    </Link>
                  </p>
                )}
              </section>
            </div>
            <p className="text-xs text-gris-medio">
              El tiempo de respuesta de las páginas se medirá con las métricas de Google Cloud Run cuando la aplicación esté
              publicada (Fase 8).
            </p>
          </>
        )}
      </main>
    </>
  );
}

function Indicador({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl bg-white p-5 shadow">
      <p className="text-sm text-gris-medio">{titulo}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-oliva">{valor}</p>
      {nota && <p className="mt-1 text-xs text-gris-medio">{nota}</p>}
    </div>
  );
}

/** Barras verticales simples de una sola serie; el detalle de cada barra aparece al pasar el cursor. */
function Barras({ titulo, datos, unidad }: { titulo: string; datos: { etiqueta: string; valor: number }[]; unidad: string }) {
  const mayor = Math.max(0, ...datos.map((d) => d.valor));
  const maximo = Math.max(1, mayor);
  const marcas = datos.length <= 10 ? 1 : Math.ceil(datos.length / 6);
  return (
    <section className="rounded-xl bg-white p-5 shadow">
      <h2 className="font-semibold text-oliva">{titulo}</h2>
      <p className="text-xs text-gris-medio">
        Máximo {entero.format(mayor)} en un día
      </p>
      <ol className="mt-3 flex h-40 items-end gap-0.5 border-b border-gris-medio/40" aria-label={titulo}>
        {datos.map((d) => (
          <li key={d.etiqueta} className="group flex h-full flex-1 items-end" title={`${d.etiqueta}: ${entero.format(d.valor)} ${unidad}`}>
            <span
              className="block w-full rounded-t-sm bg-marca group-hover:bg-oliva"
              style={{ height: `${d.valor ? Math.max(2, (d.valor / maximo) * 100) : 0}%` }}
            />
            <span className="sr-only">
              {d.etiqueta}: {d.valor} {unidad}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-1 flex justify-between text-[10px] text-gris-medio" aria-hidden>
        {datos
          .filter((_, i) => i % marcas === 0)
          .map((d) => (
            <span key={d.etiqueta}>{d.etiqueta}</span>
          ))}
      </div>
    </section>
  );
}

function Lista({ filas, vacio }: { filas: { etiqueta: string; valor: number }[]; vacio: string }) {
  const maximo = Math.max(1, ...filas.map((f) => f.valor));
  if (!filas.some((f) => f.valor > 0)) return <p className="py-6 text-center text-sm text-gris-medio">{vacio}</p>;
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {filas.map((f) => (
        <li key={f.etiqueta} className="grid grid-cols-[minmax(0,8rem)_1fr_3rem] items-center gap-2 sm:grid-cols-[11rem_1fr_3.5rem]">
          <span className="truncate">{f.etiqueta}</span>
          <span className="h-4 rounded-r bg-gris-claro" aria-hidden>
            <span className="block h-4 rounded-r bg-marca" style={{ width: `${f.valor ? Math.max(2, (f.valor / maximo) * 100) : 0}%` }} />
          </span>
          <span className="text-right tabular-nums">{entero.format(f.valor)}</span>
        </li>
      ))}
    </ul>
  );
}
