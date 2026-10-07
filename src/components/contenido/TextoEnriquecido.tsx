import { bloques, type Trozo } from "@/lib/texto";

function Linea({ trozos }: { trozos: Trozo[] }) {
  return (
    <>
      {trozos.map((t, i) =>
        t.t === "negrita" ? (
          <strong key={i}>{t.v}</strong>
        ) : t.t === "cursiva" ? (
          <em key={i}>{t.v}</em>
        ) : t.t === "enlace" ? (
          <a key={i} href={t.v} target="_blank" rel="noopener noreferrer" className="break-all text-oliva underline">
            {t.v}
          </a>
        ) : (
          <span key={i}>{t.v}</span>
        ),
      )}
    </>
  );
}

/** Dibuja el texto de una alerta (negrita, cursiva, listas y enlaces) sin HTML crudo. */
export function TextoEnriquecido({ texto }: { texto: string }) {
  return (
    <div className="space-y-2">
      {bloques(texto).map((b, i) =>
        b.t === "lista" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>
                <Linea trozos={it} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {b.lineas.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Linea trozos={l} />
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
