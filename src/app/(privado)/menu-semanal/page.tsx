import type { Metadata } from "next";
import { Documentos } from "@/components/contenido/Documentos";
import { Encabezado } from "@/components/Encabezado";
import { Avisos } from "@/components/maestras/Avisos";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { leerConfig, numero, zonaHoraria } from "@/lib/contenido/servidor";
import { puede } from "@/lib/permisos";

export const metadata: Metadata = { title: "Menú semanal" };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [ctx, menu, { ok, error }, zona, config] = await Promise.all([
    requerirPermiso("menu_semanal"),
    obtenerMenu(),
    searchParams,
    zonaHoraria(),
    leerConfig(["archivos.pdf_menu_max_bytes"]),
  ]);
  const editar = puede(menu, "menu_semanal", "editar");
  return (
    <>
      <Encabezado titulo="Menú semanal" ctx={ctx} />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-6">
        <Avisos ok={ok} error={error} />
        <Documentos
          tipos={["menu_1", "menu_2"]}
          editar={editar}
          visor
          zona={zona}
          maxBytes={numero(config.get("archivos.pdf_menu_max_bytes"), 1_048_576)}
        />
      </main>
    </>
  );
}
