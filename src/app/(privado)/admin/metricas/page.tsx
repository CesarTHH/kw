import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Métricas de uso" };

export default async function Pagina() {
  const ctx = await requerirPermiso("admin.metricas");
  return (
    <>
      <Encabezado titulo="Métricas de uso" ctx={ctx} />
      <EnConstruccion modulo="Métricas de uso" fase={7} />
    </>
  );
}
