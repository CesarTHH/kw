import { describe, expect, it } from "vitest";
import { aBase64, cabecera, construirMime } from "../../../supabase/functions/_shared/mime";

describe("correo MIME con adjuntos", () => {
  const mime = construirMime({
    de: "Facturación <no-responder@kw.pe>",
    para: "adm@kw.pe",
    asunto: "Consulta sobre menú\r\nBcc: intruso@x.com",
    texto: "Hola",
    html: "<p>Hola</p>",
    responderA: "cliente@empresa.pe",
    adjuntos: [{ nombre: "carta \"final\".pdf", tipo: "application/pdf", datos: new Uint8Array([37, 80, 68, 70]) }],
    frontera: "F",
  });

  it("no permite inyectar cabeceras por el asunto", () => {
    expect(mime).not.toMatch(/\r\nBcc:/);
    expect(mime).toContain(`Subject: ${cabecera("Consulta sobre menú Bcc: intruso@x.com")}`);
  });
  it("incluye Reply-To, el texto, el HTML y el adjunto", () => {
    expect(mime).toContain("Reply-To: cliente@empresa.pe");
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="mixto_F"');
    expect(mime).toContain(aBase64(new TextEncoder().encode("<p>Hola</p>")));
    expect(mime).toContain(`Content-Disposition: attachment; filename="carta final.pdf";\r\n filename*=UTF-8''carta%20final.pdf`);
    expect(mime).toContain("JVBERg==");
    expect(mime.endsWith("--mixto_F--\r\n")).toBe(true);
  });
  it("codifica en base64 archivos grandes sin desbordar", () => {
    const grande = new Uint8Array(3_000_000).fill(65);
    expect(aBase64(grande).length).toBe(4_000_000);
  });
});
