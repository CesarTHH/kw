/**
 * Logotipo provisional en texto. Para usar el logo oficial, coloca el archivo
 * en public/logo-kw.png y reemplaza este componente por <Image src="/logo-kw.png" … />.
 */
export function Logo({ grande = false }: { grande?: boolean }) {
  return (
    <div className="flex flex-col items-center leading-none text-white" aria-label="KW Catering">
      <span className={grande ? "font-serif text-6xl tracking-wide" : "font-serif text-2xl tracking-wide"}>KW</span>
      <span className={grande ? "mt-2 text-sm tracking-[0.5em]" : "text-[0.55rem] tracking-[0.4em]"}>CATERING</span>
    </div>
  );
}
