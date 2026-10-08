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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-12">
        {items.length === 0 ? (
          <p className="text-center text-gris-medio">Tu rol todavía no tiene opciones habilitadas.</p>
        ) : (
          <ul className="mx-auto grid max-w-5xl grid-cols-2 justify-items-center gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-12 lg:grid-cols-4 xl:grid-cols-6">
            {items.map((m) => {
              const Icono = iconoMenu(m.icono);
              return (
                <li key={m.codigo} className="w-full">
                  <Link
                    href={m.ruta ?? "/menu"}
                    className="group flex flex-col items-center gap-3 rounded-2xl p-2 text-center outline-offset-4"
                  >
                    <span className="flex size-24 items-center justify-center rounded-full border-4 border-white bg-[#a3a3a3] shadow-lg transition duration-200 group-hover:-translate-y-1 group-hover:bg-marca group-hover:shadow-xl group-active:scale-95 sm:size-32">
                      <Icono className="size-11 shrink-0 text-white sm:size-16" strokeWidth={1.4} aria-hidden />
                    </span>
                    <span className="max-w-40 text-sm leading-snug font-semibold text-balance text-oliva sm:text-base">{m.nombre}</span>
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
