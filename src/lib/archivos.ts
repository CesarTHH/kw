/**
 * Validación de archivos subidos por su contenido real (firma o "magic bytes"),
 * no por la extensión ni por el tipo que declara el navegador.
 */

export type TipoArchivo = { mime: string; ext: "pdf" | "png" | "jpg" | "xlsx" | "docx" };

export const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const empieza = (b: Uint8Array, firma: number[]) => firma.every((x, i) => b[i] === x);

function contieneTexto(b: Uint8Array, texto: string): boolean {
  const t = new TextEncoder().encode(texto);
  outer: for (let i = 0; i + t.length <= b.length; i++) {
    for (let j = 0; j < t.length; j++) if (b[i + j] !== t[j]) continue outer;
    return true;
  }
  return false;
}

/** Tipo real del archivo según sus primeros bytes (Office: ZIP con la carpeta word/ o xl/). */
export function detectarTipo(b: Uint8Array): TipoArchivo | null {
  if (b.length < 8) return null;
  if (empieza(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf" }; // %PDF-
  if (empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (empieza(b, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (empieza(b, [0x50, 0x4b, 0x03, 0x04]) && contieneTexto(b, "[Content_Types].xml")) {
    if (contieneTexto(b, "word/")) return { mime: MIME_DOCX, ext: "docx" };
    if (contieneTexto(b, "xl/")) return { mime: MIME_XLSX, ext: "xlsx" };
  }
  return null;
}

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
