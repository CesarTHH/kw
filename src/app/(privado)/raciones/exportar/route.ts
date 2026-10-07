import { NextResponse, type NextRequest } from "next/server";
import { obtenerContexto, permisoEnAccion } from "@/lib/auth";
import { aCsv } from "@/lib/csv";
import { aplicarFiltros, leerFiltros, selectMovimientos, selectSaldos, TIPOS_MOVIMIENTO, type FilaConsulta } from "@/lib/raciones/consulta";
import { empresaSeleccionada, horaOficial } from "@/lib/raciones/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";

// Exportación de la consulta detallada (mismos filtros y misma seguridad que la pantalla).
export async function GET(request: NextRequest) {
  if (!(await permisoEnAccion("raciones.consulta", "exportar"))) return new NextResponse("No encontrado", { status: 404 });
  const ctx = await obtenerContexto();
  if (!ctx) return new NextResponse("No encontrado", { status: 404 });
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const f = leerFiltros(sp, (await horaOficial()).slice(0, 10));
  const empresa = await empresaSeleccionada(ctx);
  const supabase = await crearClienteServidor();
  const movimientos = f.vista === "movimientos";
  const empresaId = empresa?.id ?? null;
  const { data, error } = movimientos
    ? await aplicarFiltros(supabase.from("racion_movimientos").select(selectMovimientos(f)).order("fecha").order("id"), f, empresaId).limit(50_000)
    : await aplicarFiltros(supabase.from("racion_saldos").select(selectSaldos(f)).gt("cantidad", 0).order("fecha"), f, empresaId).limit(50_000);
  if (error) return new NextResponse("Error al exportar", { status: 500 });

  const filas = (data ?? []) as unknown as FilaConsulta[];
  const csv = aCsv(filas, [
    { titulo: "Fecha", valor: (x) => `${x.fecha.slice(8, 10)}/${x.fecha.slice(5, 7)}/${x.fecha.slice(0, 4)}` },
    { titulo: "RUC", valor: (x) => x.empresas?.ruc },
    { titulo: "Empresa", valor: (x) => x.empresas?.nombre_corto },
    { titulo: "Proyecto", valor: (x) => x.frentes_trabajo?.proyectos?.nombre },
    { titulo: "Área", valor: (x) => x.frentes_trabajo?.areas?.nombre },
    { titulo: "Frente Trabajo", valor: (x) => x.frentes_trabajo?.nombre },
    { titulo: "Comedor", valor: (x) => x.comedores?.nombre },
    { titulo: "Servicio", valor: (x) => x.servicios?.nombre },
    ...(movimientos
      ? [
          { titulo: "Movimiento", valor: (x: FilaConsulta) => TIPOS_MOVIMIENTO[x.tipo_movimiento ?? ""] ?? x.tipo_movimiento },
          { titulo: "Enviado", valor: (x: FilaConsulta) => x.envios?.enviado_en },
          { titulo: "Fuera de plazo", valor: (x: FilaConsulta) => x.envios?.fuera_de_plazo },
        ]
      : []),
    { titulo: "Cantidad", valor: (x) => x.cantidad },
  ]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="raciones-${f.desde}-a-${f.hasta}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
