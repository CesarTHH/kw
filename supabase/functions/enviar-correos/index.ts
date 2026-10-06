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
import { renderizar, type Plantilla } from "../_shared/plantilla.ts";

const MAX_INTENTOS = 6;
const TIEMPO_MAXIMO_MS = 40_000;
const PAUSA_MS = Number(Deno.env.get("SES_PAUSA_MS") ?? "150");
const CORREO_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Correo = {
  id: string;
  plantilla: string;
  datos: Record<string, unknown>;
  intentos: number;
};
type Destinatario = { id: string; correo: string; tipo: string; estado: string };
type Resultado = "enviado" | "registrado" | "fallido" | "reintentar";

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
  para: string,
  asunto: string,
  html: string,
  texto: string,
  correoId: string,
): Promise<{ resultado: Resultado; messageId?: string; detalle?: string }> {
  try {
    const r = await aws!.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        FromEmailAddress: de,
        Destination: { ToAddresses: [para] },
        Content: {
          Simple: {
            Subject: { Data: asunto, Charset: "UTF-8" },
            Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: texto, Charset: "UTF-8" } },
          },
        },
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
    // 429 (límite de envío) y 5xx: temporales. 4xx (rechazado, no verificado…): definitivos.
    return { resultado: r.status === 429 || r.status >= 500 ? "reintentar" : "fallido", detalle };
  } catch (e) {
    return { resultado: "reintentar", detalle: `Red: ${String(e).slice(0, 300)}` };
  }
}

const plantillas = new Map<string, Plantilla | null>();
async function plantilla(codigo: string): Promise<Plantilla | null> {
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

async function procesar(c: Correo, cfg: Awaited<ReturnType<typeof leerConfiguracion>>) {
  const p = await plantilla(c.plantilla);
  if (!p) {
    await supabase
      .from("correos_pendientes")
      .update({ estado: "fallido", ultimo_error: "La plantilla no existe" })
      .eq("id", c.id);
    return;
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
  let pendientes = 0;
  let ultimoError: string | null = null;

  for (const d of (dests ?? []) as Destinatario[]) {
    if (!enviar) {
      await supabase
        .from("correo_destinatarios")
        .update({ estado: "registrado", detalle: "Modo registrar: no se envió", actualizado_en: new Date().toISOString() })
        .eq("id", d.id);
      continue;
    }
    const r = await enviarSes(de, d.correo, armado.asunto, armado.html, armado.texto, c.id);
    if (r.resultado === "reintentar") {
      pendientes++;
      ultimoError = r.detalle ?? null;
      if (c.intentos >= MAX_INTENTOS) {
        await supabase
          .from("correo_destinatarios")
          .update({ estado: "fallido", detalle: r.detalle, actualizado_en: new Date().toISOString() })
          .eq("id", d.id);
      }
    } else {
      if (r.resultado === "fallido") ultimoError = r.detalle ?? null;
      await supabase
        .from("correo_destinatarios")
        .update({
          estado: r.resultado,
          ses_message_id: r.messageId ?? null,
          detalle: r.detalle ?? null,
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", d.id);
    }
    await dormir(PAUSA_MS);
  }

  if (pendientes > 0 && c.intentos < MAX_INTENTOS) {
    // Espera creciente: 2, 4, 8, 16, 32 minutos.
    const espera = 2 ** c.intentos * 60_000;
    await supabase
      .from("correos_pendientes")
      .update({ estado: "pendiente", ultimo_error: ultimoError, proximo_intento: new Date(Date.now() + espera).toISOString() })
      .eq("id", c.id);
    return;
  }

  // Estado final del correo según sus destinatarios.
  const { data: todos } = await supabase.from("correo_destinatarios").select("estado").eq("correo_id", c.id);
  const estados = ((todos ?? []) as { estado: string }[]).map((t) => t.estado);
  const ok = estados.filter((e) => e === "enviado" || e === "entregado").length;
  const registrados = estados.filter((e) => e === "registrado").length;
  const malos = estados.filter((e) => e === "fallido" || e === "rebotado" || e === "queja").length;
  const estado = registrados > 0 && ok === 0 ? "registrado" : ok === 0 ? "fallido" : malos > 0 ? "parcial" : "enviado";
  await supabase.from("correos_pendientes").update({ estado, ultimo_error: ultimoError }).eq("id", c.id);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });
  const secreto = req.headers.get("x-cron-secreto") ?? "";
  const { data: valido } = await supabase.rpc("correos_verificar_secreto", { p_secreto: secreto });
  if (valido !== true) return new Response("No autorizado", { status: 401 });

  const cfg = await leerConfiguracion();
  const inicio = Date.now();
  let procesados = 0;
  while (Date.now() - inicio < TIEMPO_MAXIMO_MS) {
    const { data: lote, error } = await supabase.rpc("correos_tomar_lote", { p_limite: 20 });
    if (error) {
      console.error("correos_tomar_lote:", error.message);
      break;
    }
    if (!lote?.length) break;
    for (const c of lote as Correo[]) {
      try {
        await procesar(c, cfg);
      } catch (e) {
        console.error("procesar", c.id, String(e));
        await supabase
          .from("correos_pendientes")
          .update({ estado: "pendiente", ultimo_error: String(e).slice(0, 300), proximo_intento: new Date(Date.now() + 120_000).toISOString() })
          .eq("id", c.id);
      }
      procesados++;
    }
  }
  return Response.json({ procesados, modo: cfg.modo, ses: aws !== null });
});
