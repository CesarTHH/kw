/**
 * Limitador de intentos en memoria (por instancia del servidor).
 * Complementa los límites propios de Supabase Auth; frena ataques de fuerza bruta simples.
 */
export class Limitador {
  private intentos = new Map<string, number[]>();

  constructor(
    private readonly maximo: number,
    private readonly ventanaMs: number,
    private readonly maxClaves = 10_000,
  ) {}

  /** Registra un intento y devuelve true si todavía está permitido. */
  permitir(clave: string, ahora = Date.now()): boolean {
    const desde = ahora - this.ventanaMs;
    const lista = (this.intentos.get(clave) ?? []).filter((t) => t > desde);
    if (lista.length >= this.maximo) {
      this.intentos.set(clave, lista);
      return false;
    }
    lista.push(ahora);
    this.intentos.set(clave, lista);
    if (this.intentos.size > this.maxClaves) this.limpiar(ahora);
    return true;
  }

  /** Borra el historial de una clave (por ejemplo, tras un login correcto). */
  reiniciar(clave: string): void {
    this.intentos.delete(clave);
  }

  private limpiar(ahora: number): void {
    const desde = ahora - this.ventanaMs;
    for (const [clave, lista] of this.intentos) {
      if (!lista.some((t) => t > desde)) this.intentos.delete(clave);
    }
  }
}
