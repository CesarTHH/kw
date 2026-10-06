/** Traduce un código de error de Postgres a una clave de aviso. */
export function claveError(codigo: string | undefined): string {
  switch (codigo) {
    case "23505":
      return "duplicado";
    case "23P01":
      return "solape";
    case "23503":
      return "referencia";
    case "23514":
    case "22023":
      return "regla";
    case "42501":
      return "permiso";
    default:
      return "guardar";
  }
}
