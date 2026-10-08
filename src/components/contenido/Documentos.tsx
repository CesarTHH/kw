import { Download, ExternalLink, FileText } from "lucide-react";
import { publicarDocumento, restaurarDocumento } from "@/app/(privado)/documentos/acciones";
import { BotonEnviar } from "@/components/BotonEnviar";
import { tamanoLegible } from "@/lib/archivos";
import { TIPOS_DOCUMENTO, type Documento, type TipoDocumento } from "@/lib/contenido/tipos";
import { fechaHora } from "@/lib/fechas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * Documentos PDF publicados: visor, descarga y, para quien puede editar,
 * publicación de una versión nueva e historial de versiones.
 */
export async function Documentos({
  tipos,
  editar,
  visor,
  zona,
  maxBytes,
}: {
  tipos: TipoDocumento[];
  editar: boolean;
  visor: boolean;
  zona: string;
  maxBytes: number;
}) {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from("documentos")
    .select("id, tipo, version, titulo, nombre_archivo, tamano, vigente, created_at")
    .in("tipo", tipos)
    .order("version", { ascending: false })
    .limit(200);
  const docs = (data ?? []) as Documento[];

  return (
    <div className={visor ? "grid gap-6 xl:grid-cols-2" : "grid gap-6 md:grid-cols-2"}>
      {tipos.map((tipo) => {
        const vigente = docs.find((d) => d.tipo === tipo && d.vigente);
        const historial = docs.filter((d) => d.tipo === tipo);
        return (
          <section key={tipo} id={tipo} className="panel space-y-3 scroll-mt-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-oliva">
              <FileText className="size-5 text-marca" aria-hidden />
              {TIPOS_DOCUMENTO[tipo].nombre}
            </h2>
            {vigente ? (
              <>
                <p className="text-sm">
                  <strong>{vigente.titulo}</strong>
                  <span className="text-gris-medio"> · publicado el {fechaHora(vigente.created_at, zona)}</span>
                </p>
                {visor && (
                  <iframe
                    src={`/api/archivos/${vigente.id}`}
                    title={`${TIPOS_DOCUMENTO[tipo].nombre}: ${vigente.titulo}`}
                    className="h-[70vh] min-h-96 w-full rounded border border-gris-medio/40 bg-white"
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/archivos/${vigente.id}?descargar=1`} className="btn-marca">
                    <Download className="size-4" aria-hidden /> Descargar PDF
                  </a>
                  <a href={`/api/archivos/${vigente.id}`} target="_blank" rel="noopener" className="btn-secundario">
                    <ExternalLink className="size-4" aria-hidden /> Abrir en otra pestaña
                  </a>
                </div>
              </>
            ) : (
              <p className="text-sm text-gris-medio">Todavía no se ha publicado este documento.</p>
            )}

            {editar && (
              <details className="rounded border border-gris-medio/30 p-3" open={!vigente}>
                <summary className="cursor-pointer font-semibold text-oliva">Publicar una nueva versión</summary>
                <form action={publicarDocumento} className="mt-3 space-y-3">
                  <input type="hidden" name="tipo" value={tipo} />
                  <label className="block">
                    <span className="etiqueta">Título que verán los usuarios</span>
                    <input
                      name="titulo"
                      required
                      maxLength={120}
                      defaultValue={vigente?.titulo ?? ""}
                      placeholder={tipo.startsWith("menu_") ? "Menú del 12 al 18 de octubre" : TIPOS_DOCUMENTO[tipo].nombre}
                      className="campo"
                    />
                  </label>
                  <label className="block">
                    <span className="etiqueta">Archivo PDF (máximo {tamanoLegible(maxBytes)})</span>
                    <input name="archivo" type="file" accept="application/pdf,.pdf" required className="campo" />
                  </label>
                  <p className="text-xs text-gris-medio">La versión anterior queda guardada en el historial y se puede volver a publicar.</p>
                  <div className="flex justify-end">
                    <BotonEnviar pendiente="Publicando…">Publicar</BotonEnviar>
                  </div>
                </form>

                {historial.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="tabla w-full text-sm">
                      <caption className="mb-1 text-left font-semibold text-oliva">Historial de versiones</caption>
                      <thead>
                        <tr>
                          <th>Versión</th>
                          <th>Título</th>
                          <th>Archivo</th>
                          <th>Publicado</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {historial.map((d) => (
                          <tr key={d.id}>
                            <td>v{d.version}</td>
                            <td>{d.titulo}</td>
                            <td>
                              <a href={`/api/archivos/${d.id}?descargar=1`} className="text-oliva underline">
                                {d.nombre_archivo}
                              </a>{" "}
                              <span className="text-xs text-gris-medio">({tamanoLegible(d.tamano)})</span>
                            </td>
                            <td className="whitespace-nowrap">{fechaHora(d.created_at, zona)}</td>
                            <td>
                              {d.vigente ? (
                                <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Vigente</span>
                              ) : (
                                <form action={restaurarDocumento}>
                                  <input type="hidden" name="tipo" value={tipo} />
                                  <input type="hidden" name="id" value={d.id} />
                                  <BotonEnviar className="btn-secundario px-2 py-1 text-xs" pendiente="…">
                                    Volver a publicar
                                  </BotonEnviar>
                                </form>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
