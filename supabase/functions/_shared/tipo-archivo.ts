/**
 * Tipo real de un archivo según su contenido (firma o "magic bytes"), no según
 * la extensión ni el tipo que declara quien lo sube. Sin dependencias: lo usan
 * la app (al subir) y la Edge Function (antes de adjuntarlo a un correo).
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

/** Office (Word/Excel) es un ZIP con [Content_Types].xml y la carpeta word/ o xl/. */
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
