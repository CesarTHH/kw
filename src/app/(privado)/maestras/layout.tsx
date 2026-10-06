import { Encabezado } from "@/components/Encabezado";
import { Pestanas } from "@/components/maestras/Pestanas";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { hijos } from "@/lib/permisos";

export default async function LayoutMaestras({ children }: { children: React.ReactNode }) {
  const ctx = await requerirPermiso("maestras");
  const pestanas = hijos(await obtenerMenu(), "maestras")
    .filter((m) => m.ruta)
    .map((m) => ({ href: m.ruta!, titulo: m.nombre }));
  return (
    <>
      <Encabezado titulo="Tablas maestras" ctx={ctx} />
      <Pestanas items={pestanas} etiqueta="Tablas maestras" />
      {children}
    </>
  );
}
