/**
 * Reglas de horario de raciones (función de dominio única).
 * Su espejo en la base de datos es seguridad.validar_plazo(): ambas deben dar
 * el mismo resultado y los mismos mensajes. Los tests cubren los bordes.
 *
 * Todo se calcula con la HORA OFICIAL (la de la base de datos, en la zona
 * configurada), recibida como texto local "YYYY-MM-DDTHH:MM[:SS]".
 * Las fechas son "YYYY-MM-DD". Los plazos son exclusivos: "hasta las 17:00"
 * significa que a las 17:00:00 ya no se puede.
 */

export type ConfigPlazos = {
  semanasMaximas: number;
  /** Cierre de la semana siguiente: día ISO (1 = lunes … 7 = domingo) y hora "HH:MM" de la semana en curso. */
  cierre: { diaSemana: number; hora: string };
  permiteSemanaEnCurso: boolean;
  /** Adiciones para el día D: hasta esta hora del día D-1. */
  horaLimiteAdicion: string;
  /** Reducciones / traslados: hasta N horas antes del inicio del día D. */
  horasReduccion: number;
  horasTraslado: number;
  /** Refrigerios para el día D: hasta esta hora del día D-1. */
  horaLimiteRefrigerio: string;
  /** Reducción de refrigerios: N horas antes del inicio del día D. */
  horasReduccionRefrigerio: number;
};

export type TipoPlazo = "programacion" | "adicion" | "reduccion" | "traslado" | "refrigerio" | "refrigerio_reduccion";
export type Resultado = { ok: true } | { ok: false; motivo: string };

export const CONFIG_POR_DEFECTO: ConfigPlazos = {
  semanasMaximas: 6,
  cierre: { diaSemana: 3, hora: "23:59" },
  permiteSemanaEnCurso: false,
  horaLimiteAdicion: "17:00",
  horasReduccion: 48,
  horasTraslado: 48,
  horaLimiteRefrigerio: "17:00",
  horasReduccionRefrigerio: 48,
};

const MIN_DIA = 1440;
const DIA_MS = 86_400_000;

/** "YYYY-MM-DD" → número de día (días desde 1970-01-01). */
export function diaNumero(fecha: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) throw new Error(`Fecha no válida: ${fecha}`);
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DIA_MS);
}

export function fechaDeDia(n: number): string {
  return new Date(n * DIA_MS).toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, dias: number): string {
  return fechaDeDia(diaNumero(fecha) + dias);
}

/** Día ISO de la semana: 1 = lunes … 7 = domingo. */
export function diaSemana(fecha: string): number {
  const d = new Date(diaNumero(fecha) * DIA_MS).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Lunes de la semana de la fecha. */
export function lunes(fecha: string): string {
  return sumarDias(fecha, 1 - diaSemana(fecha));
}

function minutosHora(hora: string): number {
  const m = /^(\d{2}):(\d{2})/.exec(hora);
  if (!m) throw new Error(`Hora no válida: ${hora}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "YYYY-MM-DDTHH:MM[:SS]" → minutos (con fracción por segundos) desde 1970, en hora local. */
function minutosAhora(ahora: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/.exec(ahora);
  if (!m) throw new Error(`Hora actual no válida: ${ahora}`);
  return diaNumero(m[1]!) * MIN_DIA + Number(m[2]) * 60 + Number(m[3]) + Number(m[4] ?? 0) / 60;
}

/** dd/mm */
export function ddmm(fecha: string): string {
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
}

const DIAS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/**
 * Un instante límite (minutos) → "14/10 a las 17:00". Con ultimoMinuto, muestra el
 * último minuto permitido ("12/10 a las 23:59" en vez de "13/10 a las 00:00").
 */
function describirLimite(minutos: number, ultimoMinuto = false): string {
  const ultimo = ultimoMinuto ? minutos - 1 : minutos;
  const dia = Math.floor(ultimo / MIN_DIA);
  const resto = ultimo - dia * MIN_DIA;
  const hh = String(Math.floor(resto / 60)).padStart(2, "0");
  const mm = String(Math.floor(resto % 60)).padStart(2, "0");
  return `${ddmm(fechaDeDia(dia))} a las ${hh}:${mm}`;
}

function plazoDiaAnterior(fecha: string, ahora: number, hora: string, nombre: string): Resultado {
  const limite = (diaNumero(fecha) - 1) * MIN_DIA + minutosHora(hora);
  if (ahora < limite) return { ok: true };
  return { ok: false, motivo: `El plazo para ${nombre} del ${ddmm(fecha)} venció el ${describirLimite(limite)}` };
}

function plazoAdicion(fecha: string, ahora: number, cfg: ConfigPlazos): Resultado {
  return plazoDiaAnterior(fecha, ahora, cfg.horaLimiteAdicion, "adicionales");
}

function plazoHoras(fecha: string, ahora: number, horas: number, nombre: string): Resultado {
  const limite = diaNumero(fecha) * MIN_DIA - horas * 60;
  if (ahora < limite) return { ok: true };
  return { ok: false, motivo: `El plazo para ${nombre} el ${ddmm(fecha)} venció el ${describirLimite(limite, true)}` };
}

function plazoProgramacion(fecha: string, ahora: number, hoy: string, cfg: ConfigPlazos): Resultado {
  const dHoy = diaNumero(hoy);
  const d = diaNumero(fecha);
  if (d < dHoy) return { ok: false, motivo: `El ${ddmm(fecha)} ya pasó` };
  const lunesHoy = diaNumero(lunes(hoy));
  const lunesD = diaNumero(lunes(fecha));
  const maximo = lunesHoy + 7 * cfg.semanasMaximas + 6;
  if (d > maximo) {
    return { ok: false, motivo: `Solo se puede programar hasta el ${ddmm(fechaDeDia(maximo))} (${cfg.semanasMaximas} semanas)` };
  }
  if (lunesD === lunesHoy) {
    if (!cfg.permiteSemanaEnCurso) {
      return { ok: false, motivo: `La semana en curso no se programa: para el ${ddmm(fecha)} usa Adiciona / Reduce` };
    }
    return plazoAdicion(fecha, ahora, cfg);
  }
  if (lunesD === lunesHoy + 7) {
    const diaCierre = lunesHoy + cfg.cierre.diaSemana - 1;
    const limite = diaCierre * MIN_DIA + minutosHora(cfg.cierre.hora) + 1;
    if (ahora >= limite) {
      return {
        ok: false,
        motivo: `La programación de la semana del ${ddmm(fechaDeDia(lunesD))} cerró el ${DIAS[cfg.cierre.diaSemana]} ${ddmm(fechaDeDia(diaCierre))} a las ${cfg.cierre.hora}: usa Adiciona / Reduce`,
      };
    }
  }
  return { ok: true };
}

/** ¿Se puede registrar este tipo de movimiento para la fecha, a esta hora? */
export function validarPlazo(tipo: TipoPlazo, fecha: string, ahoraLocal: string, cfg: ConfigPlazos = CONFIG_POR_DEFECTO): Resultado {
  const ahora = minutosAhora(ahoraLocal);
  const hoy = ahoraLocal.slice(0, 10);
  switch (tipo) {
    case "programacion":
      return plazoProgramacion(fecha, ahora, hoy, cfg);
    case "adicion":
      return plazoAdicion(fecha, ahora, cfg);
    case "reduccion":
      return plazoHoras(fecha, ahora, cfg.horasReduccion, "reducir");
    case "traslado":
      return plazoHoras(fecha, ahora, cfg.horasTraslado, "trasladar");
    case "refrigerio":
      return plazoDiaAnterior(fecha, ahora, cfg.horaLimiteRefrigerio, "refrigerios");
    case "refrigerio_reduccion":
      return plazoHoras(fecha, ahora, cfg.horasReduccionRefrigerio, "reducir refrigerios");
  }
}

/** Primera fecha permitida para un tipo (busca hasta 60 días hacia adelante). */
export function primeraFechaPermitida(tipo: TipoPlazo, ahoraLocal: string, cfg: ConfigPlazos = CONFIG_POR_DEFECTO): string | null {
  const hoy = ahoraLocal.slice(0, 10);
  for (let i = 0; i <= 60; i++) {
    const f = sumarDias(hoy, i);
    if (validarPlazo(tipo, f, ahoraLocal, cfg).ok) return f;
  }
  return null;
}

/** Última fecha que se puede programar. */
export function ultimaFechaProgramable(ahoraLocal: string, cfg: ConfigPlazos = CONFIG_POR_DEFECTO): string {
  return fechaDeDia(diaNumero(lunes(ahoraLocal.slice(0, 10))) + 7 * cfg.semanasMaximas + 6);
}

/** Fechas entre desde y hasta (inclusive), máximo 120. */
export function rangoFechas(desde: string, hasta: string): string[] {
  const a = diaNumero(desde);
  const b = diaNumero(hasta);
  const salida: string[] = [];
  for (let d = a; d <= b && salida.length < 120; d++) salida.push(fechaDeDia(d));
  return salida;
}

/** Convierte las filas de config_horarios en ConfigPlazos (con valores por defecto si falta algo). */
export function configDesdeFilas(filas: { modulo: string; regla: string; valor: unknown }[]): ConfigPlazos {
  const v = (modulo: string, regla: string) => filas.find((f) => f.modulo === modulo && f.regla === regla)?.valor;
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const hora = (x: unknown, d: string) => (typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x) ? x : d);
  const cierre = v("programacion", "cierre_semana_siguiente") as { dia_semana?: unknown; hora?: unknown } | undefined;
  const d = CONFIG_POR_DEFECTO;
  return {
    semanasMaximas: num(v("programacion", "semanas_maximas"), d.semanasMaximas),
    cierre: {
      diaSemana: num(cierre?.dia_semana, d.cierre.diaSemana),
      hora: hora(cierre?.hora, d.cierre.hora),
    },
    permiteSemanaEnCurso: v("programacion", "permite_semana_en_curso") === true,
    horaLimiteAdicion: hora(v("adicion", "hora_limite_dia_anterior"), d.horaLimiteAdicion),
    horasReduccion: num(v("reduccion", "horas_anticipacion"), d.horasReduccion),
    horasTraslado: num(v("traslado", "horas_anticipacion"), d.horasTraslado),
    horaLimiteRefrigerio: hora(v("refrigerio", "hora_limite_dia_anterior"), d.horaLimiteRefrigerio),
    horasReduccionRefrigerio: num(v("refrigerio", "horas_anticipacion_reduccion"), d.horasReduccionRefrigerio),
  };
}
