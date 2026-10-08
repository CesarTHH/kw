import { NextResponse, type NextRequest } from "next/server";
import { permisoEnAccion } from "@/lib/auth";
import { leerFiltrosAuditoria, nombreAccion, nombreModulo } from "@/lib/auditoria";
import { zonaHoraria } from "@/lib/contenido/servidor";
import { aCsv } from "@/lib/csv";
import { fechaHora } from "@/lib/fechas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { consultaAuditoria, nombres } from "../consulta";

type Fila = {
  id: number;
  en: string;
  usuario_id: string | null;
  empresa_id: string | null;
  modulo: string;
  accion: string;
  entidad: string | null;
  entidad_id: string | null;
  ip: string | null;
  antes: unknown;
  despues: unknown;
  detalle: unknown;
};

// Exportación con los mismos filtros de la pantalla (máximo 20 000 registros).
export async function GET(request: NextRequest) {
  if (!(await permisoEnAccion("admin.auditoria", "exportar"))) return new NextResponse("No encontrado", { status: 404 });
  const f = leerFiltrosAuditoria(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const supabase = await crearClienteServidor();
  const consulta = await consultaAuditoria(supabase, f, "id, en, usuario_id, empresa_id, modulo, accion, entidad, entidad_id, ip, antes, despues, detalle");

  const filas: Fila[] = [];
  if (consulta) {
    // PostgREST entrega como máximo 1000 filas por pedido: se piden por páginas.
    for (let desde = 0; desde < 20_000; desde += 1000) {
      const { data, error } = await consulta.q.range(desde, desde + 999);
      if (error) return new NextResponse("Error al exportar", { status: 500 });
      const pagina = (data ?? []) as unknown as Fila[];
      filas.push(...pagina);
      if (pagina.length < 1000) break;
    }
  }
  const [zona, { usuarios, empresas }] = await Promise.all([zonaHoraria(), nombres(supabase, filas)]);
  const json = (v: unknown) => (v == null ? "" : JSON.stringify(v));
  const csv = aCsv(filas, [
    { titulo: "Fecha y hora", valor: (x) => fechaHora(x.en, zona) },
    { titulo: "Usuario", valor: (x) => (x.usuario_id ? (usuarios.get(x.usuario_id)?.nombre ?? x.usuario_id) : "Sistema") },
    { titulo: "Correo", valor: (x) => (x.usuario_id ? usuarios.get(x.usuario_id)?.correo : "") },
    { titulo: "RUC", valor: (x) => (x.empresa_id ? empresas.get(x.empresa_id)?.ruc : "") },
    { titulo: "Empresa", valor: (x) => (x.empresa_id ? empresas.get(x.empresa_id)?.nombre_corto : "") },
    { titulo: "Módulo", valor: (x) => nombreModulo(x.modulo) },
    { titulo: "Acción", valor: (x) => nombreAccion(x.accion) },
    { titulo: "Tabla", valor: (x) => x.entidad },
    { titulo: "Id del registro", valor: (x) => x.entidad_id },
    { titulo: "IP", valor: (x) => x.ip },
    { titulo: "Antes", valor: (x) => json(x.antes) },
    { titulo: "Después", valor: (x) => json(x.despues) },
    { titulo: "Detalle", valor: (x) => json(x.detalle) },
  ]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auditoria-${f.desde ?? "inicio"}-a-${f.hasta ?? "hoy"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
