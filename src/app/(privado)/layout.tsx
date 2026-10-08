import { AlertasLogin } from "@/components/contenido/AlertasLogin";
import { obtenerAlertas, requerirSesion } from "@/lib/auth";

// Todo lo que está dentro de (privado) exige una sesión completa y activa.
// Perfil, menú y alertas llegan en una sola consulta (ver obtenerSesion).
export default async function LayoutPrivado({ children }: { children: React.ReactNode }) {
  const [, alertas] = await Promise.all([requerirSesion(), obtenerAlertas()]);
  return (
    <div className="flex min-h-dvh flex-col">
      {children}
      {alertas.length > 0 && <AlertasLogin key={alertas.map((a) => a.id).join()} alertas={alertas} />}
    </div>
  );
}
