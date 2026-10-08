/**
 * Validación de archivos subidos por su contenido real (firma o "magic bytes"),
 * no por la extensión ni por el tipo que declara el navegador.
 * La detección vive en supabase/functions/_shared para que la Edge Function use la misma.
 */

export { detectarTipo, MIME_DOCX, MIME_XLSX, type TipoArchivo } from "../../supabase/functions/_shared/tipo-archivo";

/** Nombre para mostrar y para la descarga: sin rutas, sin caracteres de control, máximo 150 caracteres. */
export function nombreSeguro(nombre: string, porDefecto = "archivo"): string {
  const base = nombre.split(/[\\/]/).pop() ?? "";
  const limpio = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-150);
  return limpio && limpio !== "." && limpio !== ".." ? limpio : porDefecto;
}

/** 1536 → "1,5 KB" */
export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const corto = (n: number) => n.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  const kb = bytes / 1024;
  return kb < 1024 ? `${corto(kb)} KB` : `${corto(kb / 1024)} MB`;
}

/** Cabecera Content-Disposition segura (RFC 6266) con nombre en UTF-8. */
export function contentDisposition(tipo: "inline" | "attachment", nombre: string): string {
  const seguro = nombreSeguro(nombre, "documento.pdf");
  const ascii = seguro.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/[\\"]/g, "") || "documento.pdf";
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(seguro)}`;
}
