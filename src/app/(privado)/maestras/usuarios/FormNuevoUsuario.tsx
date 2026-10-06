"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BotonEnviar } from "@/components/BotonEnviar";
import { crearUsuario, type EstadoNuevoUsuario } from "./acciones";
import { CamposRol } from "./CamposRol";
import { PasswordUnaVez } from "./PasswordUnaVez";

export type OpcionRol = { id: string; nombre: string; alcance: "empresa" | "todas" | "comedor" };
export type Opcion = { id: string; nombre: string };

export function FormNuevoUsuario({ roles, empresas, comedores }: { roles: OpcionRol[]; empresas: Opcion[]; comedores: Opcion[] }) {
  const [estado, accion] = useActionState<EstadoNuevoUsuario, FormData>(crearUsuario, {});

  if (estado.password && estado.correo) {
    return (
      <div className="panel space-y-3">
        <h2 className="font-semibold text-oliva">Usuario creado</h2>
        <PasswordUnaVez correo={estado.correo} password={estado.password} />
        <Link href={`/maestras/usuarios?id=${estado.id ?? ""}`} className="btn-secundario">
          Ver usuario
        </Link>
      </div>
    );
  }

  return (
    <form action={accion} className="panel space-y-3">
      <h2 className="font-semibold text-oliva">Nuevo usuario</h2>
      {estado.error && (
        <p role="alert" className="alerta-error">
          {estado.error}
        </p>
      )}
      <label className="block">
        <span className="etiqueta">Nombre completo *</span>
        <input name="nombre" required maxLength={150} className="campo" />
      </label>
      <label className="block">
        <span className="etiqueta">Correo *</span>
        <input name="correo" type="email" required maxLength={254} autoComplete="off" className="campo" />
      </label>
      <CamposRol roles={roles} empresas={empresas} comedores={comedores} />
      <p className="text-xs text-gris-medio">
        Se generará una contraseña temporal que verás una sola vez. El usuario deberá cambiarla en su primer ingreso.
      </p>
      <div className="flex justify-end">
        <BotonEnviar pendiente="Creando…">Crear usuario</BotonEnviar>
      </div>
    </form>
  );
}
