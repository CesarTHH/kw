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

  // getClaims() renueva la sesión si venció y verifica la firma del token con la clave
  // pública del proyecto (ES256), sin un viaje extra a Supabase Auth en cada página.
  // Si el proyecto aún firmara con la clave antigua, consulta a Supabase Auth como antes.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? { id: data.claims.sub } : null;

  return { response, user };
}
