/** Exportación a CSV compatible con Excel (UTF-8 con BOM y separador ";"). */

export type ColumnaCsv<T> = { titulo: string; valor: (fila: T) => unknown };

/**
 * Escapa una celda. Si empieza con = + - @ (o tabulador / retorno), Excel la
 * interpretaría como fórmula: se antepone un apóstrofo (inyección de fórmulas).
 */
export function celdaCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  let texto =
    typeof valor === "boolean" ? (valor ? "Sí" : "No") : valor instanceof Date ? valor.toISOString() : String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  if (/[";\n\r]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

export function aCsv<T>(filas: readonly T[], columnas: readonly ColumnaCsv<T>[]): string {
  const lineas = [columnas.map((c) => celdaCsv(c.titulo)).join(";")];
  for (const f of filas) lineas.push(columnas.map((c) => celdaCsv(c.valor(f))).join(";"));
  return "﻿" + lineas.join("\r\n") + "\r\n";
}
