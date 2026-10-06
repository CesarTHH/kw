import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Gestión de raciones" };

export default async function Pagina() {
  const ctx = await requerirPermiso("raciones");
  return (
    <>
      <Encabezado titulo="Gestión de raciones" ctx={ctx} />
      <EnConstruccion modulo="Gestión de raciones" fase={4} />
    </>
  );
}
