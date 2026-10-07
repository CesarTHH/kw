import { AlertasLogin, type AlertaVisible } from "@/components/contenido/AlertasLogin";
import { requerirSesion } from "@/lib/auth";
import { crearClienteServidor } from "@/lib/supabase/servidor";

// Todo lo que está dentro de (privado) exige una sesión completa y activa.
export default async function LayoutPrivado({ children }: { children: React.ReactNode }) {
  await requerirSesion();
  // Alertas post-login vigentes para el rol del usuario (las "una sola vez" ya vistas no vuelven).
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("mis_alertas");
  const alertas = (data ?? []) as AlertaVisible[];
  return (
    <div className="flex min-h-dvh flex-col">
      {children}
      {alertas.length > 0 && <AlertasLogin key={alertas.map((a) => a.id).join()} alertas={alertas} />}
    </div>
  );
}
