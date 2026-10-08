import Link from "next/link";
import { House, LogOut } from "lucide-react";
import type { Contexto } from "@/lib/auth";
import { Logo } from "./Logo";

/** Barra naranja superior de todas las pantallas con sesión. */
export function Encabezado({ titulo, ctx, inicio = true }: { titulo: string; ctx: Contexto; inicio?: boolean }) {
  return (
    <header className="sticky top-0 z-30 bg-marca text-white shadow">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-4">
        <Link href="/menu" className="shrink-0 rounded-lg p-1 hover:bg-white/10" aria-label="KW Catering · menú principal">
          <Logo />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold sm:text-lg">{titulo}</h1>
        <div className="hidden min-w-0 max-w-64 text-right text-sm leading-tight md:block">
          {ctx.empresa_nombre && <p className="truncate font-semibold">{ctx.empresa_nombre}</p>}
          <p className="truncate opacity-90">{ctx.nombre}</p>
        </div>
        <nav aria-label="Sesión" className="flex shrink-0 items-center gap-1">
          {inicio && (
            <Link
              href="/menu"
              title="Menú principal"
              aria-label="Ir al menú principal"
              className="inline-flex size-11 items-center justify-center rounded-lg transition hover:bg-white/15"
            >
              <House className="size-7" strokeWidth={1.6} aria-hidden />
            </Link>
          )}
          <form action="/salir" method="post">
            <button
              type="submit"
              title={`Cerrar sesión (${ctx.nombre})`}
              aria-label="Cerrar sesión"
              className="inline-flex size-11 items-center justify-center rounded-lg transition hover:bg-white/15"
            >
              <LogOut className="size-7" strokeWidth={1.6} aria-hidden />
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
