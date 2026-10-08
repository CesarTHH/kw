/** Lectura de CSV y reglas de limpieza del importador (ver docs/MAPEO_MIGRACION.md, sección 1). */

/** CSV con comillas (RFC 4180), separador "," o ";" detectado en la cabecera, sin BOM. */
export function leerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primera = t.slice(0, t.search(/\r?\n/) >>> 0 || t.length);
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (comillas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          celda += '"';
          i++;
        } else comillas = false;
      } else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(celda);
      celda = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += c;
  }
  if (celda !== "" || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((x) => x.trim() !== ""));
}

/** Filas de un CSV como objetos por nombre de columna (cabecera limpia). */
export function csvComoObjetos(texto: string): { cabecera: string[]; filas: Record<string, string>[] } {
  const [cab = [], ...resto] = leerCsv(texto);
  const cabecera = cab.map((c) => limpiar(c));
  return {
    cabecera,
    filas: resto.map((f) => Object.fromEntries(cabecera.map((c, i) => [c, f[i] ?? ""]))),
  };
}

/** Quita espacios al inicio y al final (también los especiales) y une los dobles. */
export function limpiar(v: unknown): string {
  return String(v ?? "")
    .replace(/[   ​]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clave para comparar nombres: mayúsculas, sin tildes, espacios simples. */
export function clave(v: unknown): string {
  return limpiar(v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/** Verdadero / False / Activo / Inactivo / Sí / No → boolean (null si no se reconoce). */
export function booleano(v: unknown): boolean | null {
  const k = clave(v);
  if (["VERDADERO", "TRUE", "ACTIVO", "SI", "1", "X"].includes(k)) return true;
  if (["FALSO", "FALSE", "INACTIVO", "NO", "0", ""].includes(k)) return false;
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "1/08/2022" → "2022-08-01" (null si no es una fecha válida). */
export function fechaDmy(v: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(limpiar(v));
  if (!m) return null;
  const [d, me, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, me - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== me - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${pad(me)}-${pad(d)}`;
}

/** Número de serie de Excel (días desde 1899-12-30) → "aaaa-mm-dd". */
export function fechaSerie(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 2_958_465) return null;
  const f = new Date(Math.round((n - 25_569) * 86_400_000));
  return `${f.getUTCFullYear()}-${pad(f.getUTCMonth() + 1)}-${pad(f.getUTCDate())}`;
}

/**
 * Número de serie con hora (hora local de Lima, UTC−5 todo el año) → ISO en UTC.
 * Se redondea al milisegundo.
 */
export function instanteSerie(n: number, desfaseHoras = -5): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 2_958_465) return null;
  const ms = Math.round((n - 25_569) * 86_400_000) - desfaseHoras * 3_600_000;
  return new Date(ms).toISOString();
}

/** "24.07" o "24,07" → 24.07 (null si no es un monto). */
export function monto(v: unknown): number | null {
  const t = limpiar(v).replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100) / 100;
}

/** Entero con signo ("-5", "5", 5) → número (null si no es entero). */
export function entero(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  const t = limpiar(v);
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

/** RUC: 11 dígitos (se conservan los ceros a la izquierda). */
export function ruc(v: unknown): string | null {
  const t = limpiar(v).replace(/\.0$/, "");
  return /^\d{11}$/.test(t) ? t : null;
}

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const correoValido = (v: string) => CORREO.test(v) && v.length <= 254;
