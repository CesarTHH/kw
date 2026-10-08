/**
 * Arma un correo MIME (texto + HTML + adjuntos) para enviarlo "en crudo" por Amazon SES.
 * Sin dependencias: lo usan la Edge Function (Deno) y las pruebas de la app.
 */

export type Adjunto = { nombre: string; tipo: string; datos: Uint8Array };

const enc = new TextEncoder();

/** Bytes → base64 (por partes, para no desbordar la pila con archivos grandes). */
export function aBase64(b: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < b.length; i += 0x8000) binario += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(binario);
}

const lineas76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");

/** Cabecera con tildes codificada (RFC 2047). Sin saltos de línea: evita inyectar cabeceras. */
export function cabecera(valor: string): string {
  const limpio = valor.replace(/[\r\n]+/g, " ");
  // deno-lint-ignore no-control-regex
  return /^[\x20-\x7e]*$/.test(limpio) ? limpio : `=?UTF-8?B?${aBase64(enc.encode(limpio))}?=`;
}

/** Parámetros de nombre: versión ASCII (filename="…") y UTF-8 según RFC 2231 (filename*=…). */
function nombreAdjunto(nombre: string): { ascii: string; utf8: string } {
  // deno-lint-ignore no-control-regex
  const limpio = nombre.replace(/[\u0000-\u001f\u007f"\\/;]/g, "").slice(0, 150) || "adjunto";
  const ascii = limpio.normalize("NFD").replace(/[^\x20-\x7e]/g, "") || "adjunto";
  const utf8 = encodeURIComponent(limpio).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return { ascii, utf8 };
}

export function construirMime(m: {
  de: string;
  para: string;
  asunto: string;
  texto: string;
  html: string;
  responderA?: string | null;
  adjuntos: Adjunto[];
  frontera?: string;
}): string {
  // Fronteras distintas que no son prefijo una de otra.
  const id = m.frontera ?? crypto.randomUUID();
  const f = `mixto_${id}`;
  const alt = `alterno_${id}`;
  const partes: string[] = [
    `From: ${m.de.replace(/[\r\n]/g, "")}`,
    `To: ${m.para.replace(/[\r\n]/g, "")}`,
    ...(m.responderA ? [`Reply-To: ${m.responderA.replace(/[\r\n]/g, "")}`] : []),
    `Subject: ${cabecera(m.asunto)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${f}"`,
    "",
    `--${f}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    lineas76(aBase64(enc.encode(m.texto))),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    lineas76(aBase64(enc.encode(m.html))),
    `--${alt}--`,
  ];
  for (const a of m.adjuntos) {
    const nombre = nombreAdjunto(a.nombre);
    const tipo = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(a.tipo) ? a.tipo : "application/octet-stream";
    partes.push(
      `--${f}`,
      `Content-Type: ${tipo}; name="${nombre.ascii}"`,
      `Content-Disposition: attachment; filename="${nombre.ascii}";\r\n filename*=UTF-8''${nombre.utf8}`,
      "Content-Transfer-Encoding: base64",
      "",
      lineas76(aBase64(a.datos)),
    );
  }
  partes.push(`--${f}--`, "");
  return partes.join("\r\n");
}
