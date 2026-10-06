import type { Metadata } from "next";
import { EnConstruccion } from "@/components/EnConstruccion";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";

export const metadata: Metadata = { title: "Alertas post-login" };

export default async function Pagina() {
  const ctx = await requerirPermiso("admin.alertas");
  return (
    <>
      <Encabezado titulo="Alertas post-login" ctx={ctx} />
      <EnConstruccion modulo="Alertas post-login" fase={6} />
    </>
  );
}
