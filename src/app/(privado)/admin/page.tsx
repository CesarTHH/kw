import type { Metadata } from "next";
import Link from "next/link";
import { Encabezado } from "@/components/Encabezado";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { hijos } from "@/lib/permisos";

export const metadata: Metadata = { title: "Administración" };

export default async function PaginaAdmin() {
  const ctx = await requerirPermiso("admin");
  const opciones = hijos(await obtenerMenu(), "admin");
  return (
    <>
      <Encabezado titulo="Administración" ctx={ctx} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <ul className="grid gap-4 sm:grid-cols-2">
          {opciones.map((o) => (
            <li key={o.codigo}>
              <Link href={o.ruta ?? "/admin"} className="block rounded-xl bg-oliva-claro p-6 text-lg font-semibold text-white shadow hover:bg-oliva">
                {o.nombre}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
