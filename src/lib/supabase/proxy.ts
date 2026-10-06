import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Renueva la sesión de Supabase en cada petición y devuelve el usuario (si hay).
 * `cabeceras` construye las cabeceras de la petición que llegarán a la app
 * (incluye el nonce de la CSP).
 */
export async function actualizarSesion(request: NextRequest, cabeceras: () => Headers) {
  let response = NextResponse.next({ request: { headers: cabeceras() } });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: cabeceras() } });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() valida el token con Supabase Auth (no confía solo en la cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
