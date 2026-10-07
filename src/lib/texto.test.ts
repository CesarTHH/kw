import { describe, expect, it } from "vitest";
import { bloques, trozos } from "./texto";

describe("texto enriquecido básico", () => {
  it("negrita, cursiva y enlaces", () => {
    expect(trozos("Hola **equipo**, ver *aquí* https://kw.pe/a.")).toEqual([
      { t: "texto", v: "Hola " },
      { t: "negrita", v: "equipo" },
      { t: "texto", v: ", ver " },
      { t: "cursiva", v: "aquí" },
      { t: "texto", v: " " },
      { t: "enlace", v: "https://kw.pe/a" },
      { t: "texto", v: "." },
    ]);
  });
  it("no convierte enlaces que no son https", () => {
    expect(trozos("javascript:alert(1) http://x.com")).toEqual([{ t: "texto", v: "javascript:alert(1) http://x.com" }]);
  });
  it("arma párrafos y listas", () => {
    const b = bloques("Aviso\nsegunda línea\n\n- uno\n- dos");
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ t: "parrafo" });
    expect(b[1]).toEqual({ t: "lista", items: [[{ t: "texto", v: "uno" }], [{ t: "texto", v: "dos" }]] });
  });
  it("deja el HTML como texto", () => {
    expect(trozos("<img src=x onerror=alert(1)>")).toEqual([{ t: "texto", v: "<img src=x onerror=alert(1)>" }]);
  });
});
