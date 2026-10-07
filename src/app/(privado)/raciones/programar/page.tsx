import type { Metadata } from "next";
import { Programar } from "@/components/raciones/Programar";
import { SinEmpresa } from "@/components/raciones/SinEmpresa";
import { requerirPermiso } from "@/lib/auth";
import { contextoRaciones, empresaSeleccionada, leerBorrador } from "@/lib/raciones/servidor";

export const metadata: Metadata = { title: "Programa tus raciones" };

export default async function Pagina() {
  const ctx = await requerirPermiso("raciones.programar", "enviar");
  const empresa = await empresaSeleccionada(ctx);
  if (!empresa) return <SinEmpresa />;
  const [datos, borrador] = await Promise.all([contextoRaciones(ctx, empresa), leerBorrador(empresa.id, "programar")]);
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      {datos.catalogo.frentes.length === 0 ? (
        <p className="panel text-oliva">La empresa no tiene frentes de trabajo vigentes. Comunícate con el administrador.</p>
      ) : (
        <Programar key={empresa.id} ctx={datos} borrador={borrador} />
      )}
    </main>
  );
}
