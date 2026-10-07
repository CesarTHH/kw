import { describe, expect, it } from "vitest";
import { escaparHtml, formatearValor, renderizar, tablaTexto } from "../../../supabase/functions/_shared/plantilla";

const globales = { url_app: "https://portal.example.com", correo_contacto: "adm@example.com" };
const columnas = [
  { clave: "fecha", titulo: "Fecha" },
  { clave: "servicio", titulo: "Servicio" },
  { clave: "cantidad", titulo: "Cantidad" },
];

describe("plantillas de correo", () => {
  it("escapa HTML en los valores", () => {
    expect(escaparHtml(`<script>"x"&'y'`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;");
  });

  it("formatea fechas ISO como en los correos actuales", () => {
    expect(formatearValor("2026-10-12")).toBe("12/10/2026");
    expect(formatearValor(-20)).toBe("-20");
    expect(formatearValor(null)).toBe("");
  });

  it("arma asunto, tabla y pie", () => {
    const c = renderizar(
      {
        asunto: "Detalle de Programación de Raciones - {{ruc}}",
        html: "<p>Estimada empresa<br><strong>{{empresa}}</strong></p>{{tabla_registros}}{{pie_facturacion}}",
        texto: "Estimada empresa {{empresa}}\n{{tabla_registros}}",
        columnas,
      },
      {
        ruc: "20999999019",
        empresa: "DEMO <ALFA>",
        registros: [{ fecha: "2026-10-12", servicio: "ALMUERZO", cantidad: 5 }],
      },
      globales,
    );
    expect(c.asunto).toBe("Detalle de Programación de Raciones - 20999999019");
    expect(c.html).toContain("DEMO &lt;ALFA&gt;");
    expect(c.html).toContain("12/10/2026");
    expect(c.html).toContain("adm@example.com");
    expect(c.html.startsWith("<!doctype html>")).toBe(true);
    expect(c.texto).toContain("Fecha | Servicio | Cantidad");
    expect(c.texto).toContain("12/10/2026 | ALMUERZO | 5");
  });

  it("no inyecta HTML desde los registros ni deja variables sin reemplazar", () => {
    const c = renderizar(
      { asunto: "{{desconocida}}Hola\n{{usuario}}", html: "{{tabla_registros}} {{nada}}", texto: "", columnas },
      { usuario: "Ana", registros: [{ servicio: "<img src=x onerror=alert(1)>" }] },
      globales,
    );
    expect(c.asunto).toBe("Hola Ana");
    expect(c.html).not.toContain("<img");
    expect(c.html).not.toContain("{{");
  });

  it("usa las variables globales", () => {
    const c = renderizar({ asunto: "x", html: "{{url_app}}", texto: "{{url_app}}", columnas: [] }, { url_app: "malo" }, globales);
    expect(c.texto).toBe("https://portal.example.com");
  });

  it("respeta los saltos de línea de la composición en la tabla HTML", () => {
    const c = renderizar({ asunto: "x", html: "{{tabla_registros}}", texto: "", columnas: [{ clave: "c", titulo: "C" }] }, { registros: [{ c: "2 FRUTA\n1 <GASEOSA>" }] }, globales);
    expect(c.html).toContain("2 FRUTA<br>1 &lt;GASEOSA&gt;");
  });

  it("arma la tabla en texto plano", () => {
    expect(tablaTexto(columnas, [])).toBe("Fecha | Servicio | Cantidad");
  });
});
