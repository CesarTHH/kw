import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { BotonEnviar } from "@/components/BotonEnviar";
import { Avisos } from "@/components/maestras/Avisos";
import { Buscador } from "@/components/maestras/Buscador";
import { EstadoLista } from "@/components/maestras/EstadoLista";
import { Paginacion } from "@/components/maestras/Paginacion";
import { esSuperadmin, obtenerMenu, requerirPermiso } from "@/lib/auth";
import { esUuid, filtroOr, numeroPagina, rango, terminoBusqueda, urlCon } from "@/lib/busqueda";
import { puede } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { cambiarEstadoUsuario, guardarUsuario } from "./acciones";
import { BotonRestablecer } from "./BotonRestablecer";
import { CamposRol } from "./CamposRol";
import { FormNuevoUsuario, type Opcion, type OpcionRol } from "./FormNuevoUsuario";

export const metadata: Metadata = { title: "Usuarios" };

const RUTA = "/maestras/usuarios";
const ESTADOS = { activo: "Activos", inactivo: "Inactivos", pendiente: "Pendientes", todos: "Todos" } as const;
type FiltroUsuarios = keyof typeof ESTADOS;

type Perfil = {
  id: string;
  nombre: string;
  correo: string;
  estado: "activo" | "inactivo" | "pendiente";
  rol_id: string | null;
  empresa_id: string | null;
  comedor_id: string | null;
  ultimo_acceso: string | null;
  debe_cambiar_password: boolean;
  roles: { codigo: string; nombre: string } | null;
  empresas: { nombre_corto: string } | null;
  comedores: { nombre: string } | null;
};

const fechaHora = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: "America/Lima" });

function EstadoUsuario({ estado }: { estado: Perfil["estado"] }) {
  const estilos = {
    activo: "bg-green-100 text-green-800",
    inactivo: "bg-neutral-200 text-neutral-600",
    pendiente: "bg-amber-100 text-amber-800",
  } as const;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${estilos[estado]}`}>{estado}</span>;
}

export default async function PaginaUsuarios({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requerirPermiso("maestras.usuarios");
  const menu = await obtenerMenu();
  const editar = puede(menu, "maestras.usuarios", "editar");
  const crear = puede(menu, "maestras.usuarios", "crear") && ctx.alcance === "todas";
  const exportar = puede(menu, "maestras.usuarios", "exportar");

  const sp = await searchParams;
  const q = terminoBusqueda(sp.q);
  const p = numeroPagina(sp.p);
  const f: FiltroUsuarios = sp.f && Object.hasOwn(ESTADOS, sp.f) ? (sp.f as FiltroUsuarios) : "activo";
  const id = sp.id === "nuevo" && crear ? "nuevo" : esUuid(sp.id) ? sp.id : undefined;
  const lista = { q, p: String(p), f };

  const supabase = await crearClienteServidor();
  const columnas =
    "id, nombre, correo, estado, rol_id, empresa_id, comedor_id, ultimo_acceso, debe_cambiar_password, roles(codigo, nombre), empresas(nombre_corto), comedores(nombre)";
  let consulta = supabase.from("perfiles").select(columnas, { count: "exact" }).order("nombre");
  if (q) consulta = consulta.or(filtroOr(["nombre", "correo"], q));
  if (f !== "todos") consulta = consulta.eq("estado", f);
  const [desde, hasta] = rango(p);

  const necesitaOpciones = editar || crear;
  const [{ data: filasData, count }, rolesR, empresasR, comedoresR, actualR] = await Promise.all([
    consulta.range(desde, hasta),
    necesitaOpciones
      ? supabase.from("roles").select("id, codigo, nombre, alcance").eq("activo", true).order("nombre")
      : Promise.resolve({ data: [] }),
    necesitaOpciones
      ? supabase.from("empresas").select("id, nombre:razon_social").eq("activo", true).order("razon_social")
      : Promise.resolve({ data: [] }),
    necesitaOpciones
      ? supabase.from("comedores").select("id, nombre").eq("activo", true).order("nombre")
      : Promise.resolve({ data: [] }),
    id && id !== "nuevo" ? supabase.from("perfiles").select(columnas).eq("id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const filas = (filasData ?? []) as unknown as Perfil[];
  // Solo un Superadmin puede asignar el rol Superadmin.
  const roles = ((rolesR.data ?? []) as (OpcionRol & { codigo: string })[]).filter(
    (r) => r.codigo !== "superadmin" || esSuperadmin(ctx),
  );
  const empresas = (empresasR.data ?? []) as Opcion[];
  const comedores = (comedoresR.data ?? []) as Opcion[];
  const usuario = (actualR.data ?? null) as unknown as Perfil | null;
  const esPropio = usuario?.id === ctx.usuario_id;
  const protegido = usuario?.roles?.codigo === "superadmin" && !esSuperadmin(ctx);
  const puedeEditar = editar && !!usuario && !esPropio && !protegido;

  return (
    <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_26rem]">
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1">
            <Buscador accion={RUTA} q={q} placeholder="Nombre o correo">
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
          </div>
          {crear && (
            <Link href={urlCon(RUTA, { ...lista, id: "nuevo" })} className="btn-marca">
              <Plus className="size-4" aria-hidden /> Nuevo usuario
            </Link>
          )}
          {exportar && (
            <a href={urlCon("/maestras/exportar/usuarios", { q, f: f === "todos" ? undefined : f })} className="btn-secundario">
              <Download className="size-4" aria-hidden /> Excel
            </a>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl shadow">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col" className="hidden md:table-cell">Correo</th>
                <th scope="col">Rol</th>
                <th scope="col" className="hidden lg:table-cell">Empresa / comedor</th>
                <th scope="col">Estado</th>
                <th scope="col" className="hidden xl:table-cell">Último acceso</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((u) => (
                <tr key={u.id} className={u.id === id ? "outline-2 -outline-offset-2 outline-marca" : undefined}>
                  <td>
                    <Link href={urlCon(RUTA, { ...lista, id: u.id })} className="font-medium text-oliva hover:underline">
                      {u.nombre}
                    </Link>
                  </td>
                  <td className="hidden md:table-cell">{u.correo}</td>
                  <td>{u.roles?.nombre ?? "—"}</td>
                  <td className="hidden lg:table-cell">{u.empresas?.nombre_corto ?? u.comedores?.nombre ?? "—"}</td>
                  <td>
                    <EstadoUsuario estado={u.estado} />
                  </td>
                  <td className="hidden xl:table-cell">{u.ultimo_acceso ? fechaHora.format(new Date(u.ultimo_acceso)) : "Nunca"}</td>
                </tr>
              ))}
              {!filas.length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gris-medio">
                    No hay usuarios que coincidan.
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
        {!id && <p className="panel text-sm text-oliva">Elige un usuario de la lista para ver o cambiar sus datos.</p>}
        {id === "nuevo" && <FormNuevoUsuario roles={roles} empresas={empresas} comedores={comedores} />}
        {id && id !== "nuevo" && !usuario && <p className="alerta-error">El usuario no existe o no tienes acceso.</p>}

        {usuario && (
          <form action={guardarUsuario} className="panel space-y-3">
            <h2 className="font-semibold text-oliva">Datos del usuario</h2>
            <p className="text-sm">
              {usuario.correo} · <EstadoUsuario estado={usuario.estado} />
              {usuario.debe_cambiar_password && <span className="block text-xs text-gris-medio">Debe cambiar su contraseña al ingresar.</span>}
            </p>
            {esPropio && <p className="text-xs text-gris-medio">No puedes cambiar tu propio rol ni tu estado.</p>}
            {protegido && <p className="text-xs text-gris-medio">Solo un Superadmin puede modificar a otro Superadmin.</p>}
            <input type="hidden" name="id" value={usuario.id} />
            {usuario.estado === "pendiente" && <input type="hidden" name="activar" value="1" />}
            <EstadoLista q={q} p={p} f={f} />
            <label className="block">
              <span className="etiqueta">Nombre *</span>
              <input name="nombre" required maxLength={150} defaultValue={usuario.nombre} disabled={!puedeEditar} className="campo" />
            </label>
            {puedeEditar ? (
              <CamposRol
                roles={roles}
                empresas={empresas}
                comedores={comedores}
                rolId={usuario.rol_id ?? ""}
                empresaId={usuario.empresa_id ?? ""}
                comedorId={usuario.comedor_id ?? ""}
              />
            ) : (
              <p className="text-sm">
                Rol: <strong>{usuario.roles?.nombre ?? "sin rol"}</strong>
                {usuario.empresas && <> · {usuario.empresas.nombre_corto}</>}
                {usuario.comedores && <> · {usuario.comedores.nombre}</>}
              </p>
            )}
            {puedeEditar && (
              <div className="flex justify-end">
                <BotonEnviar pendiente="Guardando…">Guardar</BotonEnviar>
              </div>
            )}
          </form>
        )}

        {usuario && puedeEditar && (
          <section className="panel space-y-3">
            <h2 className="font-semibold text-oliva">Acceso</h2>
            {usuario.estado !== "pendiente" && (
              <form action={cambiarEstadoUsuario} className="flex items-center justify-between gap-2">
                <span className="text-sm">{usuario.estado === "activo" ? "La cuenta puede ingresar." : "La cuenta está bloqueada."}</span>
                <input type="hidden" name="id" value={usuario.id} />
                <input type="hidden" name="activo" value={usuario.estado === "activo" ? "0" : "1"} />
                <EstadoLista q={q} p={p} f={f} />
                <BotonEnviar className="btn-secundario">{usuario.estado === "activo" ? "Desactivar" : "Activar"}</BotonEnviar>
              </form>
            )}
            {usuario.estado === "pendiente" && (
              <p className="text-sm text-gris-medio">Asigna un rol y guarda para activar la cuenta.</p>
            )}
            <BotonRestablecer id={usuario.id} />
          </section>
        )}
      </aside>
    </main>
  );
}
