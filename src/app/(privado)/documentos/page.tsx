import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Manual, términos y condiciones" };

export default async function Pagina() {
  const ctx = await requerirPermiso("manual_tyc");
  return (
    <>
      <Encabezado titulo="Manual, términos y condiciones" ctx={ctx} />
      <EnConstruccion modulo="Manual, términos y condiciones" fase={6} />
    </>
  );
}
