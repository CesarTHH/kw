/**
 * Texto enriquecido básico para las alertas: **negrita**, *cursiva*, listas con
 * "- " y enlaces https://… Se convierte a una estructura que React dibuja sin
 * usar HTML crudo, así que no hay forma de inyectar código.
 */

export type Trozo = { t: "texto" | "negrita" | "cursiva"; v: string } | { t: "enlace"; v: string };
export type Bloque = { t: "parrafo"; lineas: Trozo[][] } | { t: "lista"; items: Trozo[][] };

const ENLACE = /https:\/\/[^\s<>"')]+/g;

function enlaces(texto: string, tipo: "texto" | "negrita" | "cursiva"): Trozo[] {
  const salida: Trozo[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(ENLACE)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    const i = m.index ?? 0;
    if (i > ultimo) salida.push({ t: tipo, v: texto.slice(ultimo, i) });
    salida.push({ t: "enlace", v: url });
    ultimo = i + url.length;
  }
  if (ultimo < texto.length) salida.push({ t: tipo, v: texto.slice(ultimo) });
  return salida;
}

export function trozos(linea: string): Trozo[] {
  const salida: Trozo[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let ultimo = 0;
  for (const m of linea.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > ultimo) salida.push(...enlaces(linea.slice(ultimo, i), "texto"));
    if (m[1] !== undefined) salida.push(...enlaces(m[1], "negrita"));
    else salida.push(...enlaces(m[2] ?? "", "cursiva"));
    ultimo = i + m[0].length;
  }
  if (ultimo < linea.length) salida.push(...enlaces(linea.slice(ultimo), "texto"));
  return salida;
}

export function bloques(texto: string): Bloque[] {
  const salida: Bloque[] = [];
  for (const grupo of texto.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lineas = grupo.split("\n").filter((l) => l.trim() !== "");
    if (!lineas.length) continue;
    if (lineas.every((l) => /^\s*[-•]\s+/.test(l))) {
      salida.push({ t: "lista", items: lineas.map((l) => trozos(l.replace(/^\s*[-•]\s+/, ""))) });
    } else {
      salida.push({ t: "parrafo", lineas: lineas.map((l) => trozos(l)) });
    }
  }
  return salida;
}
