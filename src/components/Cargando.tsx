/** Esqueleto que se muestra al instante mientras llega la página (se siente más rápida). */
export function Cargando({ encabezado = true }: { encabezado?: boolean }) {
  return (
    <div className="flex flex-1 flex-col" aria-busy="true" aria-live="polite">
      {encabezado && (
        <div className="flex h-16 items-center gap-4 bg-marca px-4 shadow md:px-6">
          <span className="size-10 rounded-full bg-white/30" />
          <span className="h-5 w-48 rounded bg-white/30" />
        </div>
      )}
      <div className="mx-auto w-full max-w-7xl flex-1 animate-pulse space-y-4 px-4 py-6">
        <div className="h-24 rounded-xl bg-white/70" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="h-32 rounded-xl bg-white/70" />
          <div className="h-32 rounded-xl bg-white/70" />
          <div className="h-32 rounded-xl bg-white/70" />
        </div>
        <div className="h-64 rounded-xl bg-white/70" />
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
