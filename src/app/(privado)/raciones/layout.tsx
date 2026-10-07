import { Encabezado } from "@/components/Encabezado";
import { Pestanas } from "@/components/maestras/Pestanas";
import { SelectorEmpresa } from "@/components/raciones/SelectorEmpresa";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { hijos } from "@/lib/permisos";
import { empresaSeleccionada, empresasParaSelector } from "@/lib/raciones/servidor";

export default async function LayoutRaciones({ children }: { children: React.ReactNode }) {
  const ctx = await requerirPermiso("raciones");
  const menu = await obtenerMenu();
  const pestanas = hijos(menu, "raciones")
    .filter((m) => m.ruta)
    .map((m) => ({ href: m.ruta!, titulo: m.nombre }));
  const [empresa, empresas] = await Promise.all([
    empresaSeleccionada(ctx),
    ctx.alcance === "todas" ? empresasParaSelector() : Promise.resolve([]),
  ]);
  return (
    <>
      <Encabezado titulo="Gestiona tus raciones" ctx={ctx} />
      <Pestanas items={pestanas} etiqueta="Gestiona tus raciones" exacta />
      {ctx.alcance === "todas" && (
        <div className="border-b border-gris-medio/30 bg-gris-panel/60">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2">
            <SelectorEmpresa empresas={empresas} actual={empresa?.id ?? null} />
            {!empresa && <span className="text-xs text-gris-medio">Sin empresa elegida, el dashboard y la consulta muestran todas.</span>}
          </div>
        </div>
      )}
      {children}
    </>
  );
}
