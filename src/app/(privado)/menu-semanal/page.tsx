import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Menú semanal" };

export default async function Pagina() {
  const ctx = await requerirPermiso("menu_semanal");
  return (
    <>
      <Encabezado titulo="Menú semanal" ctx={ctx} />
      <EnConstruccion modulo="Menú semanal" fase={6} />
    </>
  );
}
