import Link from "next/link";
import { MarcoPublico } from "@/components/MarcoPublico";

export default function Inicio() {
  return (
    <MarcoPublico>
      <h1 className="text-center text-2xl font-semibold text-white">Portal de Raciones</h1>
      <div className="flex w-full flex-col gap-3">
        <Link href="/login" className="btn-oliva w-full">
          Iniciar sesión
        </Link>
        <Link href="/registro" className="btn-oliva w-full bg-white! text-oliva!">
          Registrarse
        </Link>
      </div>
    </MarcoPublico>
  );
}
