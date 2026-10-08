"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowRight, Plus, Send, Trash2 } from "lucide-react";
import type { ModuloBorrador } from "@/lib/raciones/servidor";
import { primeraFechaPermitida, validarPlazo } from "@/lib/raciones/plazos";
import { comedoresDestino, frenteVigente, serviciosDestino } from "@/lib/raciones/reglas";
import { clave as claveDe, type ContextoRaciones, type FilaBorrador, type Saldo } from "@/lib/raciones/tipos";
import {
  Confirmar,
  ddmmaaaa,
  EstadoBorrador,
  FueraDePlazo,
  Mensaje,
  nuevoId,
  SelectComedorServicio,
  TablaRegistradas,
  useBorrador,
  useEnvio,
  useNombres,
  useSaldos,
} from "./comun";

const MODULO: ModuloBorrador = "trasladar";

export function Trasladar({ ctx, borrador }: { ctx: ContextoRaciones; borrador: FilaBorrador[] }) {
  const { catalogo, config, ahora, empresa } = ctx;
  const n = useNombres(catalogo);
  const primera = primeraFechaPermitida("traslado", ahora, config) ?? ahora.slice(0, 10);

  const [fecha, setFecha] = useState(primera);
  const [origen, setOrigen] = useState<Saldo | null>(null);
  const [destino, setDestino] = useState({ comedor: "", servicio: "" });
  const [cantidad, setCantidad] = useState("");
  const [aviso, setAviso] = useState("");
  const [fuera, setFuera] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState(false);

  const { filas, setFilas, estado } = useBorrador(MODULO, empresa.id, borrador);
  const registradas = useSaldos(empresa.id, fecha, fecha);
  const envio = useEnvio(MODULO, empresa.id);
  const saltarPlazo = ctx.superadmin && fuera;
  const plazo = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? validarPlazo("traslado", fecha, ahora, config) : ({ ok: false, motivo: "Elige una fecha" } as const);

  /** Cantidad ya comprometida en la grilla por cada origen. */
  const comprometido = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of filas) m.set(claveDe(f), (m.get(claveDe(f)) ?? 0) + f.cantidad);
    return m;
  }, [filas]);
  const disponible = origen ? origen.cantidad - (comprometido.get(claveDe(origen)) ?? 0) : 0;

  const comedoresPosibles = origen ? comedoresDestino(catalogo, origen.comedor_id) : [];
  const serviciosPosibles = origen && destino.comedor ? serviciosDestino(catalogo, origen.comedor_id, origen.servicio_id, destino.comedor) : [];

  const problemas = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of filas) {
      const p = validarPlazo("traslado", f.fecha, ahora, config);
      if (!p.ok && !saltarPlazo) m.set(f.id, p.motivo);
      else if (!frenteVigente(catalogo, f.frente_id, f.fecha)) m.set(f.id, "El contrato del frente no cubre esta fecha");
    }
    return m;
  }, [filas, ahora, config, saltarPlazo, catalogo]);

  const limpiarEnvio = envio.limpiar;
  const elegir = useCallback(
    (s: Saldo) => {
      limpiarEnvio();
      setOrigen(s);
      setDestino({ comedor: "", servicio: "" });
      setCantidad("");
      setAviso("");
    },
    [limpiarEnvio],
  );

  function agregar() {
    if (!origen) return;
    const cant = Number.parseInt(cantidad, 10);
    if (!destino.comedor || !destino.servicio) return setAviso("Elige el comedor y el servicio de destino.");
    if (!Number.isFinite(cant) || cant < 1) return setAviso("Indica una cantidad mayor que 0.");
    if (cant > disponible) return setAviso(`Solo puedes trasladar hasta ${disponible} raciones.`);
    setFilas((prev) => [
      ...prev,
      {
        id: nuevoId(),
        fecha: origen.fecha,
        frente_id: origen.frente_id,
        comedor_id: origen.comedor_id,
        servicio_id: origen.servicio_id,
        comedor_destino_id: destino.comedor,
        servicio_destino_id: destino.servicio,
        cantidad: cant,
      },
    ]);
    setAviso("");
    setCantidad("");
  }

  function enviar() {
    envio.enviar(filas, saltarPlazo ? motivo : undefined, (ok) => {
      setConfirmar(false);
      if (ok) {
        setFilas([]);
        setMotivo("");
        setFuera(false);
        setOrigen(null);
        registradas.recargar();
      }
    });
  }

  const total = filas.reduce((s, f) => s + f.cantidad, 0);
  const puedeEnviar = filas.length > 0 && problemas.size === 0 && (!saltarPlazo || motivo.trim().length >= 5);

  const habilitado = plazo.ok || saltarPlazo;
  const accionTabla = useMemo(
    () =>
      habilitado
        ? { texto: "Trasladar", onClick: elegir, activo: (s: Saldo) => !!origen && claveDe(s) === claveDe(origen) }
        : undefined,
    [habilitado, elegir, origen],
  );

  return (
    <div className="space-y-6">
      <section className="panel space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-oliva">Traslados de raciones · {empresa.nombre}</h2>
            <p className="text-xs text-gris-medio">
              Cambia el comedor o el servicio de raciones ya registradas: mismo sector y un servicio compatible. Plazo: hasta{" "}
              {config.horasTraslado} horas antes del inicio del día.
            </p>
          </div>
          <label className="block">
            <span className="etiqueta">Fecha *</span>
            <input
              type="date"
              value={fecha}
              min={saltarPlazo ? undefined : primera}
              onChange={(e) => {
                if (e.target.value) setFecha(e.target.value);
                setOrigen(null);
              }}
              className="campo"
            />
          </label>
        </div>
        {!plazo.ok && !saltarPlazo && <Mensaje tipo="aviso">{plazo.motivo}</Mensaje>}
        {ctx.superadmin && <FueraDePlazo activo={fuera} setActivo={setFuera} motivo={motivo} setMotivo={setMotivo} />}
      </section>

      <TablaRegistradas
        saldos={registradas.saldos}
        catalogo={catalogo}
        cargando={registradas.cargando}
        titulo={`Raciones registradas el ${ddmmaaaa(fecha)}`}
        accion={accionTabla}
      />

      {origen && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="panel space-y-1 text-sm">
            <h3 className="font-semibold text-oliva">Raciones actuales en el sistema</h3>
            <p>
              {n.proyecto(origen.frente_id)} · {n.area(origen.frente_id)} · {n.frente(origen.frente_id)}
            </p>
            <p>
              Comedor: <strong>{n.comedor(origen.comedor_id)}</strong> · Servicio: <strong>{n.servicio(origen.servicio_id)}</strong>
            </p>
            <p>
              Cantidad: <strong>{origen.cantidad}</strong>
              {disponible !== origen.cantidad && <> (disponibles para trasladar: {disponible})</>}
            </p>
          </div>
          <div className="panel space-y-3">
            <h3 className="font-semibold text-oliva">Raciones a trasladar</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectComedorServicio
                catalogo={catalogo}
                comedor={destino.comedor}
                servicio={destino.servicio}
                onChange={setDestino}
                comedores={comedoresPosibles}
                servicios={serviciosPosibles}
                etiquetaComedor="Comedor destino *"
                etiquetaServicio="Servicio destino *"
              />
              <label className="block">
                <span className="etiqueta">Cantidad *</span>
                <input type="number" min={1} max={disponible} value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="campo" />
              </label>
            </div>
            {destino.comedor && serviciosPosibles.length === 0 && (
              <p className="text-xs text-red-800">Ese comedor no ofrece un servicio compatible.</p>
            )}
            <button type="button" className="btn-oliva" onClick={agregar} disabled={disponible < 1}>
              <Plus className="size-4" aria-hidden /> Agregar
            </button>
            {aviso && <Mensaje tipo="aviso">{aviso}</Mensaje>}
          </div>
        </section>
      )}

      {envio.resultado?.ok && <Mensaje tipo="ok">Se enviaron {envio.resultado.filas} traslados. Recibirás la confirmación por correo.</Mensaje>}
      {envio.resultado && !envio.resultado.ok && <Mensaje tipo="error">{envio.resultado.error}</Mensaje>}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-oliva">Previsualización de traslados</h2>
          <EstadoBorrador estado={estado} />
        </div>
        <div className="overflow-auto rounded-xl shadow">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Frente trabajo</th>
                <th scope="col">Origen</th>
                <th scope="col">
                  <span className="sr-only">hacia</span>
                </th>
                <th scope="col">Destino</th>
                <th scope="col" className="text-right!">
                  Cant.
                </th>
                <th scope="col">
                  <span className="sr-only">Quitar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className="whitespace-nowrap">
                    {ddmmaaaa(f.fecha)}
                    {problemas.get(f.id) && <span className="block max-w-56 text-xs text-red-800">{problemas.get(f.id)}</span>}
                  </td>
                  <td>
                    {n.frente(f.frente_id)}
                    <span className="block text-xs text-gris-medio">
                      {n.proyecto(f.frente_id)} · {n.area(f.frente_id)}
                    </span>
                  </td>
                  <td>
                    {n.comedor(f.comedor_id)} · {n.servicio(f.servicio_id)} <span className="font-semibold text-red-800">−{f.cantidad}</span>
                  </td>
                  <td className="text-center">
                    <ArrowRight className="mx-auto size-4 text-gris-medio" aria-label="hacia" />
                  </td>
                  <td>
                    {n.comedor(f.comedor_destino_id ?? "")} · {n.servicio(f.servicio_destino_id ?? "")}{" "}
                    <span className="font-semibold text-green-800">+{f.cantidad}</span>
                  </td>
                  <td className="text-right tabular-nums">{f.cantidad}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setFilas((prev) => prev.filter((x) => x.id !== f.id))}
                      className="btn-icono text-red-700 hover:bg-red-50"
                      aria-label={`Quitar el traslado del ${ddmmaaaa(f.fecha)}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {!filas.length && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-gris-medio">
                    Elige una ración registrada y agrega el traslado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {filas.length > 0 && (
            <button type="button" className="btn-secundario" onClick={() => setFilas([])}>
              Vaciar
            </button>
          )}
          <button type="button" className="btn-marca" disabled={!puedeEnviar || envio.pendiente} onClick={() => setConfirmar(true)}>
            <Send className="size-4" aria-hidden /> Enviar
          </button>
        </div>
      </section>

      <Confirmar abierto={confirmar} titulo="Confirmar traslados" pendiente={envio.pendiente} onCancelar={() => setConfirmar(false)} onConfirmar={enviar}>
        <p>
          Vas a enviar <strong>{filas.length}</strong> traslados por un total de <strong>{total}</strong> raciones para{" "}
          <strong>{empresa.nombre}</strong>.
        </p>
        <p>Esta acción no se puede deshacer.</p>
        {saltarPlazo && <p className="text-red-800">Se registrará fuera de plazo con el motivo indicado.</p>}
      </Confirmar>
    </div>
  );
}
