/** Mensajes de resultado que llegan por la URL (?ok=… / ?error=…). Solo se muestran textos conocidos. */
const OK: Record<string, string> = {
  guardado: "Cambios guardados.",
  creado: "Registro creado.",
  estado: "Estado actualizado.",
  asignado: "Asignación guardada.",
  aprobada: "Solicitud aprobada.",
  rechazada: "Solicitud rechazada.",
  password: "Se generó una contraseña temporal.",
};
const ERROR: Record<string, string> = {
  permiso: "No tienes permiso para esta acción.",
  datos: "Revisa los datos ingresados.",
  duplicado: "Ya existe un registro con esos datos.",
  solape: "Las fechas se cruzan con otra tarifa del mismo servicio.",
  referencia: "No se puede guardar: un dato relacionado no existe o está en uso.",
  regla: "La operación no cumple una regla del sistema.",
  guardar: "No se pudo guardar. Inténtalo de nuevo.",
  noexiste: "El registro no existe o no tienes acceso.",
};

export function Avisos({ ok, error, detalle }: { ok?: string; error?: string; detalle?: string }) {
  return (
    <>
      {ok && OK[ok] && <p className="alerta-ok">{OK[ok]}</p>}
      {error && ERROR[error] && (
        <p role="alert" className="alerta-error">
          {ERROR[error]}
          {detalle ? ` ${detalle}` : ""}
        </p>
      )}
    </>
  );
}
