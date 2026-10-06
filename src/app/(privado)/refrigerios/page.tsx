import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Solicitud de refrigerios" };

export default async function Pagina() {
  const ctx = await requerirPermiso("refrigerios");
  return (
    <>
      <Encabezado titulo="Solicitud de refrigerios" ctx={ctx} />
      <EnConstruccion modulo="Solicitud de refrigerios" fase={5} />
    </>
  );
}
