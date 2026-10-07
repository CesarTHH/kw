import { describe, expect, it } from "vitest";
import { contentDisposition, detectarTipo, MIME_DOCX, MIME_XLSX, nombreSeguro, tamanoLegible } from "./archivos";

const bytes = (...partes: (number[] | string)[]) =>
  new Uint8Array(partes.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)));

describe("detectarTipo", () => {
  it("reconoce un PDF por su firma", () => {
    expect(detectarTipo(bytes("%PDF-1.7\n..."))?.mime).toBe("application/pdf");
  });
  it("reconoce PNG y JPEG", () => {
    expect(detectarTipo(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))?.ext).toBe("png");
    expect(detectarTipo(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))?.ext).toBe("jpg");
  });
  it("distingue Word y Excel dentro del ZIP", () => {
    expect(detectarTipo(bytes([0x50, 0x4b, 0x03, 0x04], "....[Content_Types].xml....word/document.xml"))?.mime).toBe(MIME_DOCX);
    expect(detectarTipo(bytes([0x50, 0x4b, 0x03, 0x04], "....[Content_Types].xml....xl/workbook.xml"))?.mime).toBe(MIME_XLSX);
  });
  it("rechaza un ejecutable renombrado como PDF y un ZIP cualquiera", () => {
    expect(detectarTipo(bytes("MZ\x90\x00\x03\x00\x00\x00"))).toBeNull();
    expect(detectarTipo(bytes([0x50, 0x4b, 0x03, 0x04], "otra-cosa.txt...."))).toBeNull();
    expect(detectarTipo(bytes("%PD"))).toBeNull();
  });
});

describe("nombreSeguro", () => {
  it("quita rutas y caracteres peligrosos", () => {
    expect(nombreSeguro("C:\\temp\\..\\carta \"final\".pdf")).toBe("carta final.pdf");
    expect(nombreSeguro("../../etc/passwd")).toBe("passwd");
    expect(nombreSeguro("..")).toBe("archivo");
    expect(nombreSeguro("a\nb.pdf")).toBe("ab.pdf");
  });
});

describe("otros", () => {
  it("muestra tamaños legibles", () => {
    expect(tamanoLegible(500)).toBe("500 B");
    expect(tamanoLegible(1536)).toBe("1,5 KB");
    expect(tamanoLegible(10 * 1024 * 1024)).toBe("10 MB");
  });
  it("arma Content-Disposition con tildes", () => {
    expect(contentDisposition("attachment", "Menú semana.pdf")).toBe(
      `attachment; filename="Menu semana.pdf"; filename*=UTF-8''Men%C3%BA%20semana.pdf`,
    );
  });
});
