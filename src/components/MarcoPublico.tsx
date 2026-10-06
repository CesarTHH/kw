import { Logo } from "./Logo";

/** Fondo naranja de las pantallas sin sesión (login, registro, recuperación). */
export function MarcoPublico({ children, version = true }: { children: React.ReactNode; version?: boolean }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-marca px-4 py-10">
      {/* Formas decorativas, como en la app actual */}
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full border-[14px] border-white/25" />
      <div aria-hidden className="pointer-events-none absolute -bottom-10 left-10 h-72 w-40 rotate-12 border-[10px] border-white/20 [clip-path:polygon(0_0,100%_0,50%_100%)]" />
      <div aria-hidden className="pointer-events-none absolute -right-32 top-0 hidden h-full w-1/3 skew-x-[-12deg] bg-oliva/20 md:block" />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-6">
        <Logo grande />
        {children}
      </div>

      {version && <p className="absolute bottom-3 left-4 text-sm font-semibold text-white">v 3.0.0</p>}
    </main>
  );
}
