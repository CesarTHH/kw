import type { Metadata } from "next";
import Link from "next/link";
import { BotonEnviar } from "@/components/BotonEnviar";
import { Avisos } from "@/components/maestras/Avisos";
import { Buscador } from "@/components/maestras/Buscador";
import { EstadoLista } from "@/components/maestras/EstadoLista";
import { Paginacion } from "@/components/maestras/Paginacion";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { esUuid, filtroOr, numeroPagina, rango, terminoBusqueda, urlCon } from "@/lib/busqueda";
import { TIPOS_CONTACTO } from "@/lib/maestras/esquemas";
import { puede } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { rechazarSolicitud } from "./acciones";
import { BotonAprobar } from "./BotonAprobar";

export const metadata: Metadata = { title: "Solicitudes de registro" };

const RUTA = "/maestras/solicitudes";
const ESTADOS = { pendiente: "Pendientes", aprobada: "Aprobadas", rechazada: "Rechazadas", todas: "Todas" } as const;
type FiltroSolicitudes = keyof typeof ESTADOS;

type FrenteSol = { proyecto_id: string; area_id: string; frente: string; sponsor?: string; desde: string; hasta: string };
type ContactoSol = { tipo: keyof typeof TIPOS_CONTACTO; nombre: string; telefono?: string; correo: string };
type Solicitud = {
  id: string;
  ruc: string;
  razon_social: string;
  direccion: string | null;
  usuario_nombre: string;
  usuario_correo: string;
  usuario_telefono: string | null;
  frentes: FrenteSol[];
  contactos: ContactoSol[];
  estado: "pendiente" | "aprobada" | "rechazada";
  motivo_rechazo: string | null;
  revisado_en: string | null;
  empresa_id: string | null;
  usuario_id: string | null;
  created_at: string;
};

const fechaHora = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: "America/Lima" });

export default async function PaginaSolicitudes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requerirPermiso("maestras.solicitudes");
  const aprobar = puede(await obtenerMenu(), "maestras.solicitudes", "aprobar") && ctx.alcance === "todas";

  const sp = await searchParams;
  const q = terminoBusqueda(sp.q);
  const p = numeroPagina(sp.p);
  const f: FiltroSolicitudes = sp.f && Object.hasOwn(ESTADOS, sp.f) ? (sp.f as FiltroSolicitudes) : "pendiente";
  const id = esUuid(sp.id) ? sp.id : undefined;
  const lista = { q, p: String(p), f };

  const supabase = await crearClienteServidor();
  let consulta = supabase
    .from("solicitudes_registro")
    .select("id, ruc, razon_social, usuario_nombre, usuario_correo, estado, created_at", { count: "exact" })
    .order("created_at", { ascending: f === "pendiente" });
  if (q) consulta = consulta.or(filtroOr(["ruc", "razon_social", "usuario_correo", "usuario_nombre"], q));
  if (f !== "todas") consulta = consulta.eq("estado", f);
  const [desde, hasta] = rango(p);

  const [{ data: filas, count }, solR, proyectosR, areasR] = await Promise.all([
    consulta.range(desde, hasta),
    id
      ? supabase
          .from("solicitudes_registro")
          .select(
            "id, ruc, razon_social, direccion, usuario_nombre, usuario_correo, usuario_telefono, frentes, contactos, estado, motivo_rechazo, revisado_en, empresa_id, usuario_id, created_at",
          )
          .eq("id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("proyectos").select("id, nombre"),
    supabase.from("areas").select("id, nombre"),
  ]);
  const sol = (solR.data ?? null) as Solicitud | null;
  const nombres = new Map<string, string>(
    [...(proyectosR.data ?? []), ...(areasR.data ?? [])].map((o: { id: string; nombre: string }) => [o.id, o.nombre]),
  );

  // ¿El RUC ya existe? (la aprobación reutilizará esa empresa)
  let empresaExistente: { id: string; razon_social: string } | null = null;
  if (sol?.estado === "pendiente") {
    const { data } = await supabase.from("empresas").select("id, razon_social").eq("ruc", sol.ruc).maybeSingle();
    empresaExistente = data;
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_30rem]">
      <section className="min-w-0 space-y-3">
        <Buscador accion={RUTA} q={q} placeholder="RUC, empresa, nombre o correo">
          <label>
            <span className="sr-only">Estado</span>
            <select name="f" defaultValue={f} className="campo w-auto">
              {Object.entries(ESTADOS).map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </Buscador>
        <div className="overflow-x-auto rounded-xl shadow">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">RUC</th>
                <th scope="col">Empresa</th>
                <th scope="col" className="hidden md:table-cell">Solicitante</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(filas ?? []).map((r) => (
                <tr key={r.id} className={r.id === id ? "outline-2 -outline-offset-2 outline-marca" : undefined}>
                  <td className="whitespace-nowrap">{fechaHora.format(new Date(r.created_at))}</td>
                  <td className="font-mono">{r.ruc}</td>
                  <td>
                    <Link href={urlCon(RUTA, { ...lista, id: r.id })} className="font-medium text-oliva hover:underline">
                      {r.razon_social}
                    </Link>
                  </td>
                  <td className="hidden md:table-cell">
                    {r.usuario_nombre}
                    <span className="block text-xs text-gris-medio">{r.usuario_correo}</span>
                  </td>
                  <td className="capitalize">{r.estado}</td>
                </tr>
              ))}
              {!filas?.length && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gris-medio">
                    No hay solicitudes {f !== "todas" ? ESTADOS[f].toLowerCase() : ""}.
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
        {!id && <p className="panel text-sm text-oliva">Elige una solicitud para revisarla.</p>}
        {id && !sol && <p className="alerta-error">La solicitud no existe.</p>}
        {sol && (
          <>
            <section className="panel space-y-2 text-sm">
              <h2 className="text-lg font-semibold text-oliva">{sol.razon_social}</h2>
              <p>
                RUC <span className="font-mono">{sol.ruc}</span>
                {sol.direccion && <> · {sol.direccion}</>}
              </p>
              <p>
                Solicitante: <strong>{sol.usuario_nombre}</strong> · {sol.usuario_correo}
                {sol.usuario_telefono && <> · {sol.usuario_telefono}</>}
              </p>
              <p className="text-gris-medio">Recibida: {fechaHora.format(new Date(sol.created_at))}</p>
              {sol.estado !== "pendiente" && (
                <p>
                  Estado: <strong className="capitalize">{sol.estado}</strong>
                  {sol.revisado_en && <> · {fechaHora.format(new Date(sol.revisado_en))}</>}
                  {sol.motivo_rechazo && <span className="block">Motivo: {sol.motivo_rechazo}</span>}
                </p>
              )}
              {empresaExistente && (
                <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  Ese RUC ya está registrado como «{empresaExistente.razon_social}». Al aprobar, el solicitante tendrá
                  una cuenta con acceso a los datos de esa empresa y se agregarán sus frentes y contactos (los datos de la
                  empresa no se sobrescriben). Verifica su identidad antes de aprobar.
                </p>
              )}
              {sol.empresa_id && (
                <Link href={urlCon("/maestras/clientes", { id: sol.empresa_id })} className="text-oliva underline">
                  Ver empresa
                </Link>
              )}
            </section>

            <section className="panel space-y-2 text-sm">
              <h3 className="font-semibold text-oliva">Frentes de trabajo</h3>
              <ul className="space-y-1">
                {sol.frentes.map((fr, i) => (
                  <li key={i} className="rounded bg-white px-3 py-2">
                    <strong>{fr.frente}</strong>
                    <span className="block text-gris-medio">
                      {nombres.get(fr.proyecto_id) ?? "¿proyecto?"} / {nombres.get(fr.area_id) ?? "¿área?"} · {fr.desde} a {fr.hasta}
                      {fr.sponsor ? ` · Sponsor: ${fr.sponsor}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <h3 className="pt-2 font-semibold text-oliva">Contactos</h3>
              <ul className="space-y-1">
                {sol.contactos.map((c, i) => (
                  <li key={i} className="rounded bg-white px-3 py-2">
                    <span className="text-gris-medio">{TIPOS_CONTACTO[c.tipo] ?? c.tipo}:</span> {c.nombre} · {c.correo}
                    {c.telefono ? ` · ${c.telefono}` : ""}
                  </li>
                ))}
              </ul>
            </section>

            {aprobar && (sol.estado === "pendiente" || (sol.estado === "aprobada" && !sol.usuario_id)) && (
              <section className="panel space-y-3">
                <h3 className="font-semibold text-oliva">Decisión</h3>
                <BotonAprobar id={sol.id} soloUsuario={sol.estado === "aprobada"} empresaExistente={empresaExistente?.razon_social} />
                {sol.estado === "pendiente" && (
                  <form action={rechazarSolicitud} className="space-y-2 border-t border-gris-medio/40 pt-3">
                    <input type="hidden" name="id" value={sol.id} />
                    <EstadoLista q={q} p={p} f={f} />
                    <label className="block">
                      <span className="etiqueta">Motivo del rechazo *</span>
                      <textarea name="motivo" required minLength={5} maxLength={500} rows={3} className="campo" />
                    </label>
                    <BotonEnviar className="btn-secundario" pendiente="Rechazando…">
                      Rechazar solicitud
                    </BotonEnviar>
                  </form>
                )}
                <p className="text-xs text-gris-medio">
                  El solicitante recibe un correo en ambos casos (aprobación o rechazo).
                </p>
              </section>
            )}
          </>
        )}
      </aside>
    </main>
  );
}
