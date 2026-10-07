/** Conversión entre "fecha y hora local" de una zona horaria (p. ej. America/Lima) y UTC. */

function desfaseMs(instante: number, zona: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instante));
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const comoUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/** "2026-10-15T08:30" en la zona → ISO UTC. Devuelve null si el texto no es válido. */
export function localAUtc(local: string, zona: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, a, me, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const supuesto = Date.UTC(a, me - 1, d, h, mi);
  if (Number.isNaN(supuesto) || new Date(supuesto).getUTCDate() !== d) return null;
  let utc = supuesto - desfaseMs(supuesto, zona);
  utc = supuesto - desfaseMs(utc, zona);
  return new Date(utc).toISOString();
}

/** ISO UTC → "2026-10-15T08:30" en la zona (para inputs datetime-local). */
export function utcALocal(iso: string, zona: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + desfaseMs(t, zona)).toISOString().slice(0, 16);
}

/** ISO UTC → "15/10/2026 08:30" en la zona. */
export function fechaHora(iso: string, zona: string): string {
  const l = utcALocal(iso, zona);
  return l ? `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} ${l.slice(11, 16)}` : "";
}
