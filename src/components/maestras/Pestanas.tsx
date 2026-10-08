"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type Pestana = { href: string; titulo: string };

/** Pestañas de navegación; resalta la ruta actual y la mantiene visible en pantallas angostas. */
export function Pestanas({ items, etiqueta, exacta = false }: { items: Pestana[]; etiqueta: string; exacta?: boolean }) {
  const ruta = usePathname();
  const lista = useRef<HTMLUListElement>(null);

  useEffect(() => {
    lista.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [ruta]);

  return (
    <nav aria-label={etiqueta} className="bg-white shadow-sm">
      <ul ref={lista} className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 [scrollbar-width:none] sm:px-4">
        {items.map((p) => {
          const activa = ruta === p.href || (!exacta && ruta.startsWith(`${p.href}/`));
          return (
            <li key={p.href} className="shrink-0">
              <Link
                href={p.href}
                aria-current={activa ? "page" : undefined}
                className={`flex min-h-12 items-center border-b-4 px-3 text-sm font-semibold whitespace-nowrap transition-colors sm:px-4 ${
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
