import Link from "next/link";
import { House, LogOut } from "lucide-react";
import type { Contexto } from "@/lib/auth";
import { Logo } from "./Logo";

/** Barra naranja superior de todas las pantallas con sesión. */
export function Encabezado({ titulo, ctx, inicio = true }: { titulo: string; ctx: Contexto; inicio?: boolean }) {
  return (
    <header className="flex items-center gap-4 bg-marca px-4 py-3 text-white shadow md:px-6">
      <Logo />
      <h1 className="flex-1 truncate text-lg font-semibold">{titulo}</h1>
      <div className="hidden text-right text-sm leading-tight sm:block">
        {ctx.empresa_nombre && <p className="font-semibold">{ctx.empresa_nombre}</p>}
        <p className="opacity-90">{ctx.nombre}</p>
      </div>
      {inicio && (
        <Link href="/menu" aria-label="Ir al menú principal" className="rounded p-1 hover:bg-white/15">
          <House className="size-8" strokeWidth={1.5} />
        </Link>
      )}
      <form action="/salir" method="post">
        <button type="submit" aria-label="Cerrar sesión" className="rounded p-1 hover:bg-white/15">
          <LogOut className="size-8" strokeWidth={1.5} />
        </button>
      </form>
    </header>
  );
}
