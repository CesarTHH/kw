"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { consultarSaldos, enviarRaciones, guardarBorrador, type ResultadoEnvio } from "@/app/(privado)/raciones/acciones";
import type { ModuloBorrador } from "@/lib/raciones/servidor";
import { clave as claveDe, type Catalogo, type FilaBorrador, type Saldo } from "@/lib/raciones/tipos";

export const ddmmaaaa = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
export const nuevoId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));

/** Nombres legibles a partir del catálogo. */
export function useNombres(c: Catalogo) {
  return useMemo(() => {
    const frentes = new Map(c.frentes.map((f) => [f.id, f]));
    const comedores = new Map(c.comedores.map((x) => [x.id, x.nombre]));
    const servicios = new Map(c.servicios.map((x) => [x.id, x.nombre]));
    return {
      frente: (id: string) => frentes.get(id)?.nombre ?? "—",
      proyecto: (id: string) => frentes.get(id)?.proyecto ?? "—",
      area: (id: string) => frentes.get(id)?.area ?? "—",
      comedor: (id: string) => comedores.get(id) ?? "—",
      servicio: (id: string) => servicios.get(id) ?? "—",
    };
  }, [c]);
}

/** Borrador guardado en el servidor (se guarda solo, 1 segundo después del último cambio). */
export function useBorrador(modulo: ModuloBorrador, empresaId: string, inicial: FilaBorrador[]) {
  const [filas, setFilasEstado] = useState<FilaBorrador[]>(inicial);
  const [estado, setEstado] = useState<"guardado" | "guardando" | "error">("guardado");
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    const t = setTimeout(() => {
      guardarBorrador(modulo, empresaId, filas)
        .then((r) => setEstado(r.ok ? "guardado" : "error"))
        .catch(() => setEstado("error"));
    }, 1000);
    return () => clearTimeout(t);
  }, [filas, modulo, empresaId]);
  const setFilas = useCallback((u: FilaBorrador[] | ((prev: FilaBorrador[]) => FilaBorrador[])) => {
    setEstado("guardando");
    setFilasEstado(u);
  }, []);
  return { filas, setFilas, estado };
}

/** Saldos registrados en un rango, recargables después de enviar. */
export function useSaldos(empresaId: string, desde: string, hasta: string) {
  const [datos, setDatos] = useState<{ clave: string; saldos: Saldo[] }>({ clave: "", saldos: [] });
  const [version, setVersion] = useState(0);
  const valido = !!desde && !!hasta && hasta >= desde;
  const clavePedido = `${empresaId}|${desde}|${hasta}|${version}`;
  useEffect(() => {
    if (!valido) return;
    let vigente = true;
    consultarSaldos(empresaId, desde, hasta)
      .catch((): Saldo[] => [])
      .then((saldos) => {
        if (vigente) setDatos({ clave: clavePedido, saldos });
      });
    return () => {
      vigente = false;
    };
  }, [empresaId, desde, hasta, valido, clavePedido]);
  const saldos = useMemo(() => (valido ? datos.saldos : []), [valido, datos.saldos]);
  const mapa = useMemo(() => new Map(saldos.map((s) => [claveDe(s), s.cantidad])), [saldos]);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  return { saldos, mapa, cargando: valido && datos.clave !== clavePedido, recargar };
}

/** Envío con confirmación, clave de idempotencia y motivo opcional (Superadmin). */
export function useEnvio(modulo: ModuloBorrador, empresaId: string) {
  // La clave se mantiene mientras el contenido no cambie: reintentar lo mismo no duplica;
  // si el usuario cambia la grilla, el envío es otro y lleva otra clave.
  const ultimo = useRef<{ contenido: string; clave: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);
  const enviar = (filas: FilaBorrador[], motivo: string | undefined, alTerminar: (ok: boolean) => void) => {
    setResultado(null);
    const contenido = JSON.stringify([filas, motivo ?? ""]);
    if (ultimo.current?.contenido !== contenido) ultimo.current = { contenido, clave: nuevoId() };
    const clave = ultimo.current.clave;
    iniciar(async () => {
      const r = await enviarRaciones(modulo, empresaId, filas, clave, motivo).catch(
        (): ResultadoEnvio => ({ ok: false, error: "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo." }),
      );
      setResultado(r);
      if (r.ok) ultimo.current = null;
      alTerminar(r.ok);
    });
  };
  const limpiar = useCallback(() => setResultado(null), []);
  return { enviar, pendiente, resultado, limpiar };
}

export function Mensaje({ tipo, children }: { tipo: "ok" | "error" | "aviso"; children: React.ReactNode }) {
  const clase =
    tipo === "ok" ? "alerta-ok" : tipo === "error" ? "alerta-error" : "rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900";
  return (
    <div role={tipo === "error" ? "alert" : "status"} className={clase}>
      {children}
    </div>
  );
}

/** Ventana de confirmación antes de enviar. */
export function Confirmar({
  abierto,
  titulo,
  children,
  onCancelar,
  onConfirmar,
  pendiente,
}: {
  abierto: boolean;
  titulo: string;
  children: React.ReactNode;
  onCancelar: () => void;
  onConfirmar: () => void;
  pendiente: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!pendiente) onCancelar();
      }}
      className="m-auto w-[min(32rem,92vw)] rounded-xl p-0 shadow-2xl backdrop:bg-black/40"
      aria-labelledby="titulo-confirmar"
    >
      <div className="bg-marca px-5 py-3 font-semibold text-white" id="titulo-confirmar">
        {titulo}
      </div>
      <div className="space-y-3 p-5 text-sm">{children}</div>
      <div className="flex justify-end gap-2 border-t border-gris-claro p-4">
        <button type="button" className="btn-secundario" onClick={onCancelar} disabled={pendiente}>
          Cancelar
        </button>
        <button type="button" className="btn-marca" onClick={onConfirmar} disabled={pendiente} aria-busy={pendiente}>
          {pendiente ? "Enviando…" : "Sí, enviar"}
        </button>
      </div>
    </dialog>
  );
}

/** Interruptor y campo de motivo para que el Superadmin registre fuera de plazo. */
export function FueraDePlazo({
  activo,
  setActivo,
  motivo,
  setMotivo,
}: {
  activo: boolean;
  setActivo: (v: boolean) => void;
  motivo: string;
  setMotivo: (v: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
      <label className="flex items-center gap-2 font-semibold text-red-900">
        <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="size-4 accent-marca" />
        Registrar fuera de plazo (solo Superadmin)
      </label>
      {activo && (
        <label className="block">
          <span className="etiqueta">Motivo (obligatorio, queda en la auditoría)</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} className="campo" />
        </label>
      )}
    </div>
  );
}

/** Tabla de raciones ya registradas (solo lectura). Memorizada: no se vuelve a dibujar al escribir en el formulario. */
export const TablaRegistradas = memo(function TablaRegistradas({
  saldos,
  catalogo,
  titulo = "Raciones registradas",
  cargando,
  accion,
}: {
  saldos: Saldo[];
  catalogo: Catalogo;
  titulo?: string;
  cargando?: boolean;
  accion?: { texto: string; onClick: (s: Saldo) => void; activo?: (s: Saldo) => boolean };
}) {
  const n = useNombres(catalogo);
  const total = useMemo(() => saldos.reduce((s, x) => s + x.cantidad, 0), [saldos]);
  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-oliva">
        {titulo} {cargando && <span className="text-xs font-normal text-gris-medio">(cargando…)</span>}
      </h2>
      <div className="max-h-96 overflow-auto rounded-xl shadow">
        <table className="tabla">
          <thead className="sticky top-0">
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Proyecto</th>
              <th scope="col">Área</th>
              <th scope="col">Frente trabajo</th>
              <th scope="col">Comedor</th>
              <th scope="col">Servicio</th>
              <th scope="col" className="text-right!">
                Cant.
              </th>
              {accion && (
                <th scope="col">
                  <span className="sr-only">Acción</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {saldos.map((s) => (
              <tr key={claveDe(s)} className={accion?.activo?.(s) ? "outline-2 -outline-offset-2 outline-marca" : undefined}>
                <td className="whitespace-nowrap">{ddmmaaaa(s.fecha)}</td>
                <td>{n.proyecto(s.frente_id)}</td>
                <td>{n.area(s.frente_id)}</td>
                <td>{n.frente(s.frente_id)}</td>
                <td>{n.comedor(s.comedor_id)}</td>
                <td>{n.servicio(s.servicio_id)}</td>
                <td className="text-right tabular-nums">{s.cantidad}</td>
                {accion && (
                  <td>
                    <button type="button" className="btn-secundario min-h-8! px-3! py-1! text-xs" onClick={() => accion.onClick(s)}>
                      {accion.texto}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!saldos.length && (
              <tr>
                <td colSpan={accion ? 8 : 7} className="py-4 text-center text-gris-medio">
                  {cargando ? "Cargando…" : "No hay raciones registradas en estas fechas."}
                </td>
              </tr>
            )}
          </tbody>
          {saldos.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={6} className="text-right font-semibold">
                  Total
                </td>
                <td className="text-right font-semibold tabular-nums">{total}</td>
                {accion && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
});

/** Selects encadenados Proyecto → Área → Frente. */
export function SelectFrente({
  catalogo,
  proyecto,
  area,
  frente,
  onChange,
}: {
  catalogo: Catalogo;
  proyecto: string;
  area: string;
  frente: string;
  onChange: (v: { proyecto: string; area: string; frente: string }) => void;
}) {
  const proyectos = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of catalogo.frentes) m.set(f.proyecto_id, f.proyecto);
    return [...m.entries()];
  }, [catalogo]);
  const areas = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of catalogo.frentes) if (f.proyecto_id === proyecto) m.set(f.area_id, f.area);
    return [...m.entries()];
  }, [catalogo, proyecto]);
  const frentes = catalogo.frentes.filter((f) => f.proyecto_id === proyecto && f.area_id === area);
  return (
    <>
      <label className="block">
        <span className="etiqueta">Proyecto *</span>
        <select value={proyecto} onChange={(e) => onChange({ proyecto: e.target.value, area: "", frente: "" })} className="campo">
          <option value="">Elige…</option>
          {proyectos.map(([id, nombre]) => (
            <option key={id} value={id}>
              {nombre}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="etiqueta">Área *</span>
        <select
          value={area}
          disabled={!proyecto}
          onChange={(e) => {
            const unico = catalogo.frentes.filter((f) => f.proyecto_id === proyecto && f.area_id === e.target.value);
            onChange({ proyecto, area: e.target.value, frente: unico.length === 1 ? unico[0]!.id : "" });
          }}
          className="campo"
        >
          <option value="">Elige…</option>
          {areas.map(([id, nombre]) => (
            <option key={id} value={id}>
              {nombre}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="etiqueta">Frente de trabajo *</span>
        <select value={frente} disabled={!area} onChange={(e) => onChange({ proyecto, area, frente: e.target.value })} className="campo">
          <option value="">Elige…</option>
          {frentes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nombre}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** Selects Comedor → Servicio (solo los servicios que ofrece el comedor). */
export function SelectComedorServicio({
  catalogo,
  comedor,
  servicio,
  onChange,
  comedores,
  servicios,
  etiquetaComedor = "Comedor *",
  etiquetaServicio = "Servicio *",
}: {
  catalogo: Catalogo;
  comedor: string;
  servicio: string;
  onChange: (v: { comedor: string; servicio: string }) => void;
  comedores?: string[];
  servicios?: string[];
  etiquetaComedor?: string;
  etiquetaServicio?: string;
}) {
  const listaComedores = catalogo.comedores.filter((c) => !comedores || comedores.includes(c.id));
  const ofrecidos = servicios ?? catalogo.comedorServicios[comedor] ?? [];
  const listaServicios = catalogo.servicios.filter((s) => ofrecidos.includes(s.id));
  return (
    <>
      <label className="block">
        <span className="etiqueta">{etiquetaComedor}</span>
        <select value={comedor} onChange={(e) => onChange({ comedor: e.target.value, servicio: "" })} className="campo">
          <option value="">Elige…</option>
          {listaComedores.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="etiqueta">{etiquetaServicio}</span>
        <select value={servicio} disabled={!comedor} onChange={(e) => onChange({ comedor, servicio: e.target.value })} className="campo">
          <option value="">Elige…</option>
          {listaServicios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function EstadoBorrador({ estado }: { estado: "guardado" | "guardando" | "error" }) {
  return (
    <span className="text-xs text-gris-medio" aria-live="polite">
      {estado === "guardando" ? "Guardando borrador…" : estado === "error" ? "No se pudo guardar el borrador" : "Borrador guardado"}
    </span>
  );
}
