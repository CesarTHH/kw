"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FileSpreadsheet, Play, Upload, X } from "lucide-react";
import { crearImportacion, importarPaso, pendientesImportacion, simularImportacion, type Paso } from "@/app/(privado)/admin/importador/acciones";
import { tamanoLegible } from "@/lib/archivos";
import { MAX_BYTES_IMPORTACION, TIPOS_ARCHIVO, tipoArchivo } from "@/lib/importador/archivos";

/** Subir los archivos y ejecutar la simulación. */
export function SubirArchivos() {
  const router = useRouter();
  const selector = useRef<HTMLInputElement>(null);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [estado, setEstado] = useState("");
  const [error, setError] = useState("");
  const [pendiente, startTransition] = useTransition();

  function agregar(lista: FileList | null) {
    if (!lista) return;
    setArchivos((actual) => {
      const nuevos = Array.from(lista).filter((f) => !actual.some((a) => a.name === f.name));
      return [...actual, ...nuevos].slice(0, 10);
    });
    if (selector.current) selector.current.value = "";
  }

  function subir() {
    setError("");
    const grandes = archivos.find((a) => a.size > MAX_BYTES_IMPORTACION);
    if (grandes) return setError(`"${grandes.name}" pasa de 50 MB.`);
    const desconocido = archivos.find((a) => !tipoArchivo(a.name));
    if (desconocido) return setError(`No se reconoce "${desconocido.name}". Usa los nombres de los archivos actuales.`);
    startTransition(async () => {
      setEstado("Preparando…");
      const r = await crearImportacion(archivos.map((a) => ({ nombre: a.name, tamano: a.size })));
      if (!r.ok) {
        setEstado("");
        return setError(r.error);
      }
      for (const [i, a] of archivos.entries()) {
        const s = r.datos.subidas[i]!;
        setEstado(`Subiendo ${i + 1} de ${archivos.length}: ${a.name}`);
        const cuerpo = new FormData();
        cuerpo.append("cacheControl", "0");
        cuerpo.append("", new Blob([a], { type: s.tipo }), a.name);
        const res = await fetch(s.url, { method: "PUT", body: cuerpo, headers: { "x-upsert": "false" } }).catch(() => null);
        if (!res?.ok) {
          setEstado("");
          return setError(`No se pudo subir "${a.name}". Revisa tu conexión e inténtalo de nuevo.`);
        }
      }
      setEstado("Leyendo y revisando los archivos (puede tardar uno o dos minutos)…");
      const s = await simularImportacion(r.datos.id);
      setEstado("");
      if (!s.ok) {
        router.push(`/admin/importador?id=${r.datos.id}`);
        return setError(s.error);
      }
      setArchivos([]);
      router.push(`/admin/importador?id=${r.datos.id}`);
      router.refresh();
    });
  }

  return (
    <section className="panel space-y-3" aria-busy={pendiente}>
      <h2 className="text-lg font-semibold text-oliva">Nueva importación</h2>
      <p className="text-sm">
        Sube el Excel <strong>DATA SOLICITUD</strong> y/o los CSV <strong>MAESTRO DE …</strong> con el mismo formato de hoy. Primero se
        hace una <strong>simulación</strong> que no cambia nada; después decides si importar.
      </p>
      <input
        ref={selector}
        type="file"
        multiple
        accept=".csv,.xlsx"
        className="sr-only"
        id="archivos-importacion"
        onChange={(e) => agregar(e.target.files)}
        disabled={pendiente}
      />
      <label htmlFor="archivos-importacion" className="btn-secundario inline-flex cursor-pointer items-center gap-2">
        <FileSpreadsheet className="size-4" aria-hidden /> Elegir archivos
      </label>
      {archivos.length > 0 && (
        <ul className="divide-y divide-gris-medio/30 rounded bg-white text-sm">
          {archivos.map((a) => {
            const t = tipoArchivo(a.name);
            return (
              <li key={a.name} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className={`text-xs ${t ? "text-gris-medio" : "text-red-800"}`}>
                    {t ? TIPOS_ARCHIVO[t] : "No reconocido"} · {tamanoLegible(a.size)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setArchivos((x) => x.filter((y) => y !== a))}
                  disabled={pendiente}
                  className="rounded p-1 text-oliva hover:bg-gris-claro"
                  aria-label={`Quitar ${a.name}`}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="alerta-error">
          {error}
        </p>
      )}
      {estado && (
        <p role="status" className="text-sm text-oliva">
          {estado}
        </p>
      )}
      <button type="button" onClick={subir} disabled={pendiente || !archivos.length} className="btn-marca inline-flex items-center gap-2">
        <Upload className="size-4" aria-hidden /> Subir y simular
      </button>
    </section>
  );
}

/** Ejecuta (o continúa) la importación paso a paso, con barra de avance. */
export function EjecutarImportacion({ id, estado, errores }: { id: string; estado: string; errores: number }) {
  const router = useRouter();
  const [acepto, setAcepto] = useState(false);
  const [avance, setAvance] = useState<{ hechos: number; total: number; texto: string } | null>(null);
  const [error, setError] = useState("");
  const [pendiente, startTransition] = useTransition();
  const continuar = estado === "importando" || estado === "fallido";

  function ejecutar() {
    setError("");
    startTransition(async () => {
      const p = await pendientesImportacion(id);
      if (!p.ok) return setError(p.error);
      const pasos: { paso: Paso; texto: string }[] = [
        ...(p.datos.estado !== "importando" ? [{ paso: { tipo: "inicio" } as Paso, texto: "Iniciando" }] : []),
        ...(p.datos.catalogos ? [{ paso: { tipo: "catalogos" } as Paso, texto: "Tablas maestras" }] : []),
        ...p.datos.lotes.map((n) => ({ paso: { tipo: "lote", n } as Paso, texto: `Historial: lote ${n + 1}` })),
        ...p.datos.meses.map((mes) => ({ paso: { tipo: "saldos", mes } as Paso, texto: `Saldos de ${mes.slice(5, 7)}/${mes.slice(0, 4)}` })),
        { paso: { tipo: "fin" }, texto: "Terminando" },
      ];
      for (const [i, s] of pasos.entries()) {
        setAvance({ hechos: i, total: pasos.length, texto: s.texto });
        let r = await importarPaso(id, s.paso);
        // Un corte de red no debe perder el avance: se reintenta una vez.
        if (!r.ok && !/permiso|no coinciden|no está en curso|no existe/i.test(r.error)) r = await importarPaso(id, s.paso);
        if (!r.ok) {
          await importarPaso(id, { tipo: "fallo", detalle: `${s.texto}: ${r.error}` });
          setAvance(null);
          setError(`${s.texto}: ${r.error} Puedes corregir y volver a intentar; lo ya importado no se duplica.`);
          router.refresh();
          return;
        }
      }
      setAvance({ hechos: 1, total: 1, texto: "Listo" });
      router.refresh();
    });
  }

  const porcentaje = avance ? Math.round((avance.hechos / Math.max(1, avance.total)) * 100) : 0;
  return (
    <div className="space-y-3">
      {errores > 0 && !continuar && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} className="mt-1 size-4 accent-marca" />
          Entiendo que las {errores} filas con error no se importan (puedo corregirlas y volver a importar después).
        </label>
      )}
      {avance && (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentaje} aria-label="Avance de la importación" className="space-y-1">
          <div className="h-3 overflow-hidden rounded-full bg-gris-claro">
            <div className="h-3 rounded-full bg-marca transition-all" style={{ width: `${porcentaje}%` }} />
          </div>
          <p className="text-sm text-oliva">
            {porcentaje}% · {avance.texto}… No cierres esta página.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="alerta-error">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={ejecutar}
        disabled={pendiente || (errores > 0 && !continuar && !acepto)}
        className="btn-marca inline-flex items-center gap-2"
      >
        <Play className="size-4" aria-hidden /> {continuar ? "Continuar la importación" : "Importar"}
      </button>
    </div>
  );
}
