"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { CheckCircle2, Paperclip, Send, X } from "lucide-react";
import { enviarContacto } from "@/app/(privado)/contactanos/acciones";
import { tamanoLegible } from "@/lib/archivos";

const ACEPTA = ".pdf,.png,.jpg,.jpeg,.xlsx,.docx,application/pdf,image/png,image/jpeg";

export function FormContacto({ para, ccMaximo, maxBytes }: { para: string; ccMaximo: number; maxBytes: number }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const selector = useRef<HTMLInputElement>(null);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string>();
  const [enviado, setEnviado] = useState(false);
  const [pendiente, startTransition] = useTransition();
  const total = archivos.reduce((s, a) => s + a.size, 0);

  function agregar(lista: FileList | null) {
    if (!lista) return;
    setArchivos((actual) => [...actual, ...Array.from(lista)].slice(0, 10));
    if (selector.current) selector.current.value = "";
  }

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    setEnviado(false);
    if (total > maxBytes) return setError(`Los adjuntos superan el máximo de ${tamanoLegible(maxBytes)}.`);
    const datos = new FormData(e.currentTarget);
    datos.delete("selector");
    for (const a of archivos) datos.append("adjuntos", a);
    datos.set("clave", clave);
    startTransition(async () => {
      const r = await enviarContacto(datos);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      form.current?.reset();
      setArchivos([]);
      setClave(crypto.randomUUID());
      setEnviado(true);
      router.refresh();
    });
  }

  return (
    <form ref={form} onSubmit={enviar} className="panel space-y-4" aria-busy={pendiente}>
      {enviado && (
        <p className="alerta-ok flex items-center gap-2" role="status">
          <CheckCircle2 className="size-5" aria-hidden /> Mensaje enviado. También te llegará una copia a tu correo.
        </p>
      )}
      {error && (
        <p role="alert" className="alerta-error">
          {error}
        </p>
      )}
      <div className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:items-center">
        <span className="etiqueta">Para</span>
        <p className="rounded bg-gris-panel px-3 py-2 text-sm">{para}</p>
      </div>
      <label className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:items-center">
        <span className="etiqueta">CC</span>
        <input
          name="cc"
          className="campo"
          placeholder={`Opcional, hasta ${ccMaximo} correos separados por coma`}
          autoComplete="off"
          maxLength={1000}
        />
      </label>
      <label className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:items-center">
        <span className="etiqueta">Asunto</span>
        <input name="asunto" required maxLength={200} className="campo" />
      </label>
      <label className="block">
        <span className="etiqueta">Mensaje</span>
        <textarea name="mensaje" required maxLength={5000} rows={8} className="campo" />
      </label>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-secundario inline-flex cursor-pointer items-center gap-2">
            <Paperclip className="size-4" aria-hidden /> Adjuntar archivos
            <input
              ref={selector}
              name="selector"
              type="file"
              multiple
              accept={ACEPTA}
              className="sr-only"
              onChange={(e) => agregar(e.target.files)}
            />
          </label>
          <span className={`text-xs ${total > maxBytes ? "font-semibold text-red-800" : "text-gris-medio"}`}>
            {archivos.length} de 10 archivos · {tamanoLegible(total)} de {tamanoLegible(maxBytes)} · PDF, PNG, JPG, Excel o Word
          </span>
        </div>
        {archivos.length > 0 && (
          <ul className="divide-y divide-gris-medio/20 rounded border border-gris-medio/30 text-sm">
            {archivos.map((a, i) => (
              <li key={`${a.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-xs text-gris-medio">{tamanoLegible(a.size)}</span>
                <button
                  type="button"
                  onClick={() => setArchivos((l) => l.filter((_, j) => j !== i))}
                  aria-label={`Quitar ${a.name}`}
                  className="btn-icono hover:bg-gris-panel"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <button type="submit" className="btn-marca" disabled={pendiente}>
          <Send className="size-4" aria-hidden /> {pendiente ? "Enviando…" : "Enviar"}
        </button>
      </div>
    </form>
  );
}
