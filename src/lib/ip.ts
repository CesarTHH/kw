/**
 * IP del cliente para limitar intentos. Detrás del balanceador de Google Cloud la
 * cabecera llega como "<lo que mande el cliente>, <ip real>, <ip del balanceador>":
 * los primeros valores los controla el cliente, por eso se toma el penúltimo.
 */
export function ipCliente(xForwardedFor: string | null): string {
  if (!xForwardedFor) return "sin-ip";
  const partes = xForwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
  if (partes.length >= 2) return partes[partes.length - 2] ?? "sin-ip";
  return partes[0] ?? "sin-ip";
}
