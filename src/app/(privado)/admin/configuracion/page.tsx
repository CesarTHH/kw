import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Configuración y horarios" };

export default async function Pagina() {
  const ctx = await requerirPermiso("admin.configuracion");
  return (
    <>
      <Encabezado titulo="Configuración y horarios" ctx={ctx} />
      <EnConstruccion modulo="Configuración y horarios" fase={2} />
    </>
  );
}
