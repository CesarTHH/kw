import "server-only";
import { randomBytes, randomInt } from "node:crypto";

const MAYUS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MINUS = "abcdefghijkmnopqrstuvwxyz";
const DIGITOS = "23456789";
const TODOS = MAYUS + MINUS + DIGITOS;

/**
 * Contraseña temporal de 16 caracteres (sin caracteres confusos como 0/O o 1/l).
 * Cumple la política: mayúscula, minúscula y número. El usuario la cambia al ingresar.
 */
export function passwordTemporal(): string {
  const bytes = randomBytes(13);
  const base = Array.from(bytes, (b) => TODOS[b % TODOS.length]);
  const obligatorios = [
    MAYUS[randomInt(MAYUS.length)]!,
    MINUS[randomInt(MINUS.length)]!,
    DIGITOS[randomInt(DIGITOS.length)]!,
  ];
  for (const c of obligatorios) base.splice(randomInt(base.length + 1), 0, c);
  return base.join("");
}
