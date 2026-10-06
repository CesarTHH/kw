import type { Metadata } from "next";
import Link from "next/link";
import { Encabezado } from "@/components/Encabezado";
import { iconoMenu } from "@/components/iconos";
import { obtenerMenu, requerirSesion } from "@/lib/auth";
import { menuPrincipal } from "@/lib/permisos";

export const metadata: Metadata = { title: "Menú principal" };

export default async function PaginaMenu() {
  const ctx = await requerirSesion();
  const items = menuPrincipal(await obtenerMenu());

  return (
    <>
      <Encabezado titulo="Menú Principal" ctx={ctx} inicio={false} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        {items.length === 0 ? (
          <p className="text-center text-gris-medio">Tu rol todavía no tiene opciones habilitadas.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-6">
            {items.map((m) => {
              const Icono = iconoMenu(m.icono);
              return (
                <li key={m.codigo}>
                  <Link href={m.ruta ?? "/menu"} className="group flex flex-col items-center gap-3 text-center">
                    <span className="flex size-32 items-center justify-center rounded-full border-4 border-white bg-[#a3a3a3] shadow-lg transition group-hover:bg-marca">
                      <Icono className="size-16 text-white" strokeWidth={1.4} aria-hidden />
                    </span>
                    <span className="max-w-36 font-semibold text-oliva">{m.nombre}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
