/**
 * Lector mínimo de Excel (.xlsx) sin dependencias, pensado para archivos grandes:
 * descomprime la hoja por partes (streaming) y entrega una fila a la vez.
 * Solo lee valores (texto, números, booleanos); ignora formatos y fórmulas.
 */
import { Readable } from "node:stream";
import { createInflateRaw, inflateRawSync } from "node:zlib";

type Entrada = { nombre: string; metodo: number; comprimido: number; inicioDatos: number };

/** Índice del ZIP (directorio central). */
function leerZip(b: Buffer): Map<string, Entrada> {
  // Fin del directorio central: firma 0x06054b50 en los últimos 64 KB.
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("El archivo no es un Excel válido (.xlsx).");
  const total = b.readUInt16LE(fin + 10);
  let p = b.readUInt32LE(fin + 16);
  const entradas = new Map<string, Entrada>();
  for (let n = 0; n < total; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("El archivo Excel está dañado.");
    const metodo = b.readUInt16LE(p + 10);
    const comprimido = b.readUInt32LE(p + 20);
    const largoNombre = b.readUInt16LE(p + 28);
    const largoExtra = b.readUInt16LE(p + 30);
    const largoComentario = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const nombre = b.toString("utf8", p + 46, p + 46 + largoNombre);
    if (b.readUInt32LE(local) !== 0x04034b50) throw new Error("El archivo Excel está dañado.");
    const inicioDatos = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    entradas.set(nombre, { nombre, metodo, comprimido, inicioDatos });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

function datos(b: Buffer, e: Entrada): Buffer {
  const crudo = b.subarray(e.inicioDatos, e.inicioDatos + e.comprimido);
  if (e.metodo === 0) return crudo;
  if (e.metodo === 8) return inflateRawSync(crudo);
  throw new Error("El Excel usa una compresión no soportada.");
}

async function* textoPorPartes(b: Buffer, e: Entrada): AsyncGenerator<string> {
  const crudo = b.subarray(e.inicioDatos, e.inicioDatos + e.comprimido);
  const decodificador = new TextDecoder("utf-8");
  if (e.metodo === 0) {
    yield decodificador.decode(crudo);
    return;
  }
  if (e.metodo !== 8) throw new Error("El Excel usa una compresión no soportada.");
  for await (const parte of Readable.from([crudo]).pipe(createInflateRaw())) {
    yield decodificador.decode(parte as Buffer, { stream: true });
  }
  const resto = decodificador.decode();
  if (resto) yield resto;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function desescapar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}

/** Texto de un <si> o <is>: une los <t> (sin la guía fonética <rPh>). */
function textoRico(xml: string): string {
  const sinFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let salida = "";
  for (const m of sinFonetica.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) salida += m[1];
  return desescapar(salida);
}

/** "AB" → 27 (base 0: A = 0). */
export function indiceColumna(letras: string): number {
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export type Celda = string | number | boolean | null;

/** Celdas de una fila <row>…</row>. */
export function celdasDeFila(xml: string, compartidas: string[]): Celda[] {
  const fila: Celda[] = [];
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let siguiente = 0;
  for (const m of xml.matchAll(re)) {
    const attrs = m[1] ?? "";
    const cuerpo = m[2] ?? "";
    const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
    const col = ref ? indiceColumna(ref[1]!) : siguiente;
    siguiente = col + 1;
    const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
    let valor: Celda = null;
    if (tipo === "s") valor = v !== undefined ? (compartidas[Number(v)] ?? null) : null;
    else if (tipo === "inlineStr") valor = textoRico(cuerpo);
    else if (tipo === "str" || tipo === "e") valor = v !== undefined ? desescapar(v) : null;
    else if (tipo === "b") valor = v === "1";
    else if (v !== undefined && v !== "") valor = Number(v);
    while (fila.length < col) fila.push(null);
    fila[col] = valor;
  }
  return fila;
}

export type HojaExcel = { nombre: string; filas: () => AsyncGenerator<Celda[]> };

/** Abre un .xlsx y devuelve sus hojas (en el orden del libro). */
export function abrirExcel(b: Buffer): HojaExcel[] {
  const zip = leerZip(b);
  const leer = (n: string) => {
    const e = zip.get(n);
    return e ? datos(b, e).toString("utf8") : "";
  };
  const libro = leer("xl/workbook.xml");
  const relaciones = leer("xl/_rels/workbook.xml.rels");
  if (!libro) throw new Error("El archivo no es un Excel válido (.xlsx).");
  const destinos = new Map<string, string>();
  for (const m of relaciones.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const destino = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && destino) destinos.set(id, destino.startsWith("/") ? destino.slice(1) : `xl/${destino}`);
  }
  const compartidasXml = leer("xl/sharedStrings.xml");
  const compartidas = [...compartidasXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoRico(m[1] ?? ""));

  const hojas: HojaExcel[] = [];
  for (const m of libro.matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = desescapar(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const ruta = rid ? destinos.get(rid) : undefined;
    const entrada = ruta ? zip.get(ruta) : undefined;
    if (!entrada) continue;
    hojas.push({
      nombre,
      filas: async function* () {
        let pendiente = "";
        for await (const parte of textoPorPartes(b, entrada)) {
          pendiente += parte;
          let fin = pendiente.lastIndexOf("</row>");
          if (fin < 0) continue;
          fin += 6;
          const bloque = pendiente.slice(0, fin);
          pendiente = pendiente.slice(fin);
          for (const r of bloque.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) yield celdasDeFila(r[1] ?? "", compartidas);
        }
      },
    });
  }
  return hojas;
}
