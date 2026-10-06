/**
 * Arma un correo a partir de una plantilla y sus datos.
 * Lo usan la Edge Function (Deno) y la app (vista previa), por eso no importa nada.
 *
 * Variables: {{nombre}}. Los valores se escapan en HTML. Bloques especiales:
 *   {{tabla_registros}}  tabla con datos.registros y las columnas de la plantilla
 *   {{pie_facturacion}}  texto fijo de los correos de Facturación (como el Word)
 */

export type Columna = { clave: string; titulo: string };
export type Plantilla = { asunto: string; html: string; texto: string; columnas: Columna[] };
export type Correo = { asunto: string; html: string; texto: string };
type Valor = string | number | boolean | null | undefined;

const COLOR_MARCA = "#F58634";
const COLOR_OLIVA = "#5C5E4E";
const COLOR_GRIS = "#E8E9E4";

export function escaparHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 2026-10-12 → 12/10/2026 (otras cadenas quedan igual). */
export function formatearValor(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function registros(datos: Record<string, unknown>): Record<string, unknown>[] {
  const r = datos.registros;
  return Array.isArray(r) ? r.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}

export function tablaHtml(columnas: Columna[], filas: Record<string, unknown>[]): string {
  if (!columnas.length) return "";
  const th = columnas
    .map(
      (c) =>
        `<th style="background:${COLOR_OLIVA};color:#ffffff;font-weight:normal;text-align:left;padding:6px 8px;border:1px solid #c9b48a">${escaparHtml(c.titulo)}</th>`,
    )
    .join("");
  const tr = filas
    .map((f, i) => {
      const fondo = i % 2 === 0 ? "#ffffff" : COLOR_GRIS;
      const tds = columnas
        .map((c) => `<td style="padding:6px 8px;border:1px solid #d8d9d2;background:${fondo}">${escaparHtml(formatearValor(f[c.clave]))}</td>`)
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;margin:12px 0;width:100%"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

export function tablaTexto(columnas: Columna[], filas: Record<string, unknown>[]): string {
  if (!columnas.length) return "";
  const lineas = [columnas.map((c) => c.titulo).join(" | ")];
  for (const f of filas) lineas.push(columnas.map((c) => formatearValor(f[c.clave])).join(" | "));
  return lineas.join("\n");
}

function pieHtml(correoContacto: string): string {
  return `<p>Si usted no reconoce esta solicitud, por favor póngase en contacto con nosotros lo antes posible.</p>
<p>Tenga en cuenta que este correo electrónico es informativo y no requiere de respuesta. Si tiene alguna consulta o necesita asistencia, por favor contacte con nosotros a través del correo electrónico <a href="mailto:${escaparHtml(correoContacto)}">${escaparHtml(correoContacto)}</a>.</p>
<p>Saludos Cordiales<br>Equipo de Facturación</p>
<p style="font-size:12px;color:${COLOR_OLIVA}">La solicitud realizada está sujeta a los términos y condiciones aceptados por el solicitante en el momento del registro.</p>`;
}

function pieTexto(correoContacto: string): string {
  return `Si usted no reconoce esta solicitud, por favor póngase en contacto con nosotros lo antes posible.

Tenga en cuenta que este correo electrónico es informativo y no requiere de respuesta. Si tiene alguna consulta o necesita asistencia, por favor contacte con nosotros a través del correo electrónico ${correoContacto}.

Saludos Cordiales
Equipo de Facturación

La solicitud realizada está sujeta a los términos y condiciones aceptados por el solicitante en el momento del registro.`;
}

function reemplazar(plantilla: string, valor: (nombre: string) => string): string {
  return plantilla.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_m, nombre: string) => valor(nombre.toLowerCase()));
}

/** Marco común: barra naranja con el nombre y pie con la nota de envío automático. */
export function marcoHtml(cuerpo: string, asunto: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(asunto)}</title></head>
<body style="margin:0;padding:0;background:${COLOR_GRIS};font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#262626">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${COLOR_GRIS};padding:16px 0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${COLOR_MARCA};color:#ffffff;padding:14px 20px;font-size:18px;font-weight:bold">Kuntur Wasi Catering</td></tr>
<tr><td style="padding:20px;font-size:14px;line-height:1.5">${cuerpo}</td></tr>
<tr><td style="background:${COLOR_OLIVA};color:#ffffff;padding:10px 20px;font-size:11px">Correo enviado automáticamente por el Portal de Raciones. No responda a este mensaje.</td></tr>
</table></td></tr></table></body></html>`;
}

export function renderizar(
  p: Plantilla,
  datos: Record<string, unknown>,
  globales: { url_app: string; correo_contacto: string },
): Correo {
  const filas = registros(datos);
  const simple = (nombre: string): Valor => {
    if (nombre in globales) return globales[nombre as keyof typeof globales];
    const v = datos[nombre];
    return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : "";
  };

  const asunto = reemplazar(p.asunto, (n) => formatearValor(simple(n)))
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 300);

  const cuerpo = reemplazar(p.html, (n) => {
    if (n === "tabla_registros") return tablaHtml(p.columnas, filas);
    if (n === "pie_facturacion") return pieHtml(globales.correo_contacto);
    return escaparHtml(formatearValor(simple(n)));
  });

  const texto = reemplazar(p.texto, (n) => {
    if (n === "tabla_registros") return tablaTexto(p.columnas, filas);
    if (n === "pie_facturacion") return pieTexto(globales.correo_contacto);
    return formatearValor(simple(n));
  });

  return { asunto, html: marcoHtml(cuerpo, asunto), texto };
}
