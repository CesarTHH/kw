import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { crearClienteAdmin, hayClaveAdmin } from "@/lib/supabase/admin";
import { FormRegistro, type Opcion } from "./FormRegistro";

export const metadata: Metadata = { title: "Registro de nuevo cliente" };

export default async function PaginaRegistro() {
  let proyectos: Opcion[] = [];
  let areas: Opcion[] = [];
  if (hayClaveAdmin()) {
    // Solo se exponen nombres de proyectos y áreas activos (datos no sensibles).
    const admin = crearClienteAdmin();
    const [p, a] = await Promise.all([
      admin.from("proyectos").select("id, nombre").eq("activo", true).order("nombre"),
      admin.from("areas").select("id, nombre").eq("activo", true).order("nombre"),
    ]);
    proyectos = (p.data ?? []) as Opcion[];
    areas = (a.data ?? []) as Opcion[];
  }

  return (
    <main className="min-h-dvh bg-gris-claro">
      <header className="flex items-center gap-4 bg-marca px-4 py-3 text-white shadow md:px-6">
        <Logo />
        <h1 className="flex-1 text-lg font-semibold">Registro de nuevo cliente</h1>
        <Link href="/login" className="text-sm underline">
          Ya tengo cuenta
        </Link>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6">
        {proyectos.length && areas.length ? (
          <FormRegistro proyectos={proyectos} areas={areas} />
        ) : (
          <p className="panel">El registro no está disponible en este momento. Inténtalo más tarde.</p>
        )}
      </div>
    </main>
  );
}
