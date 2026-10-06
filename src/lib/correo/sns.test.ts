import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cadenaAFirmar, esMensajeSns, firmaValida, interpretarEventoSes, urlSnsValida, type MensajeSns } from "./sns";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

function firmar(m: Omit<MensajeSns, "Signature">): MensajeSns {
  const s = createSign(m.SignatureVersion === "1" ? "RSA-SHA1" : "RSA-SHA256");
  s.update(cadenaAFirmar({ ...m, Signature: "" }));
  return { ...m, Signature: s.sign(privateKey, "base64") };
}

const base = {
  Type: "Notification" as const,
  MessageId: "m-1",
  TopicArn: "arn:aws:sns:us-east-1:123456789012:ses-eventos",
  Message: JSON.stringify({ eventType: "Delivery", mail: { messageId: "ses-1", destination: ["Ana@Ejemplo.com"] } }),
  Timestamp: "2026-10-06T12:00:00.000Z",
  SignatureVersion: "2" as const,
  SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem",
};

describe("SNS", () => {
  it("acepta solo URLs de SNS", () => {
    expect(urlSnsValida(base.SigningCertURL, ".pem")).toBe(true);
    expect(urlSnsValida("https://sns.us-east-1.amazonaws.com.evil.com/x.pem", ".pem")).toBe(false);
    expect(urlSnsValida("http://sns.us-east-1.amazonaws.com/x.pem", ".pem")).toBe(false);
    expect(urlSnsValida("https://evil.com/sns.us-east-1.amazonaws.com/x.pem", ".pem")).toBe(false);
    expect(urlSnsValida("https://user@sns.us-east-1.amazonaws.com/x.pem", ".pem")).toBe(false);
    expect(urlSnsValida("https://sns.us-east-1.amazonaws.com/x.txt", ".pem")).toBe(false);
  });

  it("verifica la firma (versión 1 y 2) y detecta cambios", () => {
    const m2 = firmar(base);
    expect(esMensajeSns(m2)).toBe(true);
    expect(firmaValida(m2, pem)).toBe(true);
    const m1 = firmar({ ...base, SignatureVersion: "1" });
    expect(firmaValida(m1, pem)).toBe(true);
    expect(firmaValida({ ...m2, Message: "{}" }, pem)).toBe(false);
    expect(firmaValida({ ...m2, Signature: "basura" }, pem)).toBe(false);
  });

  it("firma la confirmación de suscripción con sus campos", () => {
    const c = firmar({ ...base, Type: "SubscriptionConfirmation", Token: "t", SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription" });
    expect(cadenaAFirmar(c)).toContain("SubscribeURL\n");
    expect(firmaValida(c, pem)).toBe(true);
  });

  it("interpreta entregas, rebotes y quejas", () => {
    expect(interpretarEventoSes(base.Message)).toMatchObject({ tipo: "entregado", messageId: "ses-1", correos: ["ana@ejemplo.com"] });
    const rebote = interpretarEventoSes(
      JSON.stringify({ eventType: "Bounce", mail: { messageId: "x" }, bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "B@x.com" }] } }),
    );
    expect(rebote).toMatchObject({ tipo: "rebotado", correos: ["b@x.com"] });
    expect(interpretarEventoSes(JSON.stringify({ notificationType: "Bounce", bounce: { bounceType: "Transient" } })).tipo).toBe("rebote_temporal");
    expect(interpretarEventoSes(JSON.stringify({ eventType: "Complaint", complaint: { complainedRecipients: [{ emailAddress: "c@x.com" }] } })).tipo).toBe("queja");
    expect(interpretarEventoSes("no json").tipo).toBe("otro");
  });
});
