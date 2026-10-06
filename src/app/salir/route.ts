import { NextResponse, type NextRequest } from "next/server";
import { obtenerContexto } from "@/lib/auth";
import { crearClienteServidor } from "@/lib/supabase/servidor";

async function cerrarSesion(request: NextRequest, motivo: string) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase.rpc("registrar_evento", { p_accion: "logout", p_detalle: { motivo } });
    await supabase.auth.signOut();
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("motivo", motivo);
  // 303: el navegador sigue la redirección con GET.
  return NextResponse.redirect(url, 303);
}

// Botón "Cerrar sesión" (formulario POST desde la misma app).
export async function POST(request: NextRequest) {
  const origen = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origen && host && new URL(origen).host !== host) {
    return new NextResponse("Origen no permitido", { status: 403 });
  }
  return cerrarSesion(request, "salida");
}

// Cierre forzado: solo si la cuenta realmente no puede seguir (evita que otro sitio
// cierre la sesión de un usuario normal con un simple enlace).
export async function GET(request: NextRequest) {
  const ctx = await obtenerContexto();
  const faltaSoloMfa = !!ctx && ctx.estado === "activo" && ctx.requiere_mfa && !ctx.mfa_verificado;
  const bloqueado = !ctx || ctx.estado === "inactivo" || (ctx.estado === "activo" && !ctx.activo && !faltaSoloMfa);
  if (!bloqueado) {
    const url = request.nextUrl.clone();
    url.pathname = "/menu";
    url.search = "";
    return NextResponse.redirect(url, 303);
  }
  return cerrarSesion(request, ctx?.estado === "inactivo" ? "inactivo" : "error");
}
