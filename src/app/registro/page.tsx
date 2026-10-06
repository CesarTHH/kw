import Link from "next/link";
import { MarcoPublico } from "@/components/MarcoPublico";

export default function PaginaRegistro() {
  return (
    <MarcoPublico>
      <h1 className="text-center text-2xl font-semibold text-white">Registro de nuevo cliente</h1>
      <p className="text-center text-white">El formulario de registro se habilita en la Fase 2.</p>
      <Link href="/" className="text-sm text-white underline">Volver</Link>
    </MarcoPublico>
  );
}
