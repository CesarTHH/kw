import { obtenerContexto } from "@/lib/auth";
import { contentDisposition } from "@/lib/archivos";
import { esUuid } from "@/lib/busqueda";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * Entrega un PDF publicado (menú, términos, manual) a un usuario con sesión.
 * Lee con la sesión del usuario: RLS de la tabla y de Storage decide si puede verlo.
 * ?descargar=1 → descarga; si no, se muestra dentro de la página (visor).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!esUuid(id)) return new Response("No encontrado", { status: 404 });

  const ctx = await obtenerContexto();
  if (!ctx || ctx.estado !== "activo" || !ctx.activo || ctx.debe_cambiar_password || (ctx.requiere_mfa && !ctx.mfa_verificado)) {
    return new Response("No autorizado", { status: 401 });
  }

  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("documentos").select("ruta, nombre_archivo").eq("id", id).maybeSingle();
  const doc = data as { ruta: string; nombre_archivo: string } | null;
  if (!doc) return new Response("No encontrado", { status: 404 });

  const { data: archivo, error } = await supabase.storage.from("documentos").download(doc.ruta);
  if (error || !archivo) {
    console.error("[archivos] descarga:", error?.message);
    return new Response("No encontrado", { status: 404 });
  }

  const descargar = new URL(request.url).searchParams.get("descargar") === "1";
  return new Response(archivo, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(descargar ? "attachment" : "inline", doc.nombre_archivo),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
