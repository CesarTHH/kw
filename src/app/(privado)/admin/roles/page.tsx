import type { Metadata } from "next";
import Link from "next/link";
import { BotonEnviar } from "@/components/BotonEnviar";
import { Encabezado } from "@/components/Encabezado";
import { esSuperadmin, requerirPermiso } from "@/lib/auth";
import { ACCIONES } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { cambiarEstadoRol, cambiarMfaRol, crearRol, guardarPermisos } from "./acciones";

export const metadata: Metadata = { title: "Roles y permisos" };

type Rol = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  alcance: "empresa" | "todas" | "comedor";
  requiere_mfa: boolean;
  es_sistema: boolean;
  activo: boolean;
};
type Menu = { codigo: string; padre_codigo: string | null; nombre: string; orden: number; acciones_disponibles: string[] };
type Permiso = { menu_codigo: string; acciones: string[] };

const ALCANCES: Record<Rol["alcance"], string> = {
  empresa: "Solo su empresa",
  todas: "Todas las empresas",
  comedor: "Todas las empresas, filtrado por su comedor",
};

const MENSAJES: Record<string, string> = {
  permisos: "Permisos guardados.",
  creado: "Rol creado. Ahora asígnale permisos.",
  estado: "Estado del rol actualizado.",
  permiso: "Solo el Superadmin puede hacer cambios aquí.",
  datos: "Revisa los datos ingresados.",
  duplicado: "Ya existe un rol con ese código.",
  guardar: "No se pudo guardar. Inténtalo de nuevo.",
};

export default async function PaginaRoles({
  searchParams,
}: {
  searchParams: Promise<{ rol?: string; ok?: string; error?: string }>;
}) {
  const ctx = await requerirPermiso("admin.roles");
  const editable = esSuperadmin(ctx);
  const { rol: rolParam, ok, error } = await searchParams;
  const supabase = await crearClienteServidor();

  const [{ data: rolesData }, { data: menusData }] = await Promise.all([
    supabase.from("roles").select("id, codigo, nombre, descripcion, alcance, requiere_mfa, es_sistema, activo").order("es_sistema", { ascending: false }).order("nombre"),
    supabase.from("menus").select("codigo, padre_codigo, nombre, orden, acciones_disponibles").eq("activo", true).order("orden"),
  ]);
  const roles = (rolesData ?? []) as Rol[];
  const menus = (menusData ?? []) as Menu[];
  const actual = roles.find((r) => r.id === rolParam) ?? roles[0];

  let permisos: Permiso[] = [];
  if (actual) {
    const { data } = await supabase.from("rol_permisos").select("menu_codigo, acciones").eq("rol_id", actual.id);
    permisos = (data ?? []) as Permiso[];
  }
  const tiene = (menu: string, accion: string) =>
    permisos.some((p) => p.menu_codigo === menu && p.acciones.includes(accion));

  return (
    <>
      <Encabezado titulo="Roles y permisos" ctx={ctx} />
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-4">
          <nav className="panel p-3" aria-label="Roles">
            <ul className="space-y-1">
              {roles.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/admin/roles?rol=${r.id}`}
                    aria-current={r.id === actual?.id ? "page" : undefined}
                    className={`flex items-center justify-between rounded px-3 py-2 text-sm ${
                      r.id === actual?.id ? "bg-marca font-semibold text-white" : "hover:bg-white"
                    }`}
                  >
                    <span>{r.nombre}</span>
                    {!r.activo && <span className="text-xs opacity-80">inactivo</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {editable && (
            <form action={crearRol} className="panel space-y-3">
              <h2 className="font-semibold text-oliva">Nuevo rol</h2>
              <label className="block">
                <span className="etiqueta">Código *</span>
                <input name="codigo" required pattern="[a-z][a-z0-9_]{1,40}" placeholder="ej. jefe_comedor" className="campo" />
              </label>
              <label className="block">
                <span className="etiqueta">Nombre *</span>
                <input name="nombre" required maxLength={60} className="campo" />
              </label>
              <label className="block">
                <span className="etiqueta">Descripción</span>
                <input name="descripcion" maxLength={300} className="campo" />
              </label>
              <label className="block">
                <span className="etiqueta">Alcance *</span>
                <select name="alcance" required className="campo">
                  {Object.entries(ALCANCES).map(([v, t]) => (
                    <option key={v} value={v}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="requiere_mfa" /> Exigir verificación en dos pasos
              </label>
              <BotonEnviar pendiente="Creando…">Crear rol</BotonEnviar>
            </form>
          )}
        </aside>

        <section className="space-y-4">
          {ok && MENSAJES[ok] && <p className="alerta-ok">{MENSAJES[ok]}</p>}
          {error && MENSAJES[error] && <p role="alert" className="alerta-error">{MENSAJES[error]}</p>}

          {actual && (
            <>
              <div className="panel flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-oliva">{actual.nombre}</h2>
                  <p className="text-sm text-gris-medio">
                    {ALCANCES[actual.alcance]}
                    {actual.requiere_mfa && " · Exige verificación en dos pasos"}
                    {actual.es_sistema && " · Rol del sistema"}
                  </p>
                  {actual.descripcion && <p className="mt-1 text-sm">{actual.descripcion}</p>}
                </div>
                {editable && actual.codigo !== "superadmin" && (
                  <div className="flex flex-wrap gap-2">
                    <form action={cambiarMfaRol}>
                      <input type="hidden" name="rolId" value={actual.id} />
                      <input type="hidden" name="requiere_mfa" value={actual.requiere_mfa ? "0" : "1"} />
                      <BotonEnviar className="btn-secundario">
                        {actual.requiere_mfa ? "No exigir dos pasos" : "Exigir dos pasos"}
                      </BotonEnviar>
                    </form>
                    <form action={cambiarEstadoRol}>
                      <input type="hidden" name="rolId" value={actual.id} />
                      <input type="hidden" name="activo" value={actual.activo ? "0" : "1"} />
                      <BotonEnviar className="btn-secundario">{actual.activo ? "Desactivar rol" : "Activar rol"}</BotonEnviar>
                    </form>
                  </div>
                )}
              </div>

              {actual.codigo === "superadmin" ? (
                <p className="panel">El Superadmin tiene acceso a todas las opciones y es el único que puede registrar fuera de plazo.</p>
              ) : (
                <form action={guardarPermisos} className="overflow-x-auto rounded-xl bg-white shadow">
                  <input type="hidden" name="rolId" value={actual.id} />
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th scope="col">Menú / pestaña</th>
                        {ACCIONES.map((a) => (
                          <th key={a} scope="col" className="text-center! capitalize">{a}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {menus.map((m) => (
                        <tr key={m.codigo}>
                          <th scope="row" className={`bg-transparent! text-neutral-800! ${m.padre_codigo ? "pl-8! font-normal!" : "font-semibold!"}`}>
                            {m.nombre}
                          </th>
                          {ACCIONES.map((a) => (
                            <td key={a} className="text-center">
                              {m.acciones_disponibles.includes(a) && (
                                <input
                                  type="checkbox"
                                  name="p"
                                  value={`${m.codigo}|${a}`}
                                  defaultChecked={tiene(m.codigo, a)}
                                  disabled={!editable}
                                  aria-label={`${m.nombre}: ${a}`}
                                  className="size-4 accent-marca"
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {editable && (
                    <div className="flex justify-end p-4">
                      <BotonEnviar pendiente="Guardando…">Guardar permisos</BotonEnviar>
                    </div>
                  )}
                </form>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
