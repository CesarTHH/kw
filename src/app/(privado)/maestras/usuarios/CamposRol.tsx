"use client";

import { useState } from "react";
import type { Opcion, OpcionRol } from "./FormNuevoUsuario";

/** Rol + empresa o comedor (según el alcance del rol elegido). */
export function CamposRol({
  roles,
  empresas,
  comedores,
  rolId: rolInicial = "",
  empresaId = "",
  comedorId = "",
  deshabilitado = false,
}: {
  roles: OpcionRol[];
  empresas: Opcion[];
  comedores: Opcion[];
  rolId?: string;
  empresaId?: string;
  comedorId?: string;
  deshabilitado?: boolean;
}) {
  const [rolId, setRolId] = useState(rolInicial);
  const alcance = roles.find((r) => r.id === rolId)?.alcance;
  return (
    <>
      <label className="block">
        <span className="etiqueta">Rol *</span>
        <select name="rol_id" required value={rolId} onChange={(e) => setRolId(e.target.value)} disabled={deshabilitado} className="campo">
          <option value="" disabled>
            Elige…
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
      </label>
      {alcance === "empresa" && (
        <label className="block">
          <span className="etiqueta">Empresa *</span>
          <select name="empresa_id" required defaultValue={empresaId} disabled={deshabilitado} className="campo">
            <option value="" disabled>
              Elige…
            </option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
      {alcance === "comedor" && (
        <label className="block">
          <span className="etiqueta">Comedor *</span>
          <select name="comedor_id" required defaultValue={comedorId} disabled={deshabilitado} className="campo">
            <option value="" disabled>
              Elige…
            </option>
            {comedores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
