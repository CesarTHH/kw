import type { Metadata } from "next";
import { Encabezado } from "@/components/Encabezado";
import { SelectorEmpresa } from "@/components/raciones/SelectorEmpresa";
import { Refrigerios } from "@/components/refrigerios/Refrigerios";
import { esSuperadmin, obtenerMenu, requerirPermiso } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { configPlazos, empresaSeleccionada, empresasParaSelector, horaOficial } from "@/lib/raciones/servidor";
import type { PedidoBorrador, Precios } from "@/lib/refrigerios/tipos";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Solicitud de refrigerios" };

const PRECIOS_VACIOS: Precios = { estandar_precio: null, estandar_items: [], productos: [] };

export default async function Pagina() {
  const ctx = await requerirPermiso("refrigerios");
  const menu = await obtenerMenu();
  const [empresa, empresas] = await Promise.all([
    empresaSeleccionada(ctx),
    ctx.alcance === "todas" ? empresasParaSelector() : Promise.resolve([]),
  ]);

  return (
    <>
      <Encabezado titulo="Solicitud de refrigerios" ctx={ctx} />
      {ctx.alcance === "todas" && (
        <div className="border-b border-gris-medio/30 bg-gris-panel/60">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2">
            <SelectorEmpresa empresas={empresas} actual={empresa?.id ?? null} />
          </div>
        </div>
      )}
      {empresa ? (
        <Contenido
          empresa={{ id: empresa.id, nombre: empresa.nombre }}
          superadmin={esSuperadmin(ctx)}
          enviar={puede(menu, "refrigerios", "enviar")}
        />
      ) : (
        <main className="mx-auto mt-12 max-w-md px-4">
          <p className="panel text-center text-oliva">
            {ctx.alcance === "todas"
              ? "Elige una empresa en el selector de arriba para solicitar refrigerios a su nombre."
              : "Tu usuario no está asociado a una empresa contratista, por eso no puede solicitar refrigerios."}
          </p>
        </main>
      )}
    </>
  );
}

async function Contenido({ empresa, superadmin, enviar }: { empresa: { id: string; nombre: string }; superadmin: boolean; enviar: boolean }) {
  const supabase = await crearClienteServidor();
  const [comedoresR, turnosR, preciosR, borradorR, config, ahora] = await Promise.all([
    supabase.from("comedores").select("id, nombre").eq("activo", true).eq("habilitado_refrigerios", true).order("nombre"),
    supabase.from("refrigerio_turnos").select("id, etiqueta").eq("activo", true).order("hora"),
    supabase.rpc("precios_refrigerio"),
    supabase.from("borradores").select("filas").eq("empresa_id", empresa.id).eq("modulo", "refrigerios").maybeSingle(),
    configPlazos(),
    horaOficial(),
  ]);
  const comedores = (comedoresR.data ?? []) as { id: string; nombre: string }[];
  const turnos = (turnosR.data ?? []) as { id: string; etiqueta: string }[];
  const precios = ((preciosR.data as unknown as Precios | null) ?? PRECIOS_VACIOS) as Precios;
  const filas = (borradorR.data as { filas?: unknown } | null)?.filas;
  const borrador = Array.isArray(filas) ? (filas as PedidoBorrador[]) : [];

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      {comedores.length === 0 || turnos.length === 0 ? (
        <p className="panel text-oliva">
          Aún no hay comedores habilitados para refrigerios o turnos de entrega activos. Comunícate con el administrador.
        </p>
      ) : (
        <Refrigerios
          key={empresa.id}
          datos={{ empresa, comedores, turnos, precios, config, ahora, superadmin, enviar }}
          borrador={borrador}
        />
      )}
    </main>
  );
}
