// Edge Function: envía los correos de la cola (patrón outbox) por Amazon SES.
//
// La llama Supabase Cron cada minuto (solo si hay correos pendientes) con la
// cabecera x-cron-secreto, que se compara con el secreto guardado en Vault.
//
// Secretos de la función (Supabase → Edge Functions → Secrets):
//   AWS_REGION              us-east-1
//   AWS_ACCESS_KEY_ID       del usuario IAM con permiso SOLO de enviar correo
//   AWS_SECRET_ACCESS_KEY
//   SES_CONFIGURATION_SET   (opcional) para recibir entregas, rebotes y quejas
// Sin credenciales, o con la configuración correo.modo = "registrar", los
// correos se arman y se guardan, pero no se envían.

import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";
import { aBase64, construirMime, type Adjunto } from "../_shared/mime.ts";
import { renderizar, type Plantilla } from "../_shared/plantilla.ts";
import { detectarTipo } from "../_shared/tipo-archivo.ts";

const MAX_INTENTOS = 6;
const TIEMPO_MAXIMO_MS = 40_000;
const PAUSA_MS = Number(Deno.env.get("SES_PAUSA_MS") ?? "150");
const CORREO_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Correo = {
  id: string;
  plantilla: string;
  datos: Record<string, unknown>;
  intentos: number;
  adjuntos?: { bucket: string; ruta: string; nombre: string; tipo: string }[];
  responder_a?: string | null;
};
type Destinatario = { id: string; correo: string; tipo: string; estado: string };
type Resultado = "enviado" | "registrado" | "fallido" | "reintentar" | "detener";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const region = Deno.env.get("AWS_REGION") ?? "us-east-1";
const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const configurationSet = Deno.env.get("SES_CONFIGURATION_SET") || undefined;
const aws =
  accessKeyId && secretAccessKey ? new AwsClient({ accessKeyId, secretAccessKey, region, service: "ses" }) : null;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Nombre <correo>" con el nombre codificado si tiene tildes (RFC 2047). */
function remitente(nombre: string, direccion: string): string {
  const limpio = nombre.replace(/["\r\n<>]/g, "").trim();
  if (!limpio) return direccion;
  // deno-lint-ignore no-control-regex
  const ascii = /^[\x20-\x7e]*$/.test(limpio);
  const codificado = ascii ? `"${limpio}"` : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(limpio)))}?=`;
  return `${codificado} <${direccion}>`;
}

async function leerConfiguracion() {
  const { data } = await supabase
    .from("configuracion")
    .select("clave, valor")
    .in("clave", ["correo.modo", "correo.remitente_nombre", "correo.remitente_direccion", "app.url", "contacto.destinatario"]);
  const mapa = new Map((data ?? []).map((f: { clave: string; valor: unknown }) => [f.clave, String(f.valor ?? "")]));
  return {
    modo: mapa.get("correo.modo") === "enviar" ? "enviar" : "registrar",
    nombre: mapa.get("correo.remitente_nombre") ?? "",
    direccion: (mapa.get("correo.remitente_direccion") ?? "").trim(),
    urlApp: (mapa.get("app.url") ?? "").replace(/\/+$/, ""),
    contacto: mapa.get("contacto.destinatario") ?? "",
  };
}

async function enviarSes(
  de: string,
  para: string[],
  ocultos: string[],
  asunto: string,
  html: string,
  texto: string,
  correoId: string,
  responderA: string | null,
  adjuntos: Adjunto[],
): Promise<{ resultado: Resultado; messageId?: string; detalle?: string }> {
  try {
    // Con adjuntos se envía el mensaje MIME completo (una sola vez para todos); sin adjuntos, el formato simple de SES.
    const contenido = adjuntos.length
      ? {
          Raw: {
            Data: aBase64(new TextEncoder().encode(construirMime({ de, para: para.join(", "), asunto, html, texto, responderA, adjuntos }))),
          },
        }
      : {
          Simple: {
            Subject: { Data: asunto, Charset: "UTF-8" },
            Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: texto, Charset: "UTF-8" } },
          },
        };
    const r = await aws!.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        FromEmailAddress: de,
        Destination: { ToAddresses: para, BccAddresses: ocultos.length ? ocultos : undefined },
        ReplyToAddresses: responderA && CORREO_VALIDO.test(responderA) ? [responderA] : undefined,
        Content: contenido,
        ConfigurationSetName: configurationSet,
        EmailTags: [{ Name: "correo_id", Value: correoId }],
      }),
    });
    const cuerpo = await r.text();
    if (r.ok) {
      const messageId = (JSON.parse(cuerpo) as { MessageId?: string }).MessageId;
      return { resultado: "enviado", messageId };
    }
    const detalle = `SES ${r.status}: ${cuerpo.slice(0, 300)}`;
    const error = cuerpo.toLowerCase();
    // Problemas de la cuenta o de la configuración (credenciales, remitente sin verificar,
    // envío pausado): se detiene la ejecución y se reintenta después, sin dar por perdido el correo.
    if (
      r.status === 401 ||
      r.status === 403 ||
      /accountsuspended|sendingpaused|mailfromdomainnotverified|configurationsetdoesnotexist/.test(error) ||
      error.includes(de.toLowerCase().replace(/^.*<|>$/g, ""))
    ) {
      return { resultado: "detener", detalle };
    }
    // Rechazo de ESTE destinatario (dirección inválida o no verificada en sandbox): definitivo.
    if (r.status === 400 && (para.some((x) => error.includes(x.toLowerCase())) || /invalid.*address|illegal address/.test(error))) {
      return { resultado: "fallido", detalle };
    }
    // 429 (límite de envío), 5xx y cualquier otro caso: temporal.
    return { resultado: "reintentar", detalle };
  } catch (e) {
    return { resultado: "reintentar", detalle: `Red: ${String(e).slice(0, 300)}` };
  }
}

// La caché vive solo durante una ejecución: si el Superadmin edita una plantilla, el siguiente minuto ya usa la nueva.
async function plantilla(plantillas: Map<string, Plantilla | null>, codigo: string): Promise<Plantilla | null> {
  if (!plantillas.has(codigo)) {
    const { data } = await supabase
      .from("plantillas_correo")
      .select("asunto, html, texto, columnas")
      .eq("codigo", codigo)
      .maybeSingle();
    plantillas.set(codigo, (data as Plantilla | null) ?? null);
  }
  return plantillas.get(codigo) ?? null;
}

/** Devuelve false si hay que detener la ejecución (problema de la cuenta de SES). */
async function procesar(
  c: Correo,
  cfg: Awaited<ReturnType<typeof leerConfiguracion>>,
  plantillas: Map<string, Plantilla | null>,
): Promise<boolean> {
  const p = await plantilla(plantillas, c.plantilla);
  if (!p) {
    await supabase
      .from("correos_pendientes")
      .update({ estado: "fallido", ultimo_error: "La plantilla no existe" })
      .eq("id", c.id);
    return true;
  }
  const armado = renderizar(p, c.datos ?? {}, { url_app: cfg.urlApp, correo_contacto: cfg.contacto });
  await supabase
    .from("correos_pendientes")
    .update({ asunto_final: armado.asunto, html_final: armado.html, texto_final: armado.texto })
    .eq("id", c.id);

  const { data: dests } = await supabase
    .from("correo_destinatarios")
    .select("id, correo, tipo, estado")
    .eq("correo_id", c.id)
    .eq("estado", "pendiente");

  const enviar = cfg.modo === "enviar" && aws !== null && CORREO_VALIDO.test(cfg.direccion);
  const de = remitente(cfg.nombre, cfg.direccion);
  const lista = (dests ?? []) as Destinatario[];
  // Los adjuntos se descargan una vez por correo (solo si de verdad se va a enviar) y se revisa su contenido real.
  const adjuntos: Adjunto[] = [];
  if (enviar && lista.length) {
    for (const a of c.adjuntos ?? []) {
      const { data: archivo, error } = a.bucket === "contacto" ? await supabase.storage.from(a.bucket).download(a.ruta) : { data: null, error: true };
      if (error || !archivo) throw new Error(`No se pudo leer el adjunto ${a.nombre}`);
      const datos = new Uint8Array(await archivo.arrayBuffer());
      if (detectarTipo(datos)?.mime !== a.tipo) {
        await supabase
          .from("correos_pendientes")
          .update({ estado: "fallido", ultimo_error: `El adjunto ${a.nombre} no es del tipo declarado` })
          .eq("id", c.id);
        return true;
      }
      adjuntos.push({ nombre: a.nombre, tipo: a.tipo, datos });
    }
  }

  // Sin adjuntos: un envío por destinatario (estado exacto de cada uno).
  // Con adjuntos: un solo envío para todos, para no armar y firmar varias veces un mensaje pesado.
  const grupos: Destinatario[][] = adjuntos.length ? (lista.length ? [lista] : []) : lista.map((d) => [d]);
  let pendientes = 0;
  let detener = false;
  let ultimoError: string | null = null;
  const marcar = async (grupo: Destinatario[], cambios: Record<string, unknown>) => {
    const { error: eAct } = await supabase
      .from("correo_destinatarios")
      .update({ ...cambios, actualizado_en: new Date().toISOString() })
      .in("id", grupo.map((d) => d.id));
    if (eAct) console.error("No se pudo guardar el resultado de", c.id, eAct.message);
  };

  for (const grupo of grupos) {
    if (!enviar) {
      await marcar(grupo, { estado: "registrado", detalle: "Modo registrar: no se envió" });
      continue;
    }
    if (detener) {
      pendientes += grupo.length;
      continue;
    }
    const para = grupo.filter((d) => d.tipo !== "cco").map((d) => d.correo);
    const ocultos = grupo.filter((d) => d.tipo === "cco").map((d) => d.correo);
    const r = await enviarSes(
      de,
      para.length ? para : ocultos,
      para.length ? ocultos : [],
      armado.asunto,
      armado.html,
      armado.texto,
      c.id,
      c.responder_a ?? null,
      adjuntos,
    );
    if (r.resultado === "detener") {
      detener = true;
      pendientes += grupo.length;
      ultimoError = r.detalle ?? null;
      continue;
    }
    if (r.resultado === "reintentar") {
      ultimoError = r.detalle ?? null;
      if (c.intentos >= MAX_INTENTOS) await marcar(grupo, { estado: "fallido", detalle: r.detalle });
      else pendientes += grupo.length;
    } else {
      if (r.resultado === "fallido") ultimoError = r.detalle ?? null;
      await marcar(grupo, { estado: r.resultado, ses_message_id: r.messageId ?? null, detalle: r.detalle ?? null });
    }
    await dormir(PAUSA_MS);
  }

  if (detener || (pendientes > 0 && c.intentos < MAX_INTENTOS)) {
    // Espera creciente: 2, 4, 8, 16, 32 minutos (un problema de la cuenta no gasta intentos).
    const espera = detener ? 5 * 60_000 : 2 ** c.intentos * 60_000;
    await supabase
      .from("correos_pendientes")
      .update({
        estado: "pendiente",
        ultimo_error: ultimoError,
        proximo_intento: new Date(Date.now() + espera).toISOString(),
        ...(detener ? { intentos: Math.max(c.intentos - 1, 0) } : {}),
      })
      .eq("id", c.id);
    return !detener;
  }

  // Estado final del correo según sus destinatarios principales (la copia oculta interna no cuenta).
  const { data: todos } = await supabase.from("correo_destinatarios").select("estado, tipo").eq("correo_id", c.id);
  const estados = ((todos ?? []) as { estado: string; tipo: string }[]).filter((t) => t.tipo !== "cco").map((t) => t.estado);
  const ok = estados.filter((e) => e === "enviado" || e === "entregado").length;
  const registrados = estados.filter((e) => e === "registrado").length;
  const malos = estados.filter((e) => e === "fallido" || e === "rebotado" || e === "queja").length;
  const estado = registrados > 0 && ok === 0 ? "registrado" : ok === 0 ? "fallido" : malos > 0 ? "parcial" : "enviado";
  await supabase.from("correos_pendientes").update({ estado, ultimo_error: ultimoError }).eq("id", c.id);
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });
  const secreto = req.headers.get("x-cron-secreto") ?? "";
  const { data: valido } = await supabase.rpc("correos_verificar_secreto", { p_secreto: secreto });
  if (valido !== true) return new Response("No autorizado", { status: 401 });

  const cfg = await leerConfiguracion();
  const plantillas = new Map<string, Plantilla | null>();
  const inicio = Date.now();
  let procesados = 0;
  let seguir = true;
  // De a un correo por vez: si la función se corta, a lo sumo queda uno "en proceso".
  while (seguir && Date.now() - inicio < TIEMPO_MAXIMO_MS) {
    const { data: lote, error } = await supabase.rpc("correos_tomar_lote", { p_limite: 1 });
    if (error) {
      console.error("correos_tomar_lote:", error.message);
      break;
    }
    if (!lote?.length) break;
    for (const c of lote as Correo[]) {
      try {
        seguir = await procesar(c, cfg, plantillas);
      } catch (e) {
        console.error("procesar", c.id, String(e));
        const agotado = c.intentos >= MAX_INTENTOS;
        await supabase
          .from("correos_pendientes")
          .update({
            estado: agotado ? "fallido" : "pendiente",
            ultimo_error: String(e).slice(0, 300),
            proximo_intento: new Date(Date.now() + 2 ** c.intentos * 60_000).toISOString(),
          })
          .eq("id", c.id);
      }
      procesados++;
    }
  }
  // Limpieza: archivos subidos que ningún mensaje ni documento usó (subidas fallidas o abandonadas).
  let limpiados = 0;
  if (Date.now() - inicio < TIEMPO_MAXIMO_MS) {
    const { data: huerfanos } = await supabase.rpc("archivos_huerfanos", { p_limite: 100 });
    const porBucket = new Map<string, string[]>();
    for (const h of (huerfanos ?? []) as { bucket: string; ruta: string }[]) {
      if (h.bucket === "contacto" || h.bucket === "documentos") porBucket.set(h.bucket, [...(porBucket.get(h.bucket) ?? []), h.ruta]);
    }
    for (const [bucket, rutas] of porBucket) {
      const { error } = await supabase.storage.from(bucket).remove(rutas);
      if (error) console.error("limpieza", bucket, error.message);
      else limpiados += rutas.length;
    }
  }
  return Response.json({ procesados, limpiados, modo: cfg.modo, ses: aws !== null });
});
