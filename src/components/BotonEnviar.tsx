"use client";

import { useFormStatus } from "react-dom";

/** Botón de formulario que se deshabilita mientras se envía (evita doble clic). */
export function BotonEnviar({
  children,
  pendiente = "Procesando…",
  className = "btn-marca",
}: {
  children: React.ReactNode;
  pendiente?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendiente : children}
    </button>
  );
}
