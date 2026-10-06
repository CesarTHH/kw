import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Auditoría" };

export default async function Pagina() {
  const ctx = await requerirPermiso("admin.auditoria");
  return (
    <>
      <Encabezado titulo="Auditoría" ctx={ctx} />
      <EnConstruccion modulo="Auditoría" fase={7} />
    </>
  );
}
