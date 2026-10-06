// Crea un usuario de EJEMPLO por cada rol en el proyecto de Supabase configurado en .env.local.
// Uso:  npm run usuarios:ejemplo
//
// - El Superadmin usa tu correo real (SUPERADMIN_EMAIL) para que puedas recuperar la contraseña.
// - Las contraseñas se generan al azar y se muestran UNA sola vez en la consola. Guárdalas en un lugar seguro.
// - Todos deben cambiar la contraseña en su primer ingreso.
// - Es seguro ejecutarlo varias veces: si el correo ya existe, lo omite.

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const clave = process.env.SUPABASE_SECRET_KEY;
const correoSuperadmin = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();

if (!url || !clave || !correoSuperadmin) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY o SUPERADMIN_EMAIL en .env.local");
  process.exit(1);
}

const supabase = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });

function passwordTemporal() {
  // 18 caracteres aleatorios + garantía de mayúscula, minúscula y número.
  return randomBytes(14).toString("base64url").replace(/[-_]/g, "x") + "Kw7a";
}

async function idPor(tabla, columna, valor) {
  const { data, error } = await supabase.from(tabla).select("id").eq(columna, valor).single();
  if (error) throw new Error(`No se encontró ${tabla}.${columna} = ${valor}. ¿Ejecutaste "npm run db:push"?`);
  return data.id;
}

const empresaAlfa = await idPor("empresas", "ruc", "20999999019");
const comedorKm52 = await idPor("comedores", "nombre", "KM 52");

const usuarios = [
  { correo: correoSuperadmin, nombre: "Superadmin", rol: "superadmin" },
  { correo: "admin@ejemplo.kw.test", nombre: "Admin de ejemplo", rol: "admin" },
  { correo: "contratista@ejemplo.kw.test", nombre: "Contratista de ejemplo", rol: "contratista", empresa_id: empresaAlfa },
  { correo: "comedor@ejemplo.kw.test", nombre: "Comedor de ejemplo", rol: "comedor", comedor_id: comedorKm52 },
  { correo: "supervisor@ejemplo.kw.test", nombre: "Supervisor de ejemplo", rol: "supervisor" },
];

const { data: existentes, error: errLista } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (errLista) {
  console.error("No se pudo listar usuarios:", errLista.message);
  process.exit(1);
}
const yaExiste = new Set(existentes.users.map((u) => u.email?.toLowerCase()));

console.log("\nUsuarios de ejemplo (guarda estas contraseñas; no se volverán a mostrar):\n");
for (const u of usuarios) {
  if (yaExiste.has(u.correo)) {
    console.log(`- ${u.rol.padEnd(12)} ${u.correo}  (ya existía, sin cambios)`);
    continue;
  }
  const password = passwordTemporal();
  const { error } = await supabase.auth.admin.createUser({
    email: u.correo,
    password,
    email_confirm: true,
    // El rol y la empresa van en app_metadata: solo el servidor puede escribirlos.
    app_metadata: {
      rol_codigo: u.rol,
      nombre: u.nombre,
      empresa_id: u.empresa_id ?? null,
      comedor_id: u.comedor_id ?? null,
      debe_cambiar_password: true,
    },
  });
  if (error) {
    console.error(`- ${u.rol.padEnd(12)} ${u.correo}  ERROR: ${error.message}`);
  } else {
    console.log(`- ${u.rol.padEnd(12)} ${u.correo}  contraseña temporal: ${password}`);
  }
}
console.log("\nListo. Ingresa en http://localhost:3000/login\n");
