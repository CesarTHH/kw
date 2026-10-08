/**
 * Simulación del importador: lee los archivos (CSV maestros y Excel del historial),
 * limpia y valida cada fila contra los catálogos actuales y arma lo que se va a
 * importar, sin escribir nada. Reglas: docs/MAPEO_MIGRACION.md.
 *
 * Todo se referencia por claves naturales (RUC, nombres): la base de datos resuelve
 * los ids al importar. Cada fila lleva un origen_id estable para que reimportar el
 * mismo archivo no duplique nada.
 */
import { createHash } from "node:crypto";
import { tipoArchivo } from "./archivos";
import { abrirExcel, type Celda } from "./xlsx";
import {
  booleano,
  clave,
  correoValido,
  csvComoObjetos,
  entero,
  fechaDmy,
  fechaSerie,
  instanteSerie,
  limpiar,
  monto,
  ruc as leerRuc,
} from "./texto";

export type Archivo = { nombre: string; bytes: Buffer };

export type Actual = {
  proyectos: { nombre: string; activo: boolean }[];
  areas: { nombre: string; activo: boolean }[];
  frentes: { proyecto: string; area: string; nombre: string }[];
  empresas: { ruc: string; nombre_corto: string }[];
  contactos: string[];
  comedores: { nombre: string }[];
  servicios: { nombre: string }[];
  tarifas: { servicio: string; desde: string; hasta: string }[];
};

export type Problema = { nivel: "error" | "advertencia"; archivo: string; fila: number | null; columna: string | null; motivo: string };

export type Conteo = { nuevos: number; existentes: number };

/** Lo que crea o actualiza el lote de catálogos (todo por nombre o RUC). */
export type Catalogos = {
  proyectos: { nombre: string; activo: boolean | null }[];
  areas: { nombre: string; activo: boolean | null }[];
  empresas: { ruc: string; razon_social: string; nombre_corto: string; direccion: string | null; tipo: string; telefonos: string | null; origen_id: string }[];
  contactos: { ruc: string; tipo: string; nombre: string; telefono: string | null; correo: string; recibe: boolean; origen_id: string }[];
  frentes: { proyecto: string; area: string; nombre: string; sponsor: string | null; desde: string | null; hasta: string | null; migracion: boolean; origen_id: string }[];
  comedores: {
    nombre: string;
    sector: string | null;
    raciones: boolean;
    refrigerios: boolean;
    puntos_k: boolean;
    kitchenette: boolean;
    activo: boolean;
    origen_id: string;
  }[];
  servicios: { nombre: string; tipo: string; a_campo: boolean }[];
  tarifas: { servicio: string; precio: number; desde: string; hasta: string }[];
  comedor_servicios: { comedor: string; servicio: string }[];
  empresa_frentes: { ruc: string; proyecto: string; area: string; frente: string }[];
};

/**
 * Movimiento compacto (arreglo para que los lotes pesen menos):
 * [origen_id, envio, ruc, fecha, proyecto, area, frente, comedor, servicio, tipo, cantidad, par]
 */
export type Movimiento = [string, string, string, string, string, string, string, string, string, string, number, string | null];
export type Envio = { origen_id: string; ruc: string; usuario: string; enviado_en: string; filas: number; total: number };
export type Lote = { envios: Envio[]; movimientos: Movimiento[] };

export type Analisis = {
  resumen: Record<string, Conteo | number>;
  problemas: Problema[];
  errores: number;
  advertencias: number;
  catalogos: Catalogos;
  lotes: Lote[];
  meses: string[];
};

const MAX_PROBLEMAS = 5000;
const TAMANO_LOTE = 5000;
const md5 = (t: string) => createHash("md5").update(t).digest("hex");

const COLUMNAS: Record<string, string[]> = {
  proyectos: ["NOMBRE PROYECTO", "ESTADO"],
  areas: ["NOMBRE AREA", "ESTADO"],
  frentes: ["PROYECTO", "ÁREA", "PROYECTO MENOR", "SPONSOR", "CONTRATO DESDE", "CONTRATO HASTA"],
  empresas: ["RUC.", "Razón social", "NOMBRE PERSONNEL", "Dirección", "Tipo Registro", "TelefonoValo"],
  contactos: ["Title", "PERSONA DE CONTACTO", "TELÉFONO", "CORREO", "AREA DE CONTACTO"],
  comedores: ["NOMBRE COMEDOR", "HABILITADO_RACIONES", "ESTADO", "HABILITADO_REFRIGERIOS", "ESTADO_REFRIGERIOS", "TIPO_COMEDOR"],
  servicios: ["NOMBRE SERVICIO", "COSTO SERVICIO", "TIPO SERVICIO", "DESDE", "HASTA"],
};
const COLUMNAS_HISTORIAL = ["FECHA", "EMPRESA", "COMEDOR", "SERVICIO", "AREA", "PY VALORIZACION", "PROYECTO", "CANTIDAD", "TIPO REGISTRO", "Usuario", "Creado"];

/** Catálogo por nombre normalizado: la primera forma vista es la que se guarda. */
class Nombres {
  private mapa = new Map<string, string>();
  constructor(existentes: string[] = []) {
    for (const n of existentes) this.mapa.set(clave(n), n);
  }
  readonly existentes = new Set<string>();
  marcarExistentes() {
    for (const k of this.mapa.keys()) this.existentes.add(k);
    return this;
  }
  canonico(n: string): string {
    const k = clave(n);
    const ya = this.mapa.get(k);
    if (ya) return ya;
    const limpio = limpiar(n);
    this.mapa.set(k, limpio);
    return limpio;
  }
  tiene(n: string) {
    return this.mapa.has(clave(n));
  }
  existe(n: string) {
    return this.existentes.has(clave(n));
  }
}

export async function analizar(
  archivos: Archivo[],
  actual: Actual,
  contarExistentes: (origenes: string[]) => Promise<number>,
): Promise<Analisis> {
  const problemas: Problema[] = [];
  let errores = 0;
  let advertencias = 0;
  const problema = (p: Problema) => {
    if (p.nivel === "error") errores++;
    else advertencias++;
    if (problemas.length < MAX_PROBLEMAS) problemas.push(p);
  };

  const proyectos = new Nombres(actual.proyectos.map((x) => x.nombre)).marcarExistentes();
  const areas = new Nombres(actual.areas.map((x) => x.nombre)).marcarExistentes();
  const comedores = new Nombres(actual.comedores.map((x) => x.nombre)).marcarExistentes();
  const servicios = new Nombres(actual.servicios.map((x) => x.nombre)).marcarExistentes();
  const claveFrente = (p: string, a: string, f: string) => `${clave(p)}|${clave(a)}|${clave(f)}`;
  const frentesActuales = new Map(actual.frentes.map((f) => [claveFrente(f.proyecto, f.area, f.nombre), f]));
  const rucsActuales = new Set(actual.empresas.map((e) => e.ruc));
  const nombreEmpresa = new Map(actual.empresas.map((e) => [e.ruc, e.nombre_corto]));

  const cat: Catalogos = {
    proyectos: [],
    areas: [],
    empresas: [],
    contactos: [],
    frentes: [],
    comedores: [],
    servicios: [],
    tarifas: [],
    comedor_servicios: [],
    empresa_frentes: [],
  };
  const frentesArchivo = new Map<string, Catalogos["frentes"][number]>();

  const porTipo = new Map<string, Archivo>();
  for (const a of archivos) {
    const t = tipoArchivo(a.nombre);
    if (!t) {
      problema({ nivel: "error", archivo: a.nombre, fila: null, columna: null, motivo: "Archivo no reconocido: se ignora" });
      continue;
    }
    if (porTipo.has(t)) problema({ nivel: "advertencia", archivo: a.nombre, fila: null, columna: null, motivo: "Hay otro archivo del mismo tipo: se usa el último" });
    porTipo.set(t, a);
  }

  const leerCsv = (t: string) => {
    const a = porTipo.get(t);
    if (!a) return null;
    const { cabecera, filas } = csvComoObjetos(a.bytes.toString("utf8"));
    const faltan = COLUMNAS[t]!.filter((c) => !cabecera.includes(c));
    if (faltan.length) {
      problema({ nivel: "error", archivo: a.nombre, fila: null, columna: faltan.join(", "), motivo: "Faltan columnas: el archivo no se importa" });
      return null;
    }
    return { archivo: a.nombre, filas };
  };

  // --- Proyectos y áreas -------------------------------------------------------
  for (const [t, col, nombres, destino] of [
    ["proyectos", "NOMBRE PROYECTO", proyectos, cat.proyectos],
    ["areas", "NOMBRE AREA", areas, cat.areas],
  ] as const) {
    const csv = leerCsv(t);
    if (!csv) continue;
    const vistos = new Set<string>();
    csv.filas.forEach((f, i) => {
      const nombre = limpiar(f[col]);
      if (!nombre) return problema({ nivel: "error", archivo: csv.archivo, fila: i + 2, columna: col, motivo: "Nombre vacío" });
      if (vistos.has(clave(nombre))) return;
      vistos.add(clave(nombre));
      destino.push({ nombre: nombres.canonico(nombre), activo: booleano(f["ESTADO"]) });
    });
  }

  // --- Frentes de trabajo (proyecto + área + proyecto menor) -------------------
  const asegurar = (nombres: Nombres, destino: { nombre: string; activo: boolean | null }[], nombre: string, archivo: string, fila: number | null, que: string) => {
    if (nombres.tiene(nombre)) return nombres.canonico(nombre);
    const n = nombres.canonico(nombre);
    destino.push({ nombre: n, activo: true });
    problema({ nivel: "advertencia", archivo, fila, columna: que, motivo: `"${n}" no está en el maestro: se crea` });
    return n;
  };
  {
    const csv = leerCsv("frentes");
    if (csv) {
      csv.filas.forEach((f, i) => {
        const fila = i + 2;
        const p = limpiar(f["PROYECTO"]);
        const a = limpiar(f["ÁREA"]);
        const n = limpiar(f["PROYECTO MENOR"]);
        if (!p || !a || !n) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: null, motivo: "Falta proyecto, área o proyecto menor" });
        const desde = limpiar(f["CONTRATO DESDE"]) ? fechaDmy(f["CONTRATO DESDE"]) : null;
        const hasta = limpiar(f["CONTRATO HASTA"]) ? fechaDmy(f["CONTRATO HASTA"]) : null;
        if ((limpiar(f["CONTRATO DESDE"]) && !desde) || (limpiar(f["CONTRATO HASTA"]) && !hasta)) {
          problema({ nivel: "advertencia", archivo: csv.archivo, fila, columna: "CONTRATO", motivo: "Fecha de contrato no válida: se deja vacía" });
        }
        const proyecto = asegurar(proyectos, cat.proyectos, p, csv.archivo, fila, "PROYECTO");
        const area = asegurar(areas, cat.areas, a, csv.archivo, fila, "ÁREA");
        const k = claveFrente(proyecto, area, n);
        const previo = frentesArchivo.get(k);
        if (previo) {
          // Filas repetidas: se conserva el contrato más amplio.
          if (desde && (!previo.desde || desde < previo.desde)) previo.desde = desde;
          if (hasta && (!previo.hasta || hasta > previo.hasta)) previo.hasta = hasta;
          return;
        }
        const nombre = frentesActuales.get(k)?.nombre ?? n;
        const x = { proyecto, area, nombre, sponsor: limpiar(f["SPONSOR"]) || null, desde, hasta, migracion: false, origen_id: `frentes:${k}` };
        frentesArchivo.set(k, x);
        cat.frentes.push(x);
      });
      for (const x of cat.frentes) {
        if (x.desde && x.hasta && x.hasta < x.desde) {
          problema({ nivel: "advertencia", archivo: csv.archivo, fila: null, columna: "CONTRATO", motivo: `${x.nombre}: el contrato termina antes de empezar, se deja sin fechas` });
          x.desde = null;
          x.hasta = null;
        }
      }
    }
  }

  // --- Empresas y contactos ----------------------------------------------------
  {
    const csv = leerCsv("empresas");
    if (csv) {
      const vistos = new Set<string>();
      csv.filas.forEach((f, i) => {
        const fila = i + 2;
        const r = leerRuc(f["RUC."]);
        if (!r) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "RUC.", motivo: "RUC no válido (deben ser 11 dígitos)" });
        if (vistos.has(r)) return problema({ nivel: "advertencia", archivo: csv.archivo, fila, columna: "RUC.", motivo: "RUC repetido: se usa la primera fila" });
        vistos.add(r);
        const razon = limpiar(f["Razón social"]);
        const corto = limpiar(f["NOMBRE PERSONNEL"]) || razon;
        if (razon.length < 2) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "Razón social", motivo: "Razón social vacía" });
        cat.empresas.push({
          ruc: r,
          razon_social: razon.slice(0, 200),
          nombre_corto: corto.slice(0, 120),
          direccion: limpiar(f["Dirección"]).slice(0, 300) || null,
          tipo: clave(f["Tipo Registro"]) === "PERSONA" ? "persona" : "empresa",
          telefonos: limpiar(f["TelefonoValo"]).slice(0, 200) || null,
          origen_id: `clientes:${r}`,
        });
        nombreEmpresa.set(r, corto);
      });
    }
  }
  const rucConocido = (r: string) => rucsActuales.has(r) || cat.empresas.some((e) => e.ruc === r);
  const rucsArchivo = new Set(cat.empresas.map((e) => e.ruc));
  {
    const csv = leerCsv("contactos");
    if (csv) {
      const TIPOS: Record<string, string> = { "GESTION DE RACIONES": "gestion_raciones", FACTURACION: "facturacion", COBRANZAS: "cobranzas" };
      const vistos = new Set<string>();
      csv.filas.forEach((f, i) => {
        const fila = i + 2;
        const r = leerRuc(f["Title"]);
        const tipo = TIPOS[clave(f["AREA DE CONTACTO"])];
        const correo = limpiar(f["CORREO"]).toLowerCase();
        const nombre = limpiar(f["PERSONA DE CONTACTO"]);
        if (!r || !(rucsArchivo.has(r) || rucsActuales.has(r))) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "Title", motivo: "La empresa (RUC) no existe" });
        if (!tipo) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "AREA DE CONTACTO", motivo: "Área de contacto desconocida" });
        if (!correoValido(correo)) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "CORREO", motivo: "Correo no válido" });
        if (nombre.length < 2) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "PERSONA DE CONTACTO", motivo: "Nombre vacío" });
        const origen = `contactos:${r}:${tipo}:${correo}`;
        if (vistos.has(origen)) return;
        vistos.add(origen);
        cat.contactos.push({
          ruc: r,
          tipo,
          nombre: nombre.slice(0, 150),
          telefono: limpiar(f["TELÉFONO"]).slice(0, 60) || null,
          correo,
          recibe: tipo === "gestion_raciones",
          origen_id: origen,
        });
      });
      const conContacto = new Set(cat.contactos.map((c) => c.ruc));
      const sin = cat.empresas.filter((e) => !conContacto.has(e.ruc));
      if (sin.length) {
        problema({ nivel: "advertencia", archivo: csv.archivo, fila: null, columna: null, motivo: `${sin.length} empresas sin ningún contacto: ${sin.slice(0, 10).map((e) => e.nombre_corto).join(", ")}` });
      }
    }
  }

  // --- Comedores ----------------------------------------------------------------
  {
    const csv = leerCsv("comedores");
    if (csv) {
      const SECTORES: Record<string, string> = { "PARTE ALTA": "PARTE_ALTA", "PARTE BAJA": "PARTE_BAJA", BARRACAS: "BARRACAS" };
      const vistos = new Set<string>();
      csv.filas.forEach((f, i) => {
        const fila = i + 2;
        const nombre = limpiar(f["NOMBRE COMEDOR"]);
        if (!nombre) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "NOMBRE COMEDOR", motivo: "Nombre vacío" });
        if (vistos.has(clave(nombre))) return;
        vistos.add(clave(nombre));
        const ambos = (h: string, e: string) => booleano(f[h]) === true && booleano(f[e]) === true;
        const sectorTexto = clave(f["TIPO_COMEDOR"]);
        const sector = SECTORES[sectorTexto] ?? null;
        if (sectorTexto && !sector) problema({ nivel: "advertencia", archivo: csv.archivo, fila, columna: "TIPO_COMEDOR", motivo: `Sector "${sectorTexto}" desconocido: se deja vacío` });
        const raciones = ambos("HABILITADO_RACIONES", "ESTADO");
        const refrigerios = ambos("HABILITADO_REFRIGERIOS", "ESTADO_REFRIGERIOS");
        const puntosK = "HABILITADO_PUNTOSK" in f ? ambos("HABILITADO_PUNTOSK", "ESTADO_PUNTOSK") : false;
        const kitchenette = "HABILITADO_KITCH" in f ? ambos("HABILITADO_KITCH", "ESTADO_KITCH") : false;
        cat.comedores.push({
          nombre: comedores.canonico(nombre),
          sector,
          raciones,
          refrigerios,
          puntos_k: puntosK,
          kitchenette,
          activo: raciones || refrigerios || puntosK || kitchenette,
          origen_id: `comedores:${clave(nombre)}`,
        });
      });
    }
  }

  // --- Servicios y tarifas -------------------------------------------------------
  {
    const csv = leerCsv("servicios");
    if (csv) {
      const TIPOS = new Set(["DESAYUNO", "ALMUERZO", "CENA"]);
      const vistos = new Map<string, string>();
      csv.filas.forEach((f, i) => {
        const fila = i + 2;
        const nombre = limpiar(f["NOMBRE SERVICIO"]);
        const tipo = clave(f["TIPO SERVICIO"]);
        const precio = monto(f["COSTO SERVICIO"]);
        const desde = fechaDmy(f["DESDE"]);
        const hasta = limpiar(f["HASTA"]) ? fechaDmy(f["HASTA"]) : "2099-12-31";
        if (!nombre) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "NOMBRE SERVICIO", motivo: "Nombre vacío" });
        if (!TIPOS.has(tipo)) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "TIPO SERVICIO", motivo: "Tipo de servicio desconocido" });
        if (precio === null || precio < 0) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "COSTO SERVICIO", motivo: "Costo no válido" });
        if (!desde || !hasta || hasta < desde) return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "DESDE / HASTA", motivo: "Fechas de vigencia no válidas" });
        const canon = servicios.canonico(nombre);
        if (!vistos.has(clave(canon))) {
          vistos.set(clave(canon), tipo);
          cat.servicios.push({ nombre: canon, tipo, a_campo: clave(canon).includes("A CAMPO") });
        }
        const choca = cat.tarifas.find((t) => clave(t.servicio) === clave(canon) && t.desde <= hasta && desde <= t.hasta);
        if (choca) {
          return problema({ nivel: "error", archivo: csv.archivo, fila, columna: "DESDE / HASTA", motivo: `La tarifa de ${canon} se cruza con la del ${choca.desde} al ${choca.hasta}` });
        }
        cat.tarifas.push({ servicio: canon, precio, desde, hasta });
      });
      // Tarifas actuales que se reemplazan (se cruzan con las del archivo y no empiezan el mismo día).
      const reemplazadas = actual.tarifas.filter((t) =>
        cat.tarifas.some((n) => clave(n.servicio) === clave(t.servicio) && n.desde <= t.hasta && t.desde <= n.hasta && n.desde !== t.desde),
      );
      if (reemplazadas.length) {
        problema({ nivel: "advertencia", archivo: csv.archivo, fila: null, columna: null, motivo: `${reemplazadas.length} tarifas actuales se cruzan con las del archivo y se reemplazan` });
      }
    }
  }

  // --- Historial de raciones ------------------------------------------------------
  const lotes: Lote[] = [];
  const meses = new Set<string>();
  let filasHistorial = 0;
  let movimientosNuevos = 0;
  let movimientosExistentes = 0;
  let sinPar = 0;
  let nombresDistintos = 0;
  let editadas = 0;
  const archivoHist = porTipo.get("historial");
  if (archivoHist) {
    type Fila = {
      fila: number;
      ruc: string;
      fecha: string;
      proyecto: string;
      area: string;
      frente: string;
      comedor: string;
      servicio: string;
      tipoRegistro: string;
      tipo: string;
      cantidad: number;
      usuario: string;
      creado: string;
      serie: number;
      lista: string;
    };
    const filas: Fila[] = [];
    let hoja;
    try {
      const hojas = abrirExcel(archivoHist.bytes);
      hoja = hojas.find((h) => h.nombre === "query (2)") ?? hojas[0];
    } catch (e) {
      problema({ nivel: "error", archivo: archivoHist.nombre, fila: null, columna: null, motivo: (e as Error).message });
    }
    if (hoja) {
      let col: Record<string, number> | null = null;
      let n = 0;
      const comboComedorServicio = new Map<string, number>();
      for await (const { numero, celdas } of hoja.filas()) {
        n = numero;
        if (!col) {
          const cab = celdas.map((c) => limpiar(c));
          const faltan = COLUMNAS_HISTORIAL.filter((c) => !cab.includes(c));
          if (faltan.length) {
            problema({ nivel: "error", archivo: archivoHist.nombre, fila: 1, columna: faltan.join(", "), motivo: "Faltan columnas: el historial no se importa" });
            break;
          }
          col = Object.fromEntries(cab.map((c, i) => [c, i]));
          continue;
        }
        filasHistorial++;
        const v = (c: string): Celda => celdas[col![c]!] ?? null;
        const err = (columna: string, motivo: string) => problema({ nivel: "error", archivo: archivoHist.nombre, fila: n, columna, motivo });
        const fecha = typeof v("FECHA") === "number" ? fechaSerie(v("FECHA") as number) : fechaDmy(v("FECHA"));
        if (!fecha) {
          err("FECHA", "Fecha no válida");
          continue;
        }
        const r = leerRuc(v("EMPRESA"));
        if (!r || !rucConocido(r)) {
          err("EMPRESA", r ? `La empresa ${r} no existe` : "RUC no válido");
          continue;
        }
        const comedorTexto = limpiar(v("COMEDOR"));
        if (!comedores.tiene(comedorTexto)) {
          err("COMEDOR", `El comedor "${comedorTexto}" no existe`);
          continue;
        }
        const servicioTexto = limpiar(v("SERVICIO"));
        if (!servicios.tiene(servicioTexto)) {
          err("SERVICIO", `El servicio "${servicioTexto}" no existe`);
          continue;
        }
        const cantidad = entero(v("CANTIDAD"));
        if (cantidad === null || cantidad === 0) {
          err("CANTIDAD", "Cantidad no válida");
          continue;
        }
        const tr = clave(v("TIPO REGISTRO"));
        let tipo: string | null = null;
        if (tr === "PROGRAMACION") tipo = cantidad > 0 ? "programacion" : "reduccion";
        else if (tr === "ADICIONALES" || tr === "REDUCCIONES") tipo = cantidad > 0 ? "adicion" : "reduccion";
        else if (tr === "TRASLADOS") tipo = cantidad > 0 ? "traslado_entrada" : "traslado_salida";
        if (!tipo) {
          err("TIPO REGISTRO", "Tipo de registro desconocido");
          continue;
        }
        const serie = typeof v("Creado") === "number" ? (v("Creado") as number) : NaN;
        const creado = instanteSerie(serie);
        if (!creado) {
          err("Creado", "Fecha de creación no válida");
          continue;
        }
        const p = limpiar(v("PROYECTO"));
        const a = limpiar(v("AREA"));
        const fr = limpiar(v("PY VALORIZACION"));
        if (!p || !a || !fr) {
          err("PROYECTO / AREA / PY VALORIZACION", "Falta proyecto, área o frente");
          continue;
        }
        const proyecto = proyectos.tiene(p) ? proyectos.canonico(p) : asegurar(proyectos, cat.proyectos, p, archivoHist.nombre, n, "PROYECTO");
        const area = areas.tiene(a) ? areas.canonico(a) : asegurar(areas, cat.areas, a, archivoHist.nombre, n, "AREA");
        const k = claveFrente(proyecto, area, fr);
        let frente = frentesArchivo.get(k)?.nombre ?? frentesActuales.get(k)?.nombre;
        if (!frente) {
          // Combinación que no está en el maestro: frente inactivo "creado por migración".
          const x = { proyecto, area, nombre: fr, sponsor: null, desde: null, hasta: null, migracion: true, origen_id: `frentes:${k}` };
          frentesArchivo.set(k, x);
          cat.frentes.push(x);
          frente = fr;
          problema({ nivel: "advertencia", archivo: archivoHist.nombre, fila: n, columna: "PY VALORIZACION", motivo: `Frente "${proyecto} / ${area} / ${fr}" no está en el maestro: se crea inactivo` });
        }
        const personal = limpiar(v("NOMBRE PERSONNEL"));
        if (personal && nombreEmpresa.get(r) && clave(personal) !== clave(nombreEmpresa.get(r))) nombresDistintos++;
        const modificado = v("Modificado");
        if (typeof modificado === "number" && Math.abs(modificado - serie) > 1 / 86_400) editadas++;
        const comedor = comedores.canonico(comedorTexto);
        const servicio = servicios.canonico(servicioTexto);
        const cs = `${comedor}|${servicio}`;
        comboComedorServicio.set(cs, (comboComedorServicio.get(cs) ?? 0) + 1);
        filas.push({
          fila: n,
          ruc: r,
          fecha,
          proyecto,
          area,
          frente,
          comedor,
          servicio,
          tipoRegistro: tr,
          tipo,
          cantidad,
          usuario: limpiar(v("Usuario")).slice(0, 120),
          creado,
          serie,
          lista: limpiar(v("Ruta de acceso")).split("/").pop() ?? "",
        });
      }

      // Comedor-servicio: lo atendido más de 2 veces en el historial (menos es probablemente un error).
      for (const [cs, veces] of comboComedorServicio) {
        if (veces <= 2) continue;
        const [comedor, servicio] = cs.split("|") as [string, string];
        cat.comedor_servicios.push({ comedor, servicio });
      }
      // Empresa-frente: cada empresa con los frentes que usó.
      const ef = new Set<string>();
      for (const f of filas) {
        const k2 = `${f.ruc}|${f.proyecto}|${f.area}|${f.frente}`;
        if (ef.has(k2)) continue;
        ef.add(k2);
        cat.empresa_frentes.push({ ruc: f.ruc, proyecto: f.proyecto, area: f.area, frente: f.frente });
      }
    }

    // Origen estable de cada fila: su contenido (las filas idénticas se numeran en orden).
    const repetidas = new Map<string, number>();
    const origen = new Map<Fila, string>();
    for (const f of filas) {
      const base = md5([f.lista, f.serie, f.fecha, f.ruc, clave(f.comedor), clave(f.servicio), clave(f.proyecto), clave(f.area), clave(f.frente), f.cantidad, f.tipoRegistro, f.usuario].join("|"));
      const k = (repetidas.get(base) ?? 0) + 1;
      repetidas.set(base, k);
      origen.set(f, `h:${base}:${k}`);
    }

    // Envíos: misma cuenta, empresa y tipo, con menos de 5 minutos entre filas.
    const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
    filas.sort((x, y) => cmp(x.usuario, y.usuario) || cmp(x.ruc, y.ruc) || cmp(x.tipoRegistro, y.tipoRegistro) || x.serie - y.serie);
    const grupos: Fila[][] = [];
    for (const f of filas) {
      const g = grupos[grupos.length - 1];
      const ultimo = g?.[g.length - 1];
      if (g && ultimo && ultimo.usuario === f.usuario && ultimo.ruc === f.ruc && ultimo.tipoRegistro === f.tipoRegistro && (f.serie - ultimo.serie) * 1440 < 5) g.push(f);
      else grupos.push([f]);
    }
    grupos.sort((x, y) => x[0]!.serie - y[0]!.serie);

    // Pares de traslado dentro de cada envío: salida (−N) con entrada (+N) de la misma fecha y cantidad.
    const par = new Map<Fila, string>();
    for (const g of grupos) {
      const entradas = g.filter((f) => f.tipo === "traslado_entrada");
      const usadas = new Set<Fila>();
      for (const s of g.filter((f) => f.tipo === "traslado_salida")) {
        const e = entradas.find((x) => !usadas.has(x) && x.fecha === s.fecha && x.cantidad === -s.cantidad);
        if (e) {
          usadas.add(e);
          par.set(s, origen.get(e)!);
          par.set(e, origen.get(s)!);
        }
      }
      sinPar += g.filter((f) => (f.tipo === "traslado_entrada" || f.tipo === "traslado_salida") && !par.has(f)).length;
    }

    // Lotes de unas 5000 filas sin partir un envío.
    let actualLote: Lote = { envios: [], movimientos: [] };
    for (const g of grupos) {
      // El envío se identifica por su fila de menor origen: no cambia si se agregan filas al grupo.
      let menor = origen.get(g[0]!)!;
      for (const f of g) if (origen.get(f)! < menor) menor = origen.get(f)!;
      const o = `he:${md5(menor)}`;
      actualLote.envios.push({
        origen_id: o,
        ruc: g[0]!.ruc,
        usuario: g[0]!.usuario,
        enviado_en: g[0]!.creado,
        filas: g.length,
        total: g.reduce((s, f) => s + f.cantidad, 0),
      });
      for (const f of g) {
        meses.add(`${f.fecha.slice(0, 7)}-01`);
        actualLote.movimientos.push([origen.get(f)!, o, f.ruc, f.fecha, f.proyecto, f.area, f.frente, f.comedor, f.servicio, f.tipo, f.cantidad, par.get(f) ?? null]);
      }
      if (actualLote.movimientos.length >= TAMANO_LOTE) {
        lotes.push(actualLote);
        actualLote = { envios: [], movimientos: [] };
      }
    }
    if (actualLote.movimientos.length) lotes.push(actualLote);

    for (const l of lotes) {
      const ya = await contarExistentes(l.movimientos.map((m) => m[0]));
      movimientosExistentes += ya;
      movimientosNuevos += l.movimientos.length - ya;
    }
    if (sinPar) problema({ nivel: "advertencia", archivo: archivoHist.nombre, fila: null, columna: "TIPO REGISTRO", motivo: `${sinPar} filas de traslado sin su par (salida o entrada): se importan igual` });
    if (nombresDistintos) problema({ nivel: "advertencia", archivo: archivoHist.nombre, fila: null, columna: "NOMBRE PERSONNEL", motivo: `${nombresDistintos} filas con un nombre de empresa distinto al del maestro (se usa el RUC)` });
  }

  const conteo = <T>(lista: T[], existe: (x: T) => boolean): Conteo => {
    const e = lista.filter(existe).length;
    return { nuevos: lista.length - e, existentes: e };
  };
  const contactosActuales = new Set(actual.contactos);
  const resumen: Record<string, Conteo | number> = {
    proyectos: conteo(cat.proyectos, (x) => proyectos.existe(x.nombre)),
    areas: conteo(cat.areas, (x) => areas.existe(x.nombre)),
    frentes: conteo(cat.frentes, (x) => frentesActuales.has(claveFrente(x.proyecto, x.area, x.nombre))),
    empresas: conteo(cat.empresas, (x) => rucsActuales.has(x.ruc)),
    contactos: conteo(cat.contactos, (x) => contactosActuales.has(x.origen_id)),
    comedores: conteo(cat.comedores, (x) => comedores.existe(x.nombre)),
    servicios: conteo(cat.servicios, (x) => servicios.existe(x.nombre)),
    tarifas: cat.tarifas.length,
    comedor_servicios: cat.comedor_servicios.length,
    empresa_frentes: cat.empresa_frentes.length,
    envios: lotes.reduce((s, l) => s + l.envios.length, 0),
    movimientos: { nuevos: movimientosNuevos, existentes: movimientosExistentes },
    filas_historial: filasHistorial,
    filas_editadas: editadas,
  };
  return { resumen, problemas, errores, advertencias, catalogos: cat, lotes, meses: [...meses].sort() };
}
