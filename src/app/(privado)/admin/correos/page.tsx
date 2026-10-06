import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Historial de correos" };

export default async function Pagina() {
  const ctx = await requerirPermiso("admin.correos");
  return (
    <>
      <Encabezado titulo="Historial de correos" ctx={ctx} />
      <EnConstruccion modulo="Historial de correos" fase={3} />
    </>
  );
}
