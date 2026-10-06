import { notFound, redirect } from "next/navigation";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { hijos } from "@/lib/permisos";

/** Abre la primera pestaña a la que el usuario tiene acceso. */
export default async function Pagina() {
  await requerirPermiso("maestras");
  const primera = hijos(await obtenerMenu(), "maestras").find((m) => m.ruta);
  if (!primera?.ruta) notFound();
  redirect(primera.ruta);
}
