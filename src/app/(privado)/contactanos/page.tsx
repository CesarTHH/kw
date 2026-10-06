import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Contáctanos" };

export default async function Pagina() {
  const ctx = await requerirPermiso("contactanos");
  return (
    <>
      <Encabezado titulo="Contáctanos" ctx={ctx} />
      <EnConstruccion modulo="Contáctanos" fase={6} />
    </>
  );
}
