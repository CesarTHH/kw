"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Minus, Plus, Send, Trash2 } from "lucide-react";
import {
  consultarPedidos,
  enviarRefrigerios,
  guardarBorradorRefrigerios,
  reducirRefrigerio,
  type PedidoRegistrado,
  type Resultado,
} from "@/app/(privado)/refrigerios/acciones";
import { Confirmar, ddmmaaaa, EstadoBorrador, FueraDePlazo, Mensaje, nuevoId } from "@/components/raciones/comun";
import { primeraFechaPermitida, rangoFechas, sumarDias, validarPlazo, type ConfigPlazos } from "@/lib/raciones/plazos";
import {
  composicion,
  precioUnitario,
  soles,
  TIPOS_REFRIGERIO,
  type ItemPedido,
  type PedidoBorrador,
  type Precios,
  type TipoRefrigerio,
} from "@/lib/refrigerios/tipos";

export type DatosRefrigerios = {
  empresa: { id: string; nombre: string };
  comedores: { id: string; nombre: string }[];
  turnos: { id: string; etiqueta: string }[];
  precios: Precios;
  config: ConfigPlazos;
  ahora: string;
  superadmin: boolean;
  enviar: boolean;
};

const fechaValida = (f: string) => /^\d{4}-\d{2}-\d{2}$/.test(f);

export function Refrigerios({ datos, borrador }: { datos: DatosRefrigerios; borrador: PedidoBorrador[] }) {
  const { empresa, comedores, turnos, precios, config, ahora } = datos;
  const hoy = ahora.slice(0, 10);
  const primera = primeraFechaPermitida("refrigerio", ahora, config) ?? hoy;
  const nombreComedor = useMemo(() => new Map(comedores.map((c) => [c.id, c.nombre])), [comedores]);
  const nombreTurno = useMemo(() => new Map(turnos.map((t) => [t.id, t.etiqueta])), [turnos]);
  const productos = precios.productos.filter((p) => p.precio != null);

  // Formulario
  const [desde, setDesde] = useState(primera);
  const [hasta, setHasta] = useState(primera);
  const [turno, setTurno] = useState("");
  const [tipo, setTipo] = useState<TipoRefrigerio>("estandar");
  const [encargado, setEncargado] = useState("");
  const [comedor, setComedor] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [especiales, setEspeciales] = useState<ItemPedido[]>([]);
  const [producto, setProducto] = useState("");
  const [cantProducto, setCantProducto] = useState("1");
  const [aviso, setAviso] = useState<string[]>([]);
  const [fuera, setFuera] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const saltarPlazo = datos.superadmin && fuera;

  // Borrador (se guarda solo)
  const [pedidos, setPedidosEstado] = useState<PedidoBorrador[]>(borrador);
  const [estadoBorrador, setEstadoBorrador] = useState<"guardado" | "guardando" | "error">("guardado");
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    const t = setTimeout(() => {
      guardarBorradorRefrigerios(empresa.id, pedidos)
        .then((r) => setEstadoBorrador(r.ok ? "guardado" : "error"))
        .catch(() => setEstadoBorrador("error"));
    }, 1000);
    return () => clearTimeout(t);
  }, [pedidos, empresa.id]);
  const setPedidos = useCallback((u: PedidoBorrador[] | ((p: PedidoBorrador[]) => PedidoBorrador[])) => {
    setEstadoBorrador("guardando");
    setPedidosEstado(u);
  }, []);

  // Pedidos registrados (desde hoy, 3 semanas)
  const [registrados, setRegistrados] = useState<{ clave: string; filas: PedidoRegistrado[] }>({ clave: "", filas: [] });
  const [version, setVersion] = useState(0);
  const claveRegistrados = `${empresa.id}|${version}`;
  useEffect(() => {
    let vigente = true;
    consultarPedidos(empresa.id, hoy, sumarDias(hoy, 21))
      .catch((): PedidoRegistrado[] => [])
      .then((filas) => {
        if (vigente) setRegistrados({ clave: claveRegistrados, filas });
      });
    return () => {
      vigente = false;
    };
  }, [empresa.id, hoy, claveRegistrados]);
  const cargando = registrados.clave !== claveRegistrados;

  // Envíos
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<(Resultado & { texto?: string }) | null>(null);
  const ultimo = useRef<{ contenido: string; clave: string } | null>(null);

  const problemas = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pedidos) {
      const pl = validarPlazo("refrigerio", p.fecha, ahora, config);
      if (!pl.ok && !saltarPlazo) m.set(p.id, pl.motivo);
      else if (precioUnitario(p, precios) == null) m.set(p.id, "Algún producto no tiene precio vigente");
      else if (p.tipo !== "estandar" && p.items.length === 0) m.set(p.id, "Agrega al menos un producto especial");
    }
    return m;
  }, [pedidos, ahora, config, saltarPlazo, precios]);

  function agregarEspecial() {
    const n = Number.parseInt(cantProducto, 10);
    if (!producto || !Number.isInteger(n) || n < 1 || n > 100) return;
    setEspeciales((prev) => {
      const i = prev.findIndex((x) => x.producto_id === producto);
      if (i < 0) return [...prev, { producto_id: producto, cantidad: n }];
      return prev.map((x, j) => (j === i ? { ...x, cantidad: Math.min(100, x.cantidad + n) } : x));
    });
  }

  function agregar() {
    setResultado(null);
    const cant = Number.parseInt(cantidad, 10);
    const faltan: string[] = [];
    if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde) faltan.push("las fechas");
    if (!turno) faltan.push("la hora de entrega");
    if (encargado.trim().length < 3) faltan.push("el encargado de recojo");
    if (!comedor) faltan.push("el comedor");
    if (!Number.isInteger(cant) || cant < 1 || cant > 10_000) faltan.push("la cantidad de refrigerios");
    if (tipo !== "estandar" && especiales.length === 0) faltan.push("al menos un producto especial");
    if (faltan.length) {
      setAviso([`Completa ${faltan.join(", ")}.`]);
      return;
    }
    const omitidas: string[] = [];
    const nuevos: PedidoBorrador[] = [];
    for (const fecha of rangoFechas(desde, hasta)) {
      const pl = validarPlazo("refrigerio", fecha, ahora, config);
      if (!pl.ok && !saltarPlazo) {
        omitidas.push(pl.motivo);
        continue;
      }
      nuevos.push({
        id: nuevoId(),
        fecha,
        comedor_id: comedor,
        turno_id: turno,
        tipo,
        cantidad: cant,
        encargado: encargado.trim(),
        items: tipo === "estandar" ? [] : especiales.map((x) => ({ ...x })),
      });
    }
    setPedidos((prev) => [...prev, ...nuevos].sort((a, b) => a.fecha.localeCompare(b.fecha)));
    setAviso([...new Set(omitidas)].slice(0, 5));
  }

  function enviar() {
    const m = saltarPlazo ? motivo : undefined;
    const contenido = JSON.stringify([pedidos, m ?? ""]);
    if (ultimo.current?.contenido !== contenido) ultimo.current = { contenido, clave: nuevoId() };
    const clave = ultimo.current.clave;
    setResultado(null);
    iniciar(async () => {
      const r = await enviarRefrigerios(empresa.id, pedidos, clave, m).catch(
        (): Resultado => ({ ok: false, error: "No se pudo conectar. Inténtalo de nuevo." }),
      );
      setConfirmar(false);
      setResultado({ ...r, texto: r.ok ? `Se enviaron ${pedidos.length} pedidos. Recibirás la confirmación por correo.` : undefined });
      if (r.ok) {
        ultimo.current = null;
        setPedidos([]);
        setMotivo("");
        setFuera(false);
        setVersion((v) => v + 1);
      }
    });
  }

  const totalRefrigerios = pedidos.reduce((s, p) => s + p.cantidad, 0);
  const totalSoles = pedidos.reduce((s, p) => s + (precioUnitario(p, precios) ?? 0) * p.cantidad, 0);
  const puedeEnviar = pedidos.length > 0 && problemas.size === 0 && (!saltarPlazo || motivo.trim().length >= 5);
  const precioPreview = precioUnitario({ tipo, items: tipo === "estandar" ? [] : especiales }, precios);

  return (
    <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
      {/* Formulario */}
      <section className="panel h-fit space-y-3">
        <h2 className="font-semibold text-oliva">Solicitud de refrigerios · {empresa.nombre}</h2>
        {!datos.enviar ? (
          <p className="text-sm">Solo puedes consultar los refrigerios registrados.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="etiqueta">Desde *</span>
                <input type="date" value={desde} min={saltarPlazo ? undefined : primera} onChange={(e) => setDesde(e.target.value)} className="campo" />
              </label>
              <label className="block">
                <span className="etiqueta">Hasta *</span>
                <input type="date" value={hasta} min={desde || primera} onChange={(e) => setHasta(e.target.value)} className="campo" />
              </label>
            </div>
            <label className="block">
              <span className="etiqueta">Hora de entrega *</span>
              <select value={turno} onChange={(e) => setTurno(e.target.value)} className="campo">
                <option value="">Elige…</option>
                {turnos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="etiqueta">Refrigerio *</legend>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(TIPOS_REFRIGERIO) as TipoRefrigerio[]).map((t) => (
                  <label key={t} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${tipo === t ? "border-oliva bg-oliva text-white" : "border-gris-medio bg-white"}`}>
                    <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} className="sr-only" />
                    {TIPOS_REFRIGERIO[t]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="etiqueta">Encargado de recojo *</span>
              <input value={encargado} onChange={(e) => setEncargado(e.target.value)} maxLength={150} placeholder="Nombres y apellidos" className="campo" />
            </label>
            <label className="block">
              <span className="etiqueta">Comedor *</span>
              <select value={comedor} onChange={(e) => setComedor(e.target.value)} className="campo">
                <option value="">Elige…</option>
                {comedores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="etiqueta">Cantidad de refrigerios por día *</span>
              <input type="number" min={1} max={10000} value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="campo" />
            </label>

            {tipo !== "estandar" && (
              <div className="space-y-2 border-t border-gris-medio/40 pt-3">
                <p className="text-xs text-gris-medio">Los productos especiales se suman a <strong>cada</strong> refrigerio.</p>
                <div className="grid grid-cols-[1fr_5rem_auto] items-end gap-2">
                  <label className="block">
                    <span className="etiqueta">Producto *</span>
                    <select value={producto} onChange={(e) => setProducto(e.target.value)} className="campo">
                      <option value="">Elige…</option>
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="etiqueta">Cant.</span>
                    <input type="number" min={1} max={100} value={cantProducto} onChange={(e) => setCantProducto(e.target.value)} className="campo" />
                  </label>
                  <button type="button" onClick={agregarEspecial} className="btn-secundario px-3!" aria-label="Agregar producto">
                    <Plus className="size-4" />
                  </button>
                </div>
                <TablaProductos items={especiales} precios={precios} onChange={setEspeciales} />
              </div>
            )}

            {precioPreview != null && (
              <p className="text-sm">
                Precio por refrigerio: <strong>{soles(precioPreview)}</strong> <span className="text-xs text-gris-medio">(sin IGV)</span>
              </p>
            )}
            {datos.superadmin && <FueraDePlazo activo={fuera} setActivo={setFuera} motivo={motivo} setMotivo={setMotivo} />}
            <div className="flex gap-2">
              <button type="button" className="btn-oliva" onClick={agregar}>
                <Plus className="size-4" aria-hidden /> Agregar
              </button>
            </div>
            <p className="text-xs text-gris-medio">
              Para el día D se registra hasta las {config.horaLimiteRefrigerio} del día anterior.
            </p>
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
          </>
        )}
      </section>

      <div className="min-w-0 space-y-6">
        {resultado?.ok && <Mensaje tipo="ok">{resultado.texto}</Mensaje>}
        {resultado && !resultado.ok && <Mensaje tipo="error">{resultado.error}</Mensaje>}

        {datos.enviar && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-oliva">Previsualización</h2>
              <EstadoBorrador estado={estadoBorrador} />
            </div>
            <div className="max-h-[30rem] overflow-auto rounded-xl shadow">
              <table className="tabla">
                <thead className="sticky top-0">
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Comedor</th>
                    <th scope="col">Turno</th>
                    <th scope="col">Composición</th>
                    <th scope="col">Cant.</th>
                    <th scope="col" className="text-right!">
                      Precio sin IGV
                    </th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Encargado</th>
                    <th scope="col">
                      <span className="sr-only">Quitar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map((p) => (
                    <FilaPedido
                      key={p.id}
                      pedido={p}
                      precios={precios}
                      comedor={nombreComedor.get(p.comedor_id) ?? "—"}
                      turno={nombreTurno.get(p.turno_id) ?? "—"}
                      problema={problemas.get(p.id)}
                      onChange={(nuevo) => setPedidos((prev) => prev.map((x) => (x.id === p.id ? nuevo : x)))}
                      onQuitar={() => setPedidos((prev) => prev.filter((x) => x.id !== p.id))}
                    />
                  ))}
                  {!pedidos.length && (
                    <tr>
                      <td colSpan={9} className="py-4 text-center text-gris-medio">
                        Agrega pedidos con el formulario.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {pedidos.length > 0 && (
                <>
                  <span className="text-sm">
                    {totalRefrigerios} refrigerios · <strong>{soles(totalSoles)}</strong> sin IGV
                  </span>
                  <button type="button" className="btn-secundario" onClick={() => setPedidos([])}>
                    Vaciar
                  </button>
                </>
              )}
              <button type="button" className="btn-marca" disabled={!puedeEnviar || pendiente} onClick={() => setConfirmar(true)}>
                <Send className="size-4" aria-hidden /> Enviar
              </button>
            </div>
          </section>
        )}

        <Registrados
          filas={registrados.filas}
          cargando={cargando}
          nombreComedor={nombreComedor}
          nombreTurno={nombreTurno}
          datos={datos}
          saltarPlazo={saltarPlazo}
          motivo={motivo}
          onReducido={() => setVersion((v) => v + 1)}
        />
      </div>

      <Confirmar abierto={confirmar} titulo="Confirmar envío" pendiente={pendiente} onCancelar={() => setConfirmar(false)} onConfirmar={enviar}>
        <p>
          Vas a enviar <strong>{pedidos.length}</strong> pedidos por un total de <strong>{totalRefrigerios}</strong> refrigerios (
          {soles(totalSoles)} sin IGV) para <strong>{empresa.nombre}</strong>.
        </p>
        <p>El precio queda fijado al enviar. Esta acción no se puede deshacer; después solo se puede reducir con 48 horas de anticipación.</p>
        {saltarPlazo && <p className="text-red-800">Se registrará fuera de plazo con el motivo indicado.</p>}
      </Confirmar>
    </div>
  );
}

/** Lista editable de productos (cantidad por refrigerio). */
function TablaProductos({ items, precios, onChange }: { items: ItemPedido[]; precios: Precios; onChange: (i: ItemPedido[]) => void }) {
  if (!items.length) return <p className="text-xs text-gris-medio">Aún no agregas productos especiales.</p>;
  return (
    <table className="tabla text-xs">
      <thead>
        <tr>
          <th scope="col">Producto</th>
          <th scope="col">Precio sin IGV</th>
          <th scope="col">Cant.</th>
          <th scope="col">
            <span className="sr-only">Quitar</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const p = precios.productos.find((x) => x.id === it.producto_id);
          return (
            <tr key={it.producto_id}>
              <td>{p?.nombre ?? "—"}</td>
              <td>{p?.precio != null ? soles(Number(p.precio)) : "Sin precio"}</td>
              <td>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={it.cantidad}
                  aria-label={`Cantidad de ${p?.nombre ?? "producto"}`}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(100, Number.parseInt(e.target.value, 10) || 1));
                    onChange(items.map((x) => (x.producto_id === it.producto_id ? { ...x, cantidad: n } : x)));
                  }}
                  className="campo w-16 py-0.5!"
                />
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => onChange(items.filter((x) => x.producto_id !== it.producto_id))}
                  className="rounded p-1 text-red-700 hover:bg-red-50"
                  aria-label={`Quitar ${p?.nombre ?? "producto"}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FilaPedido({
  pedido: p,
  precios,
  comedor,
  turno,
  problema,
  onChange,
  onQuitar,
}: {
  pedido: PedidoBorrador;
  precios: Precios;
  comedor: string;
  turno: string;
  problema?: string;
  onChange: (p: PedidoBorrador) => void;
  onQuitar: () => void;
}) {
  const [editar, setEditar] = useState(false);
  const [producto, setProducto] = useState("");
  const unit = precioUnitario(p, precios);
  return (
    <>
      <tr>
        <td className="whitespace-nowrap">
          {ddmmaaaa(p.fecha)}
          {problema && <span className="block max-w-48 text-xs text-red-800">{problema}</span>}
        </td>
        <td>{comedor}</td>
        <td className="whitespace-nowrap">{turno}</td>
        <td className="min-w-48 whitespace-pre-line text-xs">
          {composicion(p, precios)}
          {p.tipo !== "estandar" && (
            <button type="button" className="mt-1 block text-oliva underline" onClick={() => setEditar((v) => !v)}>
              {editar ? "Listo" : "Editar productos"}
            </button>
          )}
        </td>
        <td>
          <input
            type="number"
            min={1}
            max={10000}
            value={p.cantidad}
            aria-label={`Cantidad del ${ddmmaaaa(p.fecha)}`}
            onChange={(e) => onChange({ ...p, cantidad: Math.max(1, Math.min(10_000, Number.parseInt(e.target.value, 10) || 1)) })}
            className="campo w-20 py-1!"
          />
        </td>
        <td className="text-right tabular-nums">{unit != null ? soles(unit * p.cantidad) : "—"}</td>
        <td>{TIPOS_REFRIGERIO[p.tipo]}</td>
        <td className="uppercase">{p.encargado}</td>
        <td>
          <button type="button" onClick={onQuitar} className="rounded p-1 text-red-700 hover:bg-red-50" aria-label={`Quitar el pedido del ${ddmmaaaa(p.fecha)}`}>
            <Trash2 className="size-4" />
          </button>
        </td>
      </tr>
      {editar && (
        <tr>
          <td colSpan={9} className="bg-gris-claro">
            <div className="flex flex-wrap items-start gap-3">
              <TablaProductos items={p.items} precios={precios} onChange={(items) => onChange({ ...p, items })} />
              <div className="flex items-end gap-2">
                <select value={producto} onChange={(e) => setProducto(e.target.value)} className="campo w-56" aria-label="Producto a agregar">
                  <option value="">Agregar producto…</option>
                  {precios.productos
                    .filter((x) => x.precio != null && !p.items.some((i) => i.producto_id === x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="btn-secundario px-3!"
                  disabled={!producto}
                  onClick={() => {
                    onChange({ ...p, items: [...p.items, { producto_id: producto, cantidad: 1 }] });
                    setProducto("");
                  }}
                  aria-label="Agregar producto al pedido"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Registrados({
  filas,
  cargando,
  nombreComedor,
  nombreTurno,
  datos,
  saltarPlazo,
  motivo,
  onReducido,
}: {
  filas: PedidoRegistrado[];
  cargando: boolean;
  nombreComedor: Map<string, string>;
  nombreTurno: Map<string, string>;
  datos: DatosRefrigerios;
  saltarPlazo: boolean;
  motivo: string;
  onReducido: () => void;
}) {
  const [reduciendo, setReduciendo] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const claves = useRef(new Map<string, string>());

  function reducir(p: PedidoRegistrado) {
    const n = Number.parseInt(cantidad, 10);
    if (!Number.isInteger(n) || n < 1 || n > p.cantidad_vigente) {
      setResultado({ ok: false, error: `Indica una cantidad entre 1 y ${p.cantidad_vigente}.` });
      return;
    }
    const contenido = `${p.id}|${n}|${saltarPlazo ? motivo : ""}`;
    if (!claves.current.has(contenido)) claves.current.set(contenido, nuevoId());
    const clave = claves.current.get(contenido)!;
    iniciar(async () => {
      const r = await reducirRefrigerio(p.id, n, clave, saltarPlazo ? motivo : undefined).catch(
        (): Resultado => ({ ok: false, error: "No se pudo conectar. Inténtalo de nuevo." }),
      );
      setResultado(r);
      if (r.ok) {
        claves.current.delete(contenido);
        setReduciendo(null);
        setCantidad("");
        onReducido();
      }
    });
  }

  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-oliva">
        Refrigerios registrados (próximas 3 semanas) {cargando && <span className="text-xs font-normal text-gris-medio">(cargando…)</span>}
      </h2>
      {resultado?.ok && <Mensaje tipo="ok">Reducción registrada. Recibirás la confirmación por correo.</Mensaje>}
      {resultado && !resultado.ok && <Mensaje tipo="error">{resultado.error}</Mensaje>}
      <div className="max-h-[30rem] overflow-auto rounded-xl shadow">
        <table className="tabla">
          <thead className="sticky top-0">
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Comedor</th>
              <th scope="col">Turno</th>
              <th scope="col">Composición</th>
              <th scope="col">Cant.</th>
              <th scope="col" className="text-right!">
                Precio sin IGV
              </th>
              <th scope="col">Tipo</th>
              <th scope="col">Encargado</th>
              {datos.enviar && (
                <th scope="col">
                  <span className="sr-only">Reducir</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => {
              const plazo = validarPlazo("refrigerio_reduccion", p.fecha, datos.ahora, datos.config);
              const puedeReducir = datos.enviar && p.cantidad_vigente > 0 && (plazo.ok || saltarPlazo);
              return (
                <tr key={p.id} className={p.cantidad_vigente === 0 ? "opacity-60" : undefined}>
                  <td className="whitespace-nowrap">{ddmmaaaa(p.fecha)}</td>
                  <td>{nombreComedor.get(p.comedor_id) ?? "—"}</td>
                  <td className="whitespace-nowrap">{nombreTurno.get(p.turno_id) ?? "—"}</td>
                  <td className="min-w-48 whitespace-pre-line text-xs">{p.composicion}</td>
                  <td className="tabular-nums">
                    {p.cantidad_vigente}
                    {p.cantidad_vigente !== p.cantidad && <span className="block text-xs text-gris-medio">de {p.cantidad}</span>}
                  </td>
                  <td className="text-right tabular-nums">{soles(p.precio_unitario * p.cantidad_vigente)}</td>
                  <td>{TIPOS_REFRIGERIO[p.tipo]}</td>
                  <td className="uppercase">{p.encargado}</td>
                  {datos.enviar && (
                    <td>
                      {reduciendo === p.id ? (
                        <span className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={p.cantidad_vigente}
                            value={cantidad}
                            onChange={(e) => setCantidad(e.target.value)}
                            aria-label="Cantidad a reducir"
                            className="campo w-16 py-1!"
                          />
                          <button type="button" className="btn-marca px-2! py-1! text-xs" disabled={pendiente} onClick={() => reducir(p)}>
                            {pendiente ? "…" : "Reducir"}
                          </button>
                          <button type="button" className="text-xs underline" onClick={() => setReduciendo(null)}>
                            Cancelar
                          </button>
                        </span>
                      ) : puedeReducir ? (
                        <button
                          type="button"
                          className="btn-secundario px-2! py-1! text-xs"
                          onClick={() => {
                            setResultado(null);
                            setReduciendo(p.id);
                            setCantidad(String(p.cantidad_vigente));
                          }}
                        >
                          <Minus className="size-3.5" aria-hidden /> Reducir
                        </button>
                      ) : null}
                    </td>
                  )}
                </tr>
              );
            })}
            {!filas.length && (
              <tr>
                <td colSpan={9} className="py-4 text-center text-gris-medio">
                  {cargando ? "Cargando…" : "No hay refrigerios registrados en las próximas semanas."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
