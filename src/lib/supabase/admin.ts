import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

/**
 * Cliente con la clave SECRETA (service_role): salta RLS.
 * Usar SOLO en el servidor y SOLO para tareas de administración que lo requieran
 * (crear usuarios en Auth, importador). Siempre verificar permisos ANTES de usarlo.
 */
export function crearClienteAdmin() {
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!clave) {
    throw new Error("Falta la variable SUPABASE_SECRET_KEY");
  }
  return createClient(SUPABASE_URL, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
