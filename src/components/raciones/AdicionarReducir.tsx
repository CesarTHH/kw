"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, Send, Trash2 } from "lucide-react";
import type { ModuloBorrador } from "@/lib/raciones/servidor";
import { primeraFechaPermitida, rangoFechas, sumarDias, validarPlazo } from "@/lib/raciones/plazos";
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

const MODULO: ModuloBorrador = "adicionar_reducir";

export function AdicionarReducir({ ctx, borrador }: { ctx: ContextoRaciones; borrador: FilaBorrador[] }) {
  const { catalogo, config, ahora, empresa } = ctx;
  const n = useNombres(catalogo);
  const hoy = ahora.slice(0, 10);
  const primeraAdicion = primeraFechaPermitida("adicion", ahora, config) ?? hoy;
  const primeraReduccion = primeraFechaPermitida("reduccion", ahora, config) ?? hoy;

  const [modo, setModo] = useState<"adicion" | "reduccion">("adicion");
  const [sel, setSel] = useState({ proyecto: "", area: "", frente: "" });
  const [cs, setCs] = useState({ comedor: "", servicio: "" });
  const [cantidad, setCantidad] = useState("");
  const primera = modo === "adicion" ? primeraAdicion : primeraReduccion;
  const [desde, setDesde] = useState(primeraAdicion);
  const [hasta, setHasta] = useState(primeraAdicion);
  const [aviso, setAviso] = useState<string[]>([]);
  const [fuera, setFuera] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState(false);

  const { filas, setFilas, estado } = useBorrador(MODULO, empresa.id, borrador);
  // Raciones registradas: desde hoy hasta 8 semanas (lo que se puede modificar).
  const registradas = useSaldos(empresa.id, hoy, sumarDias(hoy, 56));
  const envio = useEnvio(MODULO, empresa.id);
  const saltarPlazo = ctx.superadmin && fuera;

  /** Reducciones ya en la grilla por combinación (para no pasar lo disponible). */
  const reservado = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of filas) m.set(claveDe(f), (m.get(claveDe(f)) ?? 0) + f.cantidad);
    return m;
  }, [filas]);

  const problemas = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of filas) {
      const tipo = f.cantidad > 0 ? "adicion" : "reduccion";
      const p = validarPlazo(tipo, f.fecha, ahora, config);
      if (!p.ok && !saltarPlazo) m.set(f.id, p.motivo);
      else if (f.cantidad < 0 && (registradas.mapa.get(claveDe(f)) ?? 0) + (reservado.get(claveDe(f)) ?? 0) < 0)
        m.set(f.id, `Solo hay ${registradas.mapa.get(claveDe(f)) ?? 0} registradas`);
      else if (f.cantidad > 0 && !frenteVigente(catalogo, f.frente_id, f.fecha)) m.set(f.id, "El contrato del frente no cubre esta fecha");
      else if (f.cantidad > 0 && !ofreceServicio(catalogo, f.comedor_id, f.servicio_id)) m.set(f.id, "El comedor no ofrece este servicio");
    }
    return m;
  }, [filas, ahora, config, saltarPlazo, registradas.mapa, reservado, catalogo]);

  const filtradas = useMemo(
    () =>
      registradas.saldos.filter(
        (s) =>
          (!sel.frente || s.frente_id === sel.frente) &&
          (!cs.comedor || s.comedor_id === cs.comedor) &&
          (!cs.servicio || s.servicio_id === cs.servicio) &&
          s.fecha >= desde &&
          s.fecha <= (hasta || desde),
      ),
    [registradas.saldos, sel.frente, cs.comedor, cs.servicio, desde, hasta],
  );

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
      const p = validarPlazo(modo, fecha, ahora, config);
      if (!p.ok && !saltarPlazo) {
        omitidas.push(p.motivo);
        continue;
      }
      const base = { fecha, frente_id: sel.frente, comedor_id: cs.comedor, servicio_id: cs.servicio };
      if (modo === "reduccion") {
        const disponible = (registradas.mapa.get(claveDe(base)) ?? 0) + (reservado.get(claveDe(base)) ?? 0);
        if (disponible < cant) {
          omitidas.push(`${ddmmaaaa(fecha)}: solo hay ${Math.max(0, disponible)} raciones para reducir`);
          continue;
        }
      } else if (!frenteVigente(catalogo, sel.frente, fecha)) {
        omitidas.push(`${ddmmaaaa(fecha)}: el contrato del frente no cubre esta fecha`);
        continue;
      }
      nuevas.push({ id: nuevoId(), ...base, cantidad: modo === "adicion" ? cant : -cant });
    }
    setFilas((prev) => [...prev, ...nuevas].sort((a, b) => a.fecha.localeCompare(b.fecha)));
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

  const adiciones = filas.filter((f) => f.cantidad > 0).reduce((s, f) => s + f.cantidad, 0);
  const reducciones = filas.filter((f) => f.cantidad < 0).reduce((s, f) => s - f.cantidad, 0);
  const puedeEnviar = filas.length > 0 && problemas.size === 0 && (!saltarPlazo || motivo.trim().length >= 5);

  return (
    <div className="space-y-6">
      <section className="panel space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-oliva">Adición / reducción de raciones · {empresa.nombre}</h2>
          <div role="radiogroup" aria-label="Tipo" className="flex overflow-hidden rounded-full border border-oliva">
            {(["adicion", "reduccion"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={modo === m}
                onClick={() => {
                  setModo(m);
                  const p = m === "adicion" ? primeraAdicion : primeraReduccion;
                  if (desde < p) setDesde(p);
                  if (hasta < p) setHasta(p);
                }}
                className={`flex items-center gap-1 px-4 py-1.5 text-sm font-semibold ${modo === m ? "bg-oliva text-white" : "bg-white text-oliva"}`}
              >
                {m === "adicion" ? <Plus className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
                {m === "adicion" ? "Adiciones" : "Reducciones"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gris-medio">
          {modo === "adicion"
            ? `Las adiciones para un día se aceptan hasta las ${config.horaLimiteAdicion} del día anterior.`
            : `Las reducciones se aceptan hasta ${config.horasReduccion} horas antes del inicio del día, y nunca por más de lo registrado.`}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectFrente catalogo={catalogo} {...sel} onChange={setSel} />
          <label className="block">
            <span className="etiqueta">Cantidad por día *</span>
            <input type="number" min={1} max={10000} value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="campo" />
          </label>
          <label className="block">
            <span className="etiqueta">Fecha desde *</span>
            <input type="date" value={desde} min={saltarPlazo ? undefined : primera} onChange={(e) => setDesde(e.target.value)} className="campo" />
          </label>
          <label className="block">
            <span className="etiqueta">Fecha hasta *</span>
            <input type="date" value={hasta} min={desde || primera} onChange={(e) => setHasta(e.target.value)} className="campo" />
          </label>
          <SelectComedorServicio catalogo={catalogo} comedor={cs.comedor} servicio={cs.servicio} onChange={setCs} />
        </div>
        {ctx.superadmin && <FueraDePlazo activo={fuera} setActivo={setFuera} motivo={motivo} setMotivo={setMotivo} />}
        <button type="button" className="btn-oliva" onClick={agregar}>
          {modo === "adicion" ? <Plus className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
          Agregar {modo === "adicion" ? "adición" : "reducción"}
        </button>
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

      <TablaRegistradas
        saldos={filtradas}
        catalogo={catalogo}
        cargando={registradas.cargando}
        titulo="Raciones registradas para lo elegido"
      />

      {envio.resultado?.ok && <Mensaje tipo="ok">Se enviaron {envio.resultado.filas} registros. Recibirás la confirmación por correo.</Mensaje>}
      {envio.resultado && !envio.resultado.ok && <Mensaje tipo="error">{envio.resultado.error}</Mensaje>}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-oliva">Previsualización</h2>
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
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className="whitespace-nowrap">
                    {ddmmaaaa(f.fecha)}
                    {problemas.get(f.id) && <span className="block max-w-56 text-xs text-red-800">{problemas.get(f.id)}</span>}
                  </td>
                  <td>{n.proyecto(f.frente_id)}</td>
                  <td>{n.area(f.frente_id)}</td>
                  <td>{n.frente(f.frente_id)}</td>
                  <td>{n.comedor(f.comedor_id)}</td>
                  <td>{n.servicio(f.servicio_id)}</td>
                  <td>
                    <span className={`mr-1 font-semibold ${f.cantidad < 0 ? "text-red-800" : "text-green-800"}`}>{f.cantidad < 0 ? "−" : "+"}</span>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={Math.abs(f.cantidad)}
                      aria-label={`Cantidad del ${ddmmaaaa(f.fecha)}`}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(10_000, Number.parseInt(e.target.value, 10) || 1));
                        setFilas((prev) => prev.map((x) => (x.id === f.id ? { ...x, cantidad: x.cantidad < 0 ? -v : v } : x)));
                      }}
                      className="campo inline-block w-24 py-1!"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setFilas((prev) => prev.filter((x) => x.id !== f.id))}
                      className="btn-icono text-red-700 hover:bg-red-50"
                      aria-label={`Quitar la fila del ${ddmmaaaa(f.fecha)}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {!filas.length && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-gris-medio">
                    Agrega adiciones o reducciones con el formulario de arriba.
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
                <span className="text-green-800">+{adiciones}</span> / <span className="text-red-800">−{reducciones}</span> raciones
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

      <Confirmar abierto={confirmar} titulo="Confirmar envío" pendiente={envio.pendiente} onCancelar={() => setConfirmar(false)} onConfirmar={enviar}>
        <p>
          Vas a enviar <strong>{filas.length}</strong> registros: <strong>+{adiciones}</strong> raciones adicionales y{" "}
          <strong>−{reducciones}</strong> reducidas, para <strong>{empresa.nombre}</strong>.
        </p>
        <p>Esta acción no se puede deshacer.</p>
        {saltarPlazo && <p className="text-red-800">Se registrará fuera de plazo con el motivo indicado.</p>}
      </Confirmar>
    </div>
  );
}
