import type { Metadata } from "next";
import Link from "next/link";
import { BotonEnviar } from "@/components/BotonEnviar";
import { Encabezado } from "@/components/Encabezado";
import { Avisos } from "@/components/maestras/Avisos";
import { Paginacion } from "@/components/maestras/Paginacion";
import { esSuperadmin, obtenerMenu, requerirPermiso, type Contexto } from "@/lib/auth";
import { esUuid, numeroPagina, rango, terminoBusqueda, urlCon } from "@/lib/busqueda";
import { puede } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { renderizar, type Columna } from "../../../../../supabase/functions/_shared/plantilla";
import { guardarPlantilla, quitarSuprimido, reenviarCorreo } from "./acciones";

export const metadata: Metadata = { title: "Historial de correos" };

const RUTA = "/admin/correos";
const VISTAS = { historial: "Historial", plantillas: "Plantillas", suprimidos: "Direcciones bloqueadas" } as const;
type Vista = keyof typeof VISTAS;

const ESTADOS_CORREO: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: "En cola", clase: "bg-amber-100 text-amber-800" },
  procesando: { texto: "Enviando", clase: "bg-amber-100 text-amber-800" },
  enviado: { texto: "Enviado", clase: "bg-green-100 text-green-800" },
  entregado: { texto: "Entregado", clase: "bg-green-100 text-green-800" },
  registrado: { texto: "Solo registrado", clase: "bg-sky-100 text-sky-800" },
  parcial: { texto: "Parcial", clase: "bg-orange-100 text-orange-800" },
  fallido: { texto: "Fallido", clase: "bg-red-100 text-red-800" },
  rebotado: { texto: "Rebotó", clase: "bg-red-100 text-red-800" },
  queja: { texto: "Marcado como spam", clase: "bg-red-100 text-red-800" },
  suprimido: { texto: "Bloqueado", clase: "bg-neutral-200 text-neutral-700" },
};

function EstadoCorreo({ estado }: { estado: string }) {
  const e = ESTADOS_CORREO[estado] ?? { texto: estado, clase: "bg-neutral-200 text-neutral-700" };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${e.clase}`}>{e.texto}</span>;
}

const fechaHora = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: "America/Lima" });

/** Vista del HTML del correo: iframe aislado (sin scripts, sin acceso a la app). */
function VistaHtml({ html, titulo }: { html: string; titulo: string }) {
  return <iframe title={titulo} srcDoc={html} sandbox="" className="h-[32rem] w-full rounded-lg border border-gris-medio/40 bg-white" />;
}

export default async function PaginaCorreos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requerirPermiso("admin.correos");
  const sp = await searchParams;
  const vista: Vista = sp.vista && Object.hasOwn(VISTAS, sp.vista) ? (sp.vista as Vista) : "historial";
  const supabase = await crearClienteServidor();
  const [{ data: modo }, { count: suprimidos }] = await Promise.all([
    supabase.from("configuracion").select("valor").eq("clave", "correo.modo").maybeSingle(),
    supabase.from("correos_suprimidos").select("correo", { count: "exact", head: true }),
  ]);

  return (
    <>
      <Encabezado titulo="Correos" ctx={ctx} />
      <nav aria-label="Correos" className="overflow-x-auto bg-white shadow-sm">
        <ul className="mx-auto flex max-w-7xl gap-1 px-4">
          {Object.entries(VISTAS).map(([k, t]) => (
            <li key={k}>
              <Link
                href={urlCon(RUTA, { vista: k === "historial" ? undefined : k })}
                aria-current={vista === k ? "page" : undefined}
                className={`block whitespace-nowrap border-b-4 px-4 py-3 text-sm font-semibold ${
                  vista === k ? "border-marca text-marca" : "border-transparent text-oliva hover:border-gris-medio"
                }`}
              >
                {t}
                {k === "suprimidos" && (suprimidos ?? 0) > 0 ? ` (${suprimidos})` : ""}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-6">
        {modo?.valor !== "enviar" && (
          <p className="rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            Modo <strong>solo registrar</strong>: los correos se arman y se guardan aquí, pero no se envían. Cuando Amazon SES esté
            listo, cámbialo en <Link href="/admin/configuracion" className="underline">Configuración</Link>.
          </p>
        )}
        {vista === "historial" && <Historial ctx={ctx} sp={sp} />}
        {vista === "plantillas" && <Plantillas ctx={ctx} sp={sp} />}
        {vista === "suprimidos" && <Suprimidos ctx={ctx} sp={sp} />}
      </main>
    </>
  );
}

type FilaCorreo = {
  id: string;
  plantilla: string;
  estado: string;
  asunto_final: string | null;
  created_at: string;
  datos: { empresa?: string; ruc?: string } | null;
  plantillas_correo: { nombre: string } | null;
  correo_destinatarios: { correo: string; estado: string }[];
};

async function Historial({ ctx, sp }: { ctx: Contexto; sp: Record<string, string | undefined> }) {
  const reenviar = puede(await obtenerMenu(), "admin.correos", "enviar") && ctx.alcance === "todas";
  const q = terminoBusqueda(sp.q);
  const d = terminoBusqueda(sp.d);
  const p = numeroPagina(sp.p);
  const pl = sp.pl && /^[a-z_]{2,60}$/.test(sp.pl) ? sp.pl : undefined;
  const est = sp.est && Object.hasOwn(ESTADOS_CORREO, sp.est) ? sp.est : undefined;
  const desde = sp.desde && /^\d{4}-\d{2}-\d{2}$/.test(sp.desde) ? sp.desde : undefined;
  const hasta = sp.hasta && /^\d{4}-\d{2}-\d{2}$/.test(sp.hasta) ? sp.hasta : undefined;
  const id = esUuid(sp.id) ? sp.id : undefined;
  const lista = { q, d, p: String(p), pl, est, desde, hasta };

  const supabase = await crearClienteServidor();
  const relacion = d ? "correo_destinatarios!inner(correo, estado)" : "correo_destinatarios(correo, estado)";
  let consulta = supabase
    .from("correos_pendientes")
    .select(`id, plantilla, estado, asunto_final, created_at, datos, plantillas_correo(nombre), ${relacion}`, { count: "exact" })
    .order("created_at", { ascending: false });
  if (q) consulta = consulta.or(`datos->>empresa.ilike.*${q}*,datos->>ruc.ilike.*${q}*,asunto_final.ilike.*${q}*`);
  if (d) consulta = consulta.ilike("correo_destinatarios.correo", `%${d}%`);
  if (pl) consulta = consulta.eq("plantilla", pl);
  if (est) consulta = consulta.eq("estado", est);
  if (desde) consulta = consulta.gte("created_at", `${desde}T00:00:00-05:00`);
  if (hasta) consulta = consulta.lte("created_at", `${hasta}T23:59:59-05:00`);
  const [ini, fin] = rango(p);

  const [{ data, count }, { data: plantillasData }, detalleR] = await Promise.all([
    consulta.range(ini, fin),
    supabase.from("plantillas_correo").select("codigo, nombre").order("nombre"),
    id
      ? supabase
          .from("correos_pendientes")
          .select(
            "id, plantilla, estado, intentos, ultimo_error, asunto_final, html_final, texto_final, created_at, envio_id, reenvio_de, datos, plantillas_correo(nombre), correo_destinatarios(correo, tipo, estado, detalle, actualizado_en)",
          )
          .eq("id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const filas = (data ?? []) as unknown as FilaCorreo[];
  const plantillas = (plantillasData ?? []) as { codigo: string; nombre: string }[];
  const detalle = detalleR.data as unknown as
    | (FilaCorreo & {
        intentos: number;
        ultimo_error: string | null;
        html_final: string | null;
        texto_final: string | null;
        envio_id: string | null;
        reenvio_de: string | null;
        correo_destinatarios: { correo: string; tipo: string; estado: string; detalle: string | null; actualizado_en: string }[];
      })
    | null;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_36rem]">
      <section className="min-w-0 space-y-3">
        <form action={RUTA} method="get" role="search" className="grid gap-2 rounded-xl bg-white p-3 shadow sm:grid-cols-3">
          <label className="block">
            <span className="etiqueta">Empresa, RUC o asunto</span>
            <input name="q" defaultValue={q} maxLength={60} className="campo" />
          </label>
          <label className="block">
            <span className="etiqueta">Destinatario</span>
            <input name="d" defaultValue={d} maxLength={60} className="campo" />
          </label>
          <label className="block">
            <span className="etiqueta">Tipo</span>
            <select name="pl" defaultValue={pl ?? ""} className="campo">
              <option value="">Todos</option>
              {plantillas.map((x) => (
                <option key={x.codigo} value={x.codigo}>
                  {x.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="etiqueta">Estado</span>
            <select name="est" defaultValue={est ?? ""} className="campo">
              <option value="">Todos</option>
              {["pendiente", "enviado", "registrado", "parcial", "fallido"].map((e) => (
                <option key={e} value={e}>
                  {ESTADOS_CORREO[e]?.texto}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="etiqueta">Desde</span>
            <input type="date" name="desde" defaultValue={desde} className="campo" />
          </label>
          <label className="block">
            <span className="etiqueta">Hasta</span>
            <input type="date" name="hasta" defaultValue={hasta} className="campo" />
          </label>
          <div className="flex justify-end sm:col-span-3">
            <button type="submit" className="btn-secundario">
              Buscar
            </button>
          </div>
        </form>

        <div className="overflow-x-auto rounded-xl shadow">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Tipo</th>
                <th scope="col" className="hidden md:table-cell">Empresa</th>
                <th scope="col">Destinatarios</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id} className={c.id === id ? "outline-2 -outline-offset-2 outline-marca" : undefined}>
                  <td className="whitespace-nowrap">
                    <Link href={urlCon(RUTA, { ...lista, id: c.id })} className="font-medium text-oliva hover:underline">
                      {fechaHora.format(new Date(c.created_at))}
                    </Link>
                  </td>
                  <td>{c.plantillas_correo?.nombre ?? c.plantilla}</td>
                  <td className="hidden md:table-cell">{c.datos?.empresa ?? "—"}</td>
                  <td className="max-w-56 truncate" title={c.correo_destinatarios.map((x) => x.correo).join(", ")}>
                    {c.correo_destinatarios[0]?.correo ?? "—"}
                    {c.correo_destinatarios.length > 1 ? ` +${c.correo_destinatarios.length - 1}` : ""}
                  </td>
                  <td>
                    <EstadoCorreo estado={c.estado} />
                  </td>
                </tr>
              ))}
              {!filas.length && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gris-medio">
                    No hay correos que coincidan.
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
        {!id && <p className="panel text-sm text-oliva">Elige un correo para ver su contenido y el estado de cada destinatario.</p>}
        {id && !detalle && <p className="alerta-error">El correo no existe.</p>}
        {detalle && (
          <>
            <section className="panel space-y-2 text-sm">
              <h2 className="text-base font-semibold text-oliva">{detalle.asunto_final ?? "(aún no se arma)"}</h2>
              <p>
                {detalle.plantillas_correo?.nombre} · {fechaHora.format(new Date(detalle.created_at))} · <EstadoCorreo estado={detalle.estado} />
              </p>
              {detalle.intentos > 1 && <p className="text-gris-medio">Intentos: {detalle.intentos}</p>}
              {detalle.ultimo_error && <p className="text-red-800">Último error: {detalle.ultimo_error}</p>}
              {detalle.reenvio_de && (
                <p>
                  Reenvío de{" "}
                  <Link href={urlCon(RUTA, { id: detalle.reenvio_de })} className="text-oliva underline">
                    otro correo
                  </Link>
                </p>
              )}
              {detalle.envio_id && <p className="text-gris-medio">Envío relacionado: {detalle.envio_id}</p>}
              <table className="tabla mt-2">
                <thead>
                  <tr>
                    <th scope="col">Destinatario</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.correo_destinatarios.map((x) => (
                    <tr key={x.correo}>
                      <td className="break-all">
                        {x.correo}
                        {x.detalle && <span className="block text-xs text-gris-medio">{x.detalle}</span>}
                      </td>
                      <td className="uppercase">{x.tipo}</td>
                      <td>
                        <EstadoCorreo estado={x.estado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {reenviar && (
                <form action={reenviarCorreo} className="flex justify-end pt-2">
                  <input type="hidden" name="id" value={detalle.id} />
                  <BotonEnviar className="btn-secundario" pendiente="Reenviando…">
                    Reenviar
                  </BotonEnviar>
                </form>
              )}
            </section>
            {detalle.html_final ? (
              <VistaHtml html={detalle.html_final} titulo={`Contenido: ${detalle.asunto_final ?? ""}`} />
            ) : (
              <p className="panel text-sm">El contenido se guarda cuando el correo sale de la cola (en menos de un minuto).</p>
            )}
            {detalle.texto_final && (
              <details className="rounded-xl bg-white p-3 text-sm shadow">
                <summary className="cursor-pointer font-semibold text-oliva">Versión en texto</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans">{detalle.texto_final}</pre>
              </details>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

type PlantillaFila = {
  codigo: string;
  nombre: string;
  asunto: string;
  html: string;
  texto: string;
  columnas: Columna[];
  variables: string[];
  activo: boolean;
};

/** Datos de ejemplo para la vista previa de una plantilla. */
function datosEjemplo(p: PlantillaFila): Record<string, unknown> {
  const ejemplo: Record<string, unknown> = {
    empresa: "EMPRESA DE EJEMPLO S.A.C.",
    ruc: "20999999019",
    usuario: "Ana Pérez",
    correo_usuario: "ana@ejemplo.com",
    fecha_envio: "06/10/2026 10:30",
    motivo: "Los datos del RUC no coinciden con la razón social.",
    asunto: "Consulta sobre mi programación",
    mensaje: "Buenos días,\nquisiera confirmar las raciones del lunes.",
  };
  const valores: Record<string, unknown> = {
    fecha: "2026-10-12",
    proyecto: "YANACOCHA",
    area: "LEGAL",
    frente: "FRENTE DEMO 1",
    comedor: "KM 52",
    servicio: "ALMUERZO",
    cantidad: 5,
    turno: "MAÑANA",
    composicion: "Estándar",
    precio: "29.78",
    tipo: "Estándar",
    encargado: "Luis Gómez",
  };
  if (p.columnas.length) {
    ejemplo.registros = [0, 1].map((i) =>
      Object.fromEntries(p.columnas.map((c) => [c.clave, c.clave === "fecha" ? `2026-10-1${2 + i}` : (valores[c.clave] ?? "…")])),
    );
  }
  return ejemplo;
}

async function Plantillas({ ctx, sp }: { ctx: Contexto; sp: Record<string, string | undefined> }) {
  const editar = esSuperadmin(ctx);
  const supabase = await crearClienteServidor();
  const [{ data }, { data: cfg }] = await Promise.all([
    supabase.from("plantillas_correo").select("codigo, nombre, asunto, html, texto, columnas, variables, activo").order("nombre"),
    supabase.from("configuracion").select("clave, valor").in("clave", ["app.url", "contacto.destinatario"]),
  ]);
  const plantillas = (data ?? []) as PlantillaFila[];
  const actual = plantillas.find((x) => x.codigo === sp.p) ?? plantillas[0];
  const config = new Map(((cfg ?? []) as { clave: string; valor: unknown }[]).map((c) => [c.clave, String(c.valor ?? "")]));
  const vista = actual
    ? renderizar(actual, datosEjemplo(actual), {
        url_app: config.get("app.url") ?? "",
        correo_contacto: config.get("contacto.destinatario") ?? "",
      })
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <nav aria-label="Plantillas" className="panel h-fit p-3">
        <ul className="space-y-1">
          {plantillas.map((x) => (
            <li key={x.codigo}>
              <Link
                href={urlCon(RUTA, { vista: "plantillas", p: x.codigo })}
                aria-current={x.codigo === actual?.codigo ? "page" : undefined}
                className={`block rounded px-3 py-2 text-sm ${x.codigo === actual?.codigo ? "bg-marca font-semibold text-white" : "hover:bg-white"}`}
              >
                {x.nombre}
                {!x.activo && <span className="text-xs opacity-80"> · desactivada</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {actual && vista && (
        <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
          <form action={guardarPlantilla} className="panel space-y-3">
            <Avisos ok={sp.ok} error={sp.error} />
            <h2 className="font-semibold text-oliva">{actual.nombre}</h2>
            <input type="hidden" name="codigo" value={actual.codigo} />
            <p className="text-xs text-gris-medio">
              Variables: {[...actual.variables, "url_app", "correo_contacto", ...(actual.columnas.length ? ["pie_facturacion"] : [])].map((v) => `{{${v}}}`).join(" ")}
            </p>
            <label className="block">
              <span className="etiqueta">Asunto</span>
              <input name="asunto" required maxLength={300} defaultValue={actual.asunto} disabled={!editar} className="campo" />
            </label>
            <label className="block">
              <span className="etiqueta">Cuerpo (HTML)</span>
              <textarea name="html" rows={12} defaultValue={actual.html} disabled={!editar} className="campo font-mono text-xs" />
            </label>
            <label className="block">
              <span className="etiqueta">Cuerpo (texto plano)</span>
              <textarea name="texto" rows={8} defaultValue={actual.texto} disabled={!editar} className="campo font-mono text-xs" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="activo" defaultChecked={actual.activo} disabled={!editar} className="size-4 accent-marca" />
              Activa (si se desactiva, este correo no se envía)
            </label>
            {editar ? (
              <div className="flex justify-end">
                <BotonEnviar pendiente="Guardando…">Guardar plantilla</BotonEnviar>
              </div>
            ) : (
              <p className="text-xs text-gris-medio">Solo el Superadmin puede editar las plantillas.</p>
            )}
          </form>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-oliva">Vista previa (datos de ejemplo)</h3>
            <p className="text-sm">
              <strong>Asunto:</strong> {vista.asunto}
            </p>
            <VistaHtml html={vista.html} titulo="Vista previa de la plantilla" />
          </section>
        </div>
      )}
    </div>
  );
}

async function Suprimidos({ ctx, sp }: { ctx: Contexto; sp: Record<string, string | undefined> }) {
  const editar = esSuperadmin(ctx);
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("correos_suprimidos").select("correo, motivo, detalle, created_at").order("created_at", { ascending: false }).limit(500);
  const filas = (data ?? []) as { correo: string; motivo: string; detalle: string | null; created_at: string }[];
  return (
    <section className="space-y-3">
      <Avisos ok={sp.ok} error={sp.error} />
      <p className="text-sm text-oliva">
        Estas direcciones rebotaron (no existen) o marcaron un correo como spam. No se les vuelve a escribir hasta quitarlas de la
        lista. Corrige el contacto en <Link href="/maestras/clientes" className="underline">Clientes y contactos</Link> antes de quitarla.
      </p>
      <div className="overflow-x-auto rounded-xl shadow">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Correo</th>
              <th scope="col">Motivo</th>
              <th scope="col">Fecha</th>
              {editar && (
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.correo}>
                <td className="break-all">
                  {f.correo}
                  {f.detalle && <span className="block text-xs text-gris-medio">{f.detalle}</span>}
                </td>
                <td>{f.motivo === "rebote" ? "Rebotó" : f.motivo === "queja" ? "Marcado como spam" : "Manual"}</td>
                <td className="whitespace-nowrap">{fechaHora.format(new Date(f.created_at))}</td>
                {editar && (
                  <td className="text-right">
                    <form action={quitarSuprimido}>
                      <input type="hidden" name="correo" value={f.correo} />
                      <BotonEnviar className="btn-secundario px-3! py-1! text-xs">Quitar de la lista</BotonEnviar>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {!filas.length && (
              <tr>
                <td colSpan={editar ? 4 : 3} className="py-6 text-center text-gris-medio">
                  No hay direcciones bloqueadas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
