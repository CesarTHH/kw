import type { Metadata } from "next";
import { Documentos } from "@/components/contenido/Documentos";
import { Encabezado } from "@/components/Encabezado";
import { Avisos } from "@/components/maestras/Avisos";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { leerConfig, numero, zonaHoraria } from "@/lib/contenido/servidor";
import { puede } from "@/lib/permisos";

export const metadata: Metadata = { title: "Manual, términos y condiciones" };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const ctx = await requerirPermiso("manual_tyc");
  const editar = puede(await obtenerMenu(), "manual_tyc", "editar");
  const { ok, error } = await searchParams;
  const [zona, config] = await Promise.all([zonaHoraria(), leerConfig(["archivos.documento_max_bytes"])]);
  return (
    <>
      <Encabezado titulo="Manual, términos y condiciones" ctx={ctx} />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-6">
        <Avisos ok={ok} error={error} />
        <Documentos
          tipos={["terminos", "manual"]}
          editar={editar}
          visor={false}
          zona={zona}
          maxBytes={numero(config.get("archivos.documento_max_bytes"), 10_485_760)}
        />
      </main>
    </>
  );
}
