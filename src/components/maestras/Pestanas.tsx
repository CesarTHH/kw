"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type Pestana = { href: string; titulo: string };

/** Pestañas de navegación; resalta la ruta actual. */
export function Pestanas({ items, etiqueta, exacta = false }: { items: Pestana[]; etiqueta: string; exacta?: boolean }) {
  const ruta = usePathname();
  return (
    <nav aria-label={etiqueta} className="overflow-x-auto bg-white shadow-sm">
      <ul className="mx-auto flex max-w-7xl gap-1 px-4">
        {items.map((p) => {
          const activa = ruta === p.href || (!exacta && ruta.startsWith(`${p.href}/`));
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                aria-current={activa ? "page" : undefined}
                className={`block whitespace-nowrap border-b-4 px-4 py-3 text-sm font-semibold ${
                  activa ? "border-marca text-marca" : "border-transparent text-oliva hover:border-gris-medio"
                }`}
              >
                {p.titulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
