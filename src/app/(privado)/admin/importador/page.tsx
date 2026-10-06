import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Importar Excel" };

export default async function Pagina() {
  const ctx = await requerirPermiso("admin.importador");
  return (
    <>
      <Encabezado titulo="Importar Excel" ctx={ctx} />
      <EnConstruccion modulo="Importar Excel" fase={7} />
    </>
  );
}
