// Verificación de salud para Cloud Run: responde rápido y sin tocar la base de datos.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
}
