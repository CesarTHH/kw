import { NextResponse, type NextRequest } from "next/server";
import { permisoEnAccion } from "@/lib/auth";
import { esUuid } from "@/lib/busqueda";
import { aCsv } from "@/lib/csv";
import { crearClienteServidor } from "@/lib/supabase/servidor";

type Fila = { n: number; nivel: string; archivo: string; fila: number | null; columna: string | null; motivo: string };

// Lista de errores y advertencias de una simulación, para revisarla en Excel.
export async function GET(request: NextRequest) {
  if (!(await permisoEnAccion("admin.importador", "ver"))) return new NextResponse("No encontrado", { status: 404 });
  const id = request.nextUrl.searchParams.get("id");
  if (!esUuid(id)) return new NextResponse("No encontrado", { status: 404 });
  const supabase = await crearClienteServidor();
  const filas: Fila[] = [];
  for (let desde = 0; desde < 5000; desde += 1000) {
    const { data, error } = await supabase
      .from("importacion_problemas")
      .select("n, nivel, archivo, fila, columna, motivo")
      .eq("importacion_id", id)
      .order("n")
      .range(desde, desde + 999);
    if (error) return new NextResponse("Error al exportar", { status: 500 });
    filas.push(...((data ?? []) as Fila[]));
    if ((data ?? []).length < 1000) break;
  }
  const csv = aCsv(filas, [
    { titulo: "Tipo", valor: (x) => (x.nivel === "error" ? "Error" : "Advertencia") },
    { titulo: "Archivo", valor: (x) => x.archivo },
    { titulo: "Fila", valor: (x) => x.fila },
    { titulo: "Columna", valor: (x) => x.columna },
    { titulo: "Motivo", valor: (x) => x.motivo },
  ]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="importacion-${id.slice(0, 8)}-revision.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
