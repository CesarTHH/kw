import { Construction } from "lucide-react";

export function EnConstruccion({ modulo, fase }: { modulo: string; fase: number }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl bg-white p-8 text-center shadow">
      <Construction className="mx-auto size-12 text-marca" />
      <h2 className="mt-4 text-xl font-semibold text-oliva">{modulo}</h2>
      <p className="mt-2 text-gris-medio">Este módulo se construye en la Fase {fase}.</p>
    </div>
  );
}
