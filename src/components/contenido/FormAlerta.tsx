"use client";

import { useState } from "react";

/**
 * Formulario de alerta con revisión previa en el navegador (fechas y roles), para no
 * perder lo escrito si falta algo. El servidor vuelve a validar todo.
 */
export function FormAlerta({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  children: React.ReactNode;
}) {
  const [aviso, setAviso] = useState("");
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        const f = new FormData(e.currentTarget);
        const desde = String(f.get("desde") ?? "");
        const hasta = String(f.get("hasta") ?? "");
        let error = "";
        if (!f.getAll("roles").length) error = "Elige al menos un rol.";
        else if (desde && hasta && hasta <= desde) error = "La fecha final debe ser posterior a la inicial.";
        setAviso(error);
        if (error) e.preventDefault();
      }}
    >
      {aviso && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {aviso}
        </p>
      )}
      {children}
    </form>
  );
}
