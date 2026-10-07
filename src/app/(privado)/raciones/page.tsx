import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { esUuid, urlCon } from "@/lib/busqueda";
import { hijos, puede } from "@/lib/permisos";
import { ddmm, diaNumero, fechaDeDia, lunes, sumarDias } from "@/lib/raciones/plazos";
import { empresaSeleccionada, horaOficial } from "@/lib/raciones/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Dashboard de raciones" };

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const soles = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });
const entero = new Intl.NumberFormat("es-PE");

type Fila = { fecha: string; comedor_id: string; servicio_id: string; cantidad: number };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requerirPermiso("raciones");
  const menu = await obtenerMenu();
  if (!puede(menu, "raciones.dashboard")) {
    const primera = hijos(menu, "raciones").find((m) => m.ruta && m.ruta !== "/raciones");
    redirect(primera?.ruta ?? "/menu");
  }
  const sp = await searchParams;
  const hoy = (await horaOficial()).slice(0, 10);
  const fecha = sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : hoy;
  const empresa = await empresaSeleccionada(ctx);
  const verCosto = ctx.alcance === "todas";

  const inicioMes = `${fecha.slice(0, 7)}-01`;
  const finMes = fechaDeDia(diaNumero(sumarDias(inicioMes, 32).slice(0, 7) + "-01") - 1);
  const inicioSemana = lunes(fecha);
  const finSemana = sumarDias(inicioSemana, 6);
  const desde = inicioSemana < inicioMes ? inicioSemana : inicioMes;
  const hasta = finSemana > finMes ? finSemana : finMes;

  const supabase = await crearClienteServidor();
  const [{ data: resumen }, { data: servicios }, { data: comedores }, tarifasR] = await Promise.all([
    supabase.rpc("resumen_raciones", { p_desde: desde, p_hasta: hasta, p_empresa: empresa?.id ?? null }),
    supabase.from("servicios").select("id, nombre, orden").order("orden"),
    supabase.from("comedores").select("id, nombre"),
    verCosto
      ? supabase.from("servicio_tarifas").select("servicio_id, precio").lte("vigente_desde", fecha).gte("vigente_hasta", fecha)
      : Promise.resolve({ data: [] }),
  ]);
  const filas = ((resumen ?? []) as Fila[]).map((f) => ({ ...f, cantidad: Number(f.cantidad) }));
  const nombreServicio = new Map(((servicios ?? []) as { id: string; nombre: string }[]).map((s) => [s.id, s.nombre]));
  const ordenServicio = new Map(((servicios ?? []) as { id: string; orden: number }[]).map((s) => [s.id, s.orden]));
  const nombreComedor = new Map(((comedores ?? []) as { id: string; nombre: string }[]).map((c) => [c.id, c.nombre]));
  const tarifa = new Map(((tarifasR.data ?? []) as { servicio_id: string; precio: number }[]).map((t) => [t.servicio_id, Number(t.precio)]));

  const delDia = filas.filter((f) => f.fecha === fecha);
  const porServicio = new Map<string, number>();
  for (const f of delDia) porServicio.set(f.servicio_id, (porServicio.get(f.servicio_id) ?? 0) + f.cantidad);
  const barras = [...porServicio.entries()].sort((a, b) => (ordenServicio.get(a[0]) ?? 0) - (ordenServicio.get(b[0]) ?? 0));
  const maximo = Math.max(1, ...barras.map(([, n]) => n));
  const totalDia = delDia.reduce((s, f) => s + f.cantidad, 0);
  const totalMes = filas.filter((f) => f.fecha >= inicioMes && f.fecha <= finMes).reduce((s, f) => s + f.cantidad, 0);
  const costoDia = delDia.reduce((s, f) => s + f.cantidad * (tarifa.get(f.servicio_id) ?? 0), 0);

  const servicioSel = esUuid(sp.servicio) && porServicio.has(sp.servicio) ? sp.servicio : barras.slice().sort((a, b) => b[1] - a[1])[0]?.[0];
  const porComedor = new Map<string, number>();
  for (const f of delDia.filter((x) => x.servicio_id === servicioSel)) porComedor.set(f.comedor_id, (porComedor.get(f.comedor_id) ?? 0) + f.cantidad);
  const tablaComedores = [...porComedor.entries()].sort((a, b) => b[1] - a[1]);

  const semana = Array.from({ length: 7 }, (_, i) => {
    const d = sumarDias(inicioSemana, i);
    return { fecha: d, total: filas.filter((f) => f.fecha === d).reduce((s, f) => s + f.cantidad, 0) };
  });
  const maxSemana = Math.max(1, ...semana.map((d) => d.total));

  const alcanceTexto =
    ctx.alcance === "comedor" ? "de tu comedor" : empresa ? `de ${empresa.nombre}` : ctx.alcance === "todas" ? "de todas las empresas" : "";

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="etiqueta">Fecha</span>
          <input type="date" name="fecha" defaultValue={fecha} className="campo" />
        </label>
        <button type="submit" className="btn-secundario">
          Ver
        </button>
        {fecha !== hoy && (
          <Link href="/raciones" className="text-sm text-oliva underline">
            Volver a hoy
          </Link>
        )}
        <p className="ml-auto text-sm text-gris-medio">Raciones vigentes {alcanceTexto}</p>
      </form>

      <section aria-label="Totales" className="grid gap-4 sm:grid-cols-3">
        <Indicador titulo={`Raciones del ${ddmm(fecha)}`} valor={entero.format(totalDia)} />
        <Indicador titulo={`Raciones de ${MESES[Number(fecha.slice(5, 7)) - 1]}`} valor={entero.format(totalMes)} />
        {verCosto && <Indicador titulo={`Costo estimado del ${ddmm(fecha)}`} valor={soles.format(costoDia)} nota="Según la tarifa vigente, sin IGV" />}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="rounded-xl bg-white p-5 shadow">
          <h2 className="font-semibold text-oliva">Raciones por servicio · {ddmm(fecha)}</h2>
          <p className="mb-4 text-xs text-gris-medio">Elige un servicio para ver el detalle por comedor.</p>
          {barras.length === 0 ? (
            <p className="py-8 text-center text-gris-medio">No hay raciones registradas para este día.</p>
          ) : (
            <ul className="space-y-2">
              {barras.map(([id, n]) => (
                <li key={id}>
                  <Link
                    href={urlCon("/raciones", { fecha: fecha === hoy ? undefined : fecha, servicio: id })}
                    aria-current={id === servicioSel ? "true" : undefined}
                    title={`${nombreServicio.get(id)}: ${entero.format(n)} raciones`}
                    className={`grid grid-cols-[10rem_1fr_4rem] items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-gris-claro ${
                      id === servicioSel ? "bg-gris-claro font-semibold" : ""
                    }`}
                  >
                    <span className="truncate">{nombreServicio.get(id) ?? "—"}</span>
                    <span className="h-4 rounded-r bg-gris-claro" aria-hidden>
                      <span className="block h-4 rounded-r bg-marca" style={{ width: `${Math.max(2, (n / maximo) * 100)}%` }} />
                    </span>
                    <span className="text-right tabular-nums">{entero.format(n)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl bg-white p-5 shadow">
          <h2 className="font-semibold text-oliva">{servicioSel ? nombreServicio.get(servicioSel) : "Detalle"} por comedor</h2>
          {tablaComedores.length === 0 ? (
            <p className="py-6 text-center text-sm text-gris-medio">Sin datos.</p>
          ) : (
            <table className="tabla mt-3">
              <thead>
                <tr>
                  <th scope="col">Comedor</th>
                  <th scope="col" className="text-right!">
                    Cant.
                  </th>
                </tr>
              </thead>
              <tbody>
                {tablaComedores.map(([id, n]) => (
                  <tr key={id}>
                    <td>{nombreComedor.get(id) ?? "—"}</td>
                    <td className="text-right tabular-nums">{entero.format(n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="rounded-xl bg-white p-5 shadow">
        <h2 className="mb-4 font-semibold text-oliva">
          Semana del {ddmm(inicioSemana)} al {ddmm(finSemana)}
        </h2>
        <ol className="grid h-48 grid-cols-7 items-end gap-3">
          {semana.map((d, i) => (
            <li key={d.fecha} className="flex h-full flex-col items-center justify-end gap-1">
              <span className="text-xs tabular-nums text-neutral-700">{d.total ? entero.format(d.total) : ""}</span>
              <Link
                href={urlCon("/raciones", { fecha: d.fecha })}
                title={`${DIAS[i]} ${ddmm(d.fecha)}: ${entero.format(d.total)} raciones`}
                className="flex w-full max-w-12 flex-1 items-end"
              >
                <span
                  className={`block w-full rounded-t ${d.fecha === fecha ? "bg-marca" : "bg-oliva-claro hover:bg-oliva"}`}
                  style={{ height: `${d.total ? Math.max(3, (d.total / maxSemana) * 100) : 0}%` }}
                />
              </Link>
              <span className={`text-xs ${d.fecha === fecha ? "font-semibold text-marca" : "text-gris-medio"}`}>
                {DIAS[i]} {ddmm(d.fecha)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
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
