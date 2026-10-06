import { createVerify } from "node:crypto";

/**
 * Verificación de mensajes de Amazon SNS (eventos de SES: entregas, rebotes, quejas).
 * https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 */
export type MensajeSns = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
};

const HOST_SNS = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** Solo URLs https de los servidores de SNS (evita que un atacante nos haga descargar otra cosa). */
export function urlSnsValida(url: string | undefined, sufijo?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOST_SNS.test(u.hostname) && !u.username && !u.password && (!sufijo || u.pathname.endsWith(sufijo));
  } catch {
    return false;
  }
}

export function esMensajeSns(v: unknown): v is MensajeSns {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    (m.Type === "Notification" || m.Type === "SubscriptionConfirmation" || m.Type === "UnsubscribeConfirmation") &&
    typeof m.MessageId === "string" &&
    typeof m.TopicArn === "string" &&
    typeof m.Message === "string" &&
    typeof m.Timestamp === "string" &&
    (m.SignatureVersion === "1" || m.SignatureVersion === "2") &&
    typeof m.Signature === "string" &&
    typeof m.SigningCertURL === "string"
  );
}

/** Texto que SNS firma: pares "Clave\nValor\n" en un orden fijo según el tipo. */
export function cadenaAFirmar(m: MensajeSns): string {
  const claves =
    m.Type === "Notification"
      ? (["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] as const)
      : (["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"] as const);
  let s = "";
  for (const k of claves) {
    const v = m[k];
    if (k === "Subject" && v === undefined) continue;
    s += `${k}\n${v ?? ""}\n`;
  }
  return s;
}

export function firmaValida(m: MensajeSns, certificadoPem: string): boolean {
  try {
    const v = createVerify(m.SignatureVersion === "1" ? "RSA-SHA1" : "RSA-SHA256");
    v.update(cadenaAFirmar(m), "utf8");
    return v.verify(certificadoPem, m.Signature, "base64");
  } catch {
    return false;
  }
}

/** Evento de SES (formato "event publishing" o notificaciones clásicas). */
export type EventoSes = {
  tipo: "entregado" | "rebotado" | "rebote_temporal" | "queja" | "otro";
  messageId: string | null;
  correos: string[];
  detalle: string;
};

export function interpretarEventoSes(mensaje: string): EventoSes {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(mensaje) as Record<string, unknown>;
  } catch {
    return { tipo: "otro", messageId: null, correos: [], detalle: "Mensaje no es JSON" };
  }
  const tipo = String(e.eventType ?? e.notificationType ?? "");
  const mail = (e.mail ?? {}) as { messageId?: string; destination?: string[] };
  const messageId = typeof mail.messageId === "string" ? mail.messageId : null;
  const correos = (lista: unknown, campo: string) =>
    Array.isArray(lista)
      ? lista.map((x) => String((x as Record<string, unknown>)[campo] ?? "").toLowerCase()).filter(Boolean)
      : [];

  if (tipo === "Delivery") {
    return { tipo: "entregado", messageId, correos: (mail.destination ?? []).map((c) => c.toLowerCase()), detalle: "Entregado" };
  }
  if (tipo === "Bounce") {
    const b = (e.bounce ?? {}) as { bounceType?: string; bounceSubType?: string; bouncedRecipients?: unknown };
    const permanente = b.bounceType === "Permanent";
    return {
      tipo: permanente ? "rebotado" : "rebote_temporal",
      messageId,
      correos: correos(b.bouncedRecipients, "emailAddress"),
      detalle: `Rebote ${b.bounceType ?? ""} ${b.bounceSubType ?? ""}`.trim(),
    };
  }
  if (tipo === "Complaint") {
    const c = (e.complaint ?? {}) as { complainedRecipients?: unknown; complaintFeedbackType?: string };
    return {
      tipo: "queja",
      messageId,
      correos: correos(c.complainedRecipients, "emailAddress"),
      detalle: `Marcado como spam ${c.complaintFeedbackType ?? ""}`.trim(),
    };
  }
  return { tipo: "otro", messageId, correos: [], detalle: tipo || "Desconocido" };
}
