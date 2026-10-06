import { NextResponse, type NextRequest } from "next/server";
import { permisoEnAccion } from "@/lib/auth";
import { esUuid, filtroOr, terminoBusqueda } from "@/lib/busqueda";
import { aCsv, type ColumnaCsv } from "@/lib/csv";
import { catalogoPorCodigo, columnasCatalogo } from "@/lib/maestras/catalogos";
import { TIPOS_CONTACTO } from "@/lib/maestras/esquemas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

// Exportación a Excel (CSV) de las tablas maestras. Respeta los mismos filtros
// de la pantalla y, como usa la sesión del usuario, la misma seguridad (RLS).
const MAXIMO = 20_000;

type Fila = Record<string, unknown>;

function estadoFiltro(v: string | null): "activos" | "inactivos" | "todos" {
  return v === "inactivos" || v === "todos" ? v : "activos";
}

function respuesta(nombre: string, csv: string) {
  const fecha = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}-${fecha}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

const noEncontrado = () => new NextResponse("No encontrado", { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  const sp = request.nextUrl.searchParams;
  const q = terminoBusqueda(sp.get("q"));
  const f = estadoFiltro(sp.get("f"));
  const supabase = await crearClienteServidor();

  if (tipo === "clientes") {
    if (!(await permisoEnAccion("maestras.clientes", "exportar"))) return noEncontrado();
    let consulta = supabase
      .from("empresas")
      .select("ruc, razon_social, nombre_corto, tipo, direccion, telefonos, activo, empresa_contactos(tipo, nombre, telefono, correo, recibe_notificaciones, activo)")
      .order("razon_social");
    if (q) consulta = consulta.or(filtroOr(["ruc", "razon_social", "nombre_corto"], q));
    if (f !== "todos") consulta = consulta.eq("activo", f === "activos");
    const { data, error } = await consulta.limit(MAXIMO);
    if (error) return new NextResponse("Error al exportar", { status: 500 });

    // Una fila por contacto (o una sola si la empresa no tiene contactos).
    type Contacto = { tipo: keyof typeof TIPOS_CONTACTO; nombre: string; telefono: string | null; correo: string; recibe_notificaciones: boolean; activo: boolean };
    const filas = (data ?? []).flatMap((e: Fila) => {
      const contactos = (e.empresa_contactos as Contacto[] | null) ?? [];
      return contactos.length ? contactos.map((c) => ({ ...e, c })) : [{ ...e, c: null as Contacto | null }];
    });
    const columnas: ColumnaCsv<(typeof filas)[number]>[] = [
      { titulo: "RUC", valor: (r) => r.ruc },
      { titulo: "Razón social", valor: (r) => r.razon_social },
      { titulo: "Nombre corto", valor: (r) => r.nombre_corto },
      { titulo: "Tipo", valor: (r) => r.tipo },
      { titulo: "Dirección", valor: (r) => r.direccion },
      { titulo: "Teléfonos", valor: (r) => r.telefonos },
      { titulo: "Activo", valor: (r) => r.activo },
      { titulo: "Contacto - tipo", valor: (r) => (r.c ? TIPOS_CONTACTO[r.c.tipo] : "") },
      { titulo: "Contacto - nombre", valor: (r) => r.c?.nombre },
      { titulo: "Contacto - teléfono", valor: (r) => r.c?.telefono },
      { titulo: "Contacto - correo", valor: (r) => r.c?.correo },
      { titulo: "Contacto - recibe notificaciones", valor: (r) => r.c?.recibe_notificaciones },
      { titulo: "Contacto - activo", valor: (r) => r.c?.activo },
    ];
    return respuesta("clientes", aCsv(filas, columnas));
  }

  if (tipo === "frentes") {
    if (!(await permisoEnAccion("maestras.frentes", "exportar"))) return noEncontrado();
    let consulta = supabase
      .from("frentes_trabajo")
      .select("nombre, sponsor, contrato_desde, contrato_hasta, activo, proyectos(nombre), areas(nombre), empresa_frentes(activo, empresas(ruc, razon_social))")
      .order("nombre");
    if (q) consulta = consulta.or(filtroOr(["nombre", "sponsor"], q));
    const pr = sp.get("pr");
    if (esUuid(pr)) consulta = consulta.eq("proyecto_id", pr);
    if (f !== "todos") consulta = consulta.eq("activo", f === "activos");
    const { data, error } = await consulta.limit(MAXIMO);
    if (error) return new NextResponse("Error al exportar", { status: 500 });

    type Asig = { activo: boolean; empresas: { ruc: string; razon_social: string } | null };
    const filas = (data ?? []).flatMap((fr: Fila) => {
      const asig = ((fr.empresa_frentes as Asig[] | null) ?? []).filter((a) => a.activo);
      return asig.length ? asig.map((a) => ({ ...fr, a })) : [{ ...fr, a: null as Asig | null }];
    });
    const nombreDe = (v: unknown) => (v as { nombre?: string } | null)?.nombre;
    const columnas: ColumnaCsv<(typeof filas)[number]>[] = [
      { titulo: "Proyecto", valor: (r) => nombreDe(r.proyectos) },
      { titulo: "Área", valor: (r) => nombreDe(r.areas) },
      { titulo: "Frente", valor: (r) => r.nombre },
      { titulo: "Sponsor", valor: (r) => r.sponsor },
      { titulo: "Contrato desde", valor: (r) => r.contrato_desde },
      { titulo: "Contrato hasta", valor: (r) => r.contrato_hasta },
      { titulo: "Activo", valor: (r) => r.activo },
      { titulo: "Empresa RUC", valor: (r) => r.a?.empresas?.ruc },
      { titulo: "Empresa", valor: (r) => r.a?.empresas?.razon_social },
    ];
    return respuesta("frentes", aCsv(filas, columnas));
  }

  if (tipo === "usuarios") {
    if (!(await permisoEnAccion("maestras.usuarios", "exportar"))) return noEncontrado();
    let consulta = supabase
      .from("perfiles")
      .select("nombre, correo, estado, ultimo_acceso, created_at, roles(nombre), empresas(ruc, razon_social), comedores(nombre)")
      .order("nombre");
    if (q) consulta = consulta.or(filtroOr(["nombre", "correo"], q));
    const est = sp.get("f");
    if (est === "activo" || est === "inactivo" || est === "pendiente") consulta = consulta.eq("estado", est);
    const { data, error } = await consulta.limit(MAXIMO);
    if (error) return new NextResponse("Error al exportar", { status: 500 });
    const columnas: ColumnaCsv<Fila>[] = [
      { titulo: "Nombre", valor: (r) => r.nombre },
      { titulo: "Correo", valor: (r) => r.correo },
      { titulo: "Rol", valor: (r) => (r.roles as { nombre?: string } | null)?.nombre },
      { titulo: "Empresa RUC", valor: (r) => (r.empresas as { ruc?: string } | null)?.ruc },
      { titulo: "Empresa", valor: (r) => (r.empresas as { razon_social?: string } | null)?.razon_social },
      { titulo: "Comedor", valor: (r) => (r.comedores as { nombre?: string } | null)?.nombre },
      { titulo: "Estado", valor: (r) => r.estado },
      { titulo: "Último acceso", valor: (r) => r.ultimo_acceso },
      { titulo: "Creado", valor: (r) => r.created_at },
    ];
    return respuesta("usuarios", aCsv((data ?? []) as Fila[], columnas));
  }

  const cat = catalogoPorCodigo(tipo);
  if (cat) {
    if (!(await permisoEnAccion("maestras.catalogos", "exportar"))) return noEncontrado();
    let consulta = supabase.from(cat.tabla).select(columnasCatalogo(cat));
    for (const o of cat.orden) consulta = consulta.order(o.columna, { ascending: o.asc });
    if (q && cat.busqueda.length) consulta = consulta.or(filtroOr(cat.busqueda, q));
    if (cat.tieneActivo && f !== "todos") consulta = consulta.eq("activo", f === "activos");
    const { data, error } = await consulta.limit(MAXIMO);
    if (error) return new NextResponse("Error al exportar", { status: 500 });

    // Nombres de las referencias (sector, tipo de servicio, servicio).
    const refs = cat.campos.filter((c) => c.tipo === "referencia" && c.referencia);
    const mapas = new Map<string, Map<string, string>>();
    for (const r of refs) {
      const { data: ops } = await supabase.from(r.referencia!.tabla).select(`id, nombre:${r.referencia!.columna}`);
      mapas.set(r.nombre, new Map(((ops ?? []) as unknown as { id: string; nombre: string }[]).map((o) => [o.id, o.nombre])));
    }
    const columnas: ColumnaCsv<Fila>[] = [
      ...cat.campos.map((c) => ({
        titulo: c.etiqueta,
        valor: (r: Fila) => (c.tipo === "referencia" ? mapas.get(c.nombre)?.get(String(r[c.nombre])) : r[c.nombre]),
      })),
      ...(cat.tieneActivo ? [{ titulo: "Activo", valor: (r: Fila) => r.activo }] : []),
    ];
    return respuesta(cat.codigo, aCsv((data ?? []) as unknown as Fila[], columnas));
  }

  return noEncontrado();
}
