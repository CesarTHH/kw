import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Data maestra" };

export default async function Pagina() {
  const ctx = await requerirPermiso("maestras");
  return (
    <>
      <Encabezado titulo="Data maestra" ctx={ctx} />
      <EnConstruccion modulo="Data maestra" fase={2} />
    </>
  );
}
