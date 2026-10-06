import { NextResponse, type NextRequest } from "next/server";
import { construirCSP } from "@/lib/csp";
import { SUPABASE_URL } from "@/lib/env";
import { esRutaPublica } from "@/lib/rutas";
import { actualizarSesion } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = construirCSP(nonce, SUPABASE_URL, process.env.NODE_ENV === "development");

  const cabeceras = () => {
    const h = new Headers(request.headers);
    h.set("x-nonce", nonce);
    h.set("Content-Security-Policy", csp);
    return h;
  };

  const { response, user } = await actualizarSesion(request, cabeceras);
  const path = request.nextUrl.pathname;

  const redirigir = (destino: string, siguiente?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = destino;
    url.search = "";
    if (siguiente) url.searchParams.set("next", siguiente);
    const r = NextResponse.redirect(url);
    // Conservar las cookies de sesión renovadas.
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    r.headers.set("Content-Security-Policy", csp);
    return r;
  };

  if (!user && !esRutaPublica(path)) {
    return redirigir("/login", path + request.nextUrl.search);
  }
  if (user && (path === "/" || path === "/login")) {
    return redirigir("/menu");
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Todo excepto archivos estáticos.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
