"use client";

import { useMemo, useState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import type { ModuloBorrador } from "@/lib/raciones/servidor";
import { primeraFechaPermitida, rangoFechas, sumarDias, ultimaFechaProgramable, validarPlazo } from "@/lib/raciones/plazos";
import { frenteVigente, ofreceServicio } from "@/lib/raciones/reglas";
import { clave as claveDe, type ContextoRaciones, type FilaBorrador } from "@/lib/raciones/tipos";
import {
  Confirmar,
  ddmmaaaa,
  EstadoBorrador,
  FueraDePlazo,
  Mensaje,
  nuevoId,
  SelectComedorServicio,
  SelectFrente,
  TablaRegistradas,
  useBorrador,
  useEnvio,
  useNombres,
  useSaldos,
} from "./comun";

const MODULO: ModuloBorrador = "programar";

export function Programar({ ctx, borrador }: { ctx: ContextoRaciones; borrador: FilaBorrador[] }) {
  const { catalogo, config, ahora, empresa } = ctx;
  const n = useNombres(catalogo);
  const primera = primeraFechaPermitida("programacion", ahora, config) ?? ahora.slice(0, 10);
  const ultima = ultimaFechaProgramable(ahora, config);

  const [sel, setSel] = useState({ proyecto: "", area: "", frente: "" });
  const [cs, setCs] = useState({ comedor: "", servicio: "" });
  const [cantidad, setCantidad] = useState("");
  const [desde, setDesde] = useState(primera);
  const [hasta, setHasta] = useState(sumarDias(primera, 6) > ultima ? ultima : sumarDias(primera, 6));
  const [aviso, setAviso] = useState<string[]>([]);
  const [fuera, setFuera] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState(false);

  const { filas, setFilas, estado } = useBorrador(MODULO, empresa.id, borrador);
  const registradas = useSaldos(empresa.id, primera, ultima);
  const envio = useEnvio(MODULO, empresa.id);
  const saltarPlazo = ctx.superadmin && fuera;

  const total = filas.reduce((s, f) => s + f.cantidad, 0);
  const problemas = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of filas) {
      const p = validarPlazo("programacion", f.fecha, ahora, config);
      if (!p.ok && !saltarPlazo) m.set(f.id, p.motivo);
      else if (!frenteVigente(catalogo, f.frente_id, f.fecha)) m.set(f.id, "El contrato del frente no cubre esta fecha");
      else if (!ofreceServicio(catalogo, f.comedor_id, f.servicio_id)) m.set(f.id, "El comedor ya no ofrece este servicio");
    }
    return m;
  }, [filas, ahora, config, catalogo, saltarPlazo]);

  function agregar() {
    envio.limpiar();
    const cant = Number.parseInt(cantidad, 10);
    const faltan: string[] = [];
    if (!sel.frente) faltan.push("proyecto, área y frente");
    if (!cs.comedor || !cs.servicio) faltan.push("comedor y servicio");
    if (!Number.isFinite(cant) || cant < 1 || cant > 10_000) faltan.push("una cantidad entre 1 y 10 000");
    if (!desde || !hasta || hasta < desde) faltan.push("un rango de fechas válido");
    if (faltan.length) {
      setAviso([`Completa ${faltan.join(", ")}.`]);
      return;
    }
    const omitidas: string[] = [];
    const nuevas: FilaBorrador[] = [];
    for (const fecha of rangoFechas(desde, hasta)) {
      const p = validarPlazo("programacion", fecha, ahora, config);
      if (!p.ok && !saltarPlazo) {
        omitidas.push(p.motivo);
        continue;
      }
      if (!frenteVigente(catalogo, sel.frente, fecha)) {
        omitidas.push(`${ddmmaaaa(fecha)}: el contrato del frente no cubre esta fecha`);
        continue;
      }
      nuevas.push({ id: nuevoId(), fecha, frente_id: sel.frente, comedor_id: cs.comedor, servicio_id: cs.servicio, cantidad: cant });
    }
    setFilas((prev) => {
      const salida = [...prev];
      for (const f of nuevas) {
        const i = salida.findIndex((x) => claveDe(x) === claveDe(f));
        if (i >= 0) salida[i] = { ...salida[i]!, cantidad: Math.min(10_000, salida[i]!.cantidad + f.cantidad) };
        else salida.push(f);
      }
      return salida.sort((a, b) => a.fecha.localeCompare(b.fecha));
    });
    setAviso([...new Set(omitidas)].slice(0, 5));
  }

  function enviar() {
    envio.enviar(filas, saltarPlazo ? motivo : undefined, (ok) => {
      setConfirmar(false);
      if (ok) {
        setFilas([]);
        setMotivo("");
        setFuera(false);
        registradas.recargar();
      }
    });
  }

  const puedeEnviar = filas.length > 0 && problemas.size === 0 && (!saltarPlazo || motivo.trim().length >= 5);

  return (
    <div className="space-y-6">
      <section className="panel space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-oliva">Programación de raciones · {empresa.nombre}</h2>
          <p className="text-xs text-gris-medio">
            Puedes programar del {ddmmaaaa(primera)} al {ddmmaaaa(ultima)}. La semana siguiente cierra el{" "}
            {["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][config.cierre.diaSemana] ?? ""} a las{" "}
            {config.cierre.hora}.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectFrente catalogo={catalogo} {...sel} onChange={setSel} />
          <label className="block">
            <span className="etiqueta">Cantidad por día *</span>
            <input type="number" min={1} max={10000} value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="campo" />
          </label>
          <label className="block">
            <span className="etiqueta">Fecha desde *</span>
            <input
              type="date"
              value={desde}
              min={saltarPlazo ? undefined : primera}
              max={ultima}
              onChange={(e) => setDesde(e.target.value)}
              className="campo"
            />
          </label>
          <label className="block">
            <span className="etiqueta">Fecha hasta *</span>
            <input
              type="date"
              value={hasta}
              min={desde || primera}
              max={ultima}
              onChange={(e) => setHasta(e.target.value)}
              className="campo"
            />
          </label>
          <SelectComedorServicio catalogo={catalogo} comedor={cs.comedor} servicio={cs.servicio} onChange={setCs} />
        </div>
        {ctx.superadmin && <FueraDePlazo activo={fuera} setActivo={setFuera} motivo={motivo} setMotivo={setMotivo} />}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-oliva" onClick={agregar}>
            <Plus className="size-4" aria-hidden /> Agregar
          </button>
          <span className="text-xs text-gris-medio">Se crea una fila por cada día del rango.</span>
        </div>
        {aviso.length > 0 && (
          <Mensaje tipo="aviso">
            {aviso.length === 1 ? aviso[0] : "Algunas fechas no se agregaron:"}
            {aviso.length > 1 && (
              <ul className="ml-5 list-disc">
                {aviso.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </Mensaje>
        )}
      </section>

      {envio.resultado?.ok && (
        <Mensaje tipo="ok">Se enviaron {envio.resultado.filas} registros. Recibirás la confirmación por correo.</Mensaje>
      )}
      {envio.resultado && !envio.resultado.ok && <Mensaje tipo="error">{envio.resultado.error}</Mensaje>}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-oliva">Previsualización de raciones por registrar</h2>
          <EstadoBorrador estado={estado} />
        </div>
        <div className="max-h-[28rem] overflow-auto rounded-xl shadow">
          <table className="tabla">
            <thead className="sticky top-0">
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Proyecto</th>
                <th scope="col">Área</th>
                <th scope="col">Frente trabajo</th>
                <th scope="col">Comedor</th>
                <th scope="col">Servicio</th>
                <th scope="col">Cantidad</th>
                <th scope="col">
                  <span className="sr-only">Quitar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const ya = registradas.mapa.get(claveDe(f)) ?? 0;
                const problema = problemas.get(f.id);
                return (
                  <tr key={f.id}>
                    <td className="whitespace-nowrap">
                      {ddmmaaaa(f.fecha)}
                      {problema && <span className="block max-w-56 text-xs text-red-800">{problema}</span>}
                    </td>
                    <td>{n.proyecto(f.frente_id)}</td>
                    <td>{n.area(f.frente_id)}</td>
                    <td>{n.frente(f.frente_id)}</td>
                    <td>{n.comedor(f.comedor_id)}</td>
                    <td>{n.servicio(f.servicio_id)}</td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={f.cantidad}
                        aria-label={`Cantidad del ${ddmmaaaa(f.fecha)}`}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(10_000, Number.parseInt(e.target.value, 10) || 1));
                          setFilas((prev) => prev.map((x) => (x.id === f.id ? { ...x, cantidad: v } : x)));
                        }}
                        className="campo w-24 py-1!"
                      />
                      {ya > 0 && <span className="block text-xs text-amber-800">Ya tienes {ya}; esto suma {f.cantidad} más</span>}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setFilas((prev) => prev.filter((x) => x.id !== f.id))}
                        className="rounded p-1 text-red-700 hover:bg-red-50"
                        aria-label={`Quitar la fila del ${ddmmaaaa(f.fecha)}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!filas.length && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-gris-medio">
                    Agrega raciones con el formulario de arriba.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {filas.length > 0 && (
            <>
              <span className="text-sm">
                {filas.length} registros · <strong>{total}</strong> raciones
              </span>
              <button type="button" className="btn-secundario" onClick={() => setFilas([])}>
                Vaciar
              </button>
            </>
          )}
          <button type="button" className="btn-marca" disabled={!puedeEnviar || envio.pendiente} onClick={() => setConfirmar(true)}>
            <Send className="size-4" aria-hidden /> Enviar
          </button>
        </div>
      </section>

      <TablaRegistradas
        saldos={registradas.saldos}
        catalogo={catalogo}
        cargando={registradas.cargando}
        titulo={`Raciones registradas (del ${ddmmaaaa(primera)} al ${ddmmaaaa(ultima)})`}
      />
      <TotalesMes saldos={registradas.saldos} />

      <Confirmar
        abierto={confirmar}
        titulo="Confirmar envío"
        pendiente={envio.pendiente}
        onCancelar={() => setConfirmar(false)}
        onConfirmar={enviar}
      >
        <p>
          Vas a enviar <strong>{filas.length}</strong> registros por un total de <strong>{total}</strong> raciones para{" "}
          <strong>{empresa.nombre}</strong>.
        </p>
        <p>Esta acción no se puede deshacer. Para cambios posteriores usa Adiciona / Reduce o Traslada.</p>
        {saltarPlazo && <p className="text-red-800">Se registrará fuera de plazo con el motivo indicado.</p>}
      </Confirmar>
    </div>
  );
}

/** Total programado por mes (lo registrado en el rango visible). */
function TotalesMes({ saldos }: { saldos: { fecha: string; cantidad: number }[] }) {
  const meses = new Map<string, number>();
  for (const s of saldos) meses.set(s.fecha.slice(0, 7), (meses.get(s.fecha.slice(0, 7)) ?? 0) + s.cantidad);
  if (!meses.size) return null;
  const nombres = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return (
    <p className="text-sm text-oliva">
      Total registrado por mes:{" "}
      {[...meses.entries()].map(([m, t], i) => (
        <span key={m}>
          {i > 0 && " · "}
          {nombres[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}: <strong>{t}</strong>
        </span>
      ))}
    </p>
  );
}
