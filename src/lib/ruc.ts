const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Valida un RUC peruano: 11 dígitos y dígito verificador correcto. Igual que seguridad.ruc_valido() en la BD. */
export function rucValido(ruc: string): boolean {
  if (!/^\d{11}$/.test(ruc)) return false;
  const suma = PESOS.reduce((acc, peso, i) => acc + Number(ruc[i]) * peso, 0);
  const resto = 11 - (suma % 11);
  const dv = resto === 10 ? 0 : resto === 11 ? 1 : resto;
  return dv === Number(ruc[10]);
}
