import { NextResponse, type NextRequest } from "next/server";
import { esMensajeSns, firmaValida, interpretarEventoSes, urlSnsValida } from "@/lib/correo/sns";
import { crearClienteAdmin, hayClaveAdmin } from "@/lib/supabase/admin";

// Recibe los eventos de Amazon SES (vía SNS): entregado, rebote, queja.
// Seguridad: solo se acepta el tema SNS configurado (SES_SNS_TOPIC_ARN) y cada
// mensaje debe tener una firma válida de AWS.

export const dynamic = "force-dynamic";

const certificados = new Map<string, string>();

async function certificado(url: string): Promise<string | null> {
  const enCache = certificados.get(url);
  if (enCache) return enCache;
  const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!r.ok) return null;
  const pem = await r.text();
  if (!pem.includes("BEGIN CERTIFICATE") || pem.length > 20_000) return null;
  if (certificados.size > 20) certificados.clear();
  certificados.set(url, pem);
  return pem;
}

const vacio = (status: number) => new NextResponse(null, { status });

export async function POST(request: NextRequest) {
  const tema = process.env.SES_SNS_TOPIC_ARN;
  if (!tema || !hayClaveAdmin()) return vacio(404);

  if (Number(request.headers.get("content-length") ?? "0") > 256_000) return vacio(413);
  const cuerpo = await request.text();
  if (cuerpo.length > 256_000) return vacio(413);
  let mensaje: unknown;
  try {
    mensaje = JSON.parse(cuerpo);
  } catch {
    return vacio(400);
  }
  if (!esMensajeSns(mensaje) || mensaje.TopicArn !== tema) return vacio(403);
  // Mensajes de más de 24 horas no se aceptan (evita repetir mensajes viejos capturados).
  const antiguedad = Date.now() - Date.parse(mensaje.Timestamp);
  if (!Number.isFinite(antiguedad) || antiguedad > 24 * 3600_000 || antiguedad < -300_000) return vacio(403);
  if (!urlSnsValida(mensaje.SigningCertURL, ".pem")) return vacio(403);
  const pem = await certificado(mensaje.SigningCertURL).catch(() => null);
  if (!pem || !firmaValida(mensaje, pem)) return vacio(403);

  if (mensaje.Type === "SubscriptionConfirmation") {
    if (!urlSnsValida(mensaje.SubscribeURL)) return vacio(403);
    const r = await fetch(mensaje.SubscribeURL!, { redirect: "error", signal: AbortSignal.timeout(5000) }).catch(() => null);
    return vacio(r?.ok ? 200 : 502);
  }
  if (mensaje.Type !== "Notification") return vacio(200);

  const evento = interpretarEventoSes(mensaje.Message);
  if (evento.tipo === "otro" || !evento.messageId) return vacio(200);

  const admin = crearClienteAdmin();
  const ahora = new Date().toISOString();
  if (evento.tipo === "entregado") {
    // Solo pasa a "entregado" si no hubo antes un rebote o queja.
    await admin
      .from("correo_destinatarios")
      .update({ estado: "entregado", detalle: evento.detalle, actualizado_en: ahora })
      .eq("ses_message_id", evento.messageId)
      .eq("estado", "enviado");
    return vacio(200);
  }

  if (evento.tipo === "rebote_temporal") {
    await admin
      .from("correo_destinatarios")
      .update({ detalle: evento.detalle, actualizado_en: ahora })
      .eq("ses_message_id", evento.messageId);
    return vacio(200);
  }

  // Rebote permanente o queja: se marca y la dirección no vuelve a recibir correos.
  const estado = evento.tipo === "rebotado" ? "rebotado" : "queja";
  const { data } = await admin
    .from("correo_destinatarios")
    .update({ estado, detalle: evento.detalle, actualizado_en: ahora })
    .eq("ses_message_id", evento.messageId)
    .select("correo, correo_id");
  for (const fila of (data ?? []) as { correo: string; correo_id: string }[]) {
    await admin
      .from("correos_suprimidos")
      .upsert(
        { correo: fila.correo.toLowerCase(), motivo: estado === "rebotado" ? "rebote" : "queja", detalle: evento.detalle },
        { onConflict: "correo", ignoreDuplicates: true },
      );
    await admin.from("correos_pendientes").update({ estado: "parcial" }).eq("id", fila.correo_id).eq("estado", "enviado");
  }
  return vacio(200);
}
