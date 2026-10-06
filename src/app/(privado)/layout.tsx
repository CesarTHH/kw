import { requerirSesion } from "@/lib/auth";

// Todo lo que está dentro de (privado) exige una sesión completa y activa.
export default async function LayoutPrivado({ children }: { children: React.ReactNode }) {
  await requerirSesion();
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
