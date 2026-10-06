import Link from "next/link";
import { TAMANO_PAGINA, urlCon } from "@/lib/busqueda";

/** Paginación simple: anterior / siguiente y el total de registros. */
export function Paginacion({
  base,
  params,
  pagina,
  total,
  tamano = TAMANO_PAGINA,
}: {
  base: string;
  params: Record<string, string | undefined>;
  pagina: number;
  total: number;
  tamano?: number;
}) {
  const paginas = Math.max(1, Math.ceil(total / tamano));
  const desde = total === 0 ? 0 : (pagina - 1) * tamano + 1;
  const hasta = Math.min(total, pagina * tamano);
  return (
    <div className="flex items-center justify-between gap-2 px-1 text-sm text-gris-medio">
      <span>
        {desde}–{hasta} de {total}
      </span>
      <span className="flex gap-2">
        {pagina > 1 ? (
          <Link className="btn-secundario px-3! py-1!" href={urlCon(base, { ...params, p: pagina - 1 })}>
            Anterior
          </Link>
        ) : null}
        {pagina < paginas ? (
          <Link className="btn-secundario px-3! py-1!" href={urlCon(base, { ...params, p: pagina + 1 })}>
            Siguiente
          </Link>
        ) : null}
      </span>
    </div>
  );
}
