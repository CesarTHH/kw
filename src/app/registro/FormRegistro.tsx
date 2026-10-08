"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { rucValido } from "@/lib/ruc";
import { registrarSolicitud, type EstadoRegistro } from "./acciones";

export type Opcion = { id: string; nombre: string };
type Fila = { clave: number; proyecto_id: string; area_id: string; frente: string; sponsor: string; desde: string; hasta: string };

const CONTACTOS = [
  { tipo: "gestion_raciones", titulo: "Contacto para la gestión de raciones" },
  { tipo: "facturacion", titulo: "Contacto de facturación" },
  { tipo: "cobranzas", titulo: "Contacto de cobranzas" },
] as const;

const filaVacia = (clave: number): Fila => ({ clave, proyecto_id: "", area_id: "", frente: "", sponsor: "", desde: "", hasta: "" });

export function FormRegistro({ proyectos, areas }: { proyectos: Opcion[]; areas: Opcion[] }) {
  const [estado, accion, pendiente] = useActionState<EstadoRegistro, FormData>(registrarSolicitud, {});
  const [paso, setPaso] = useState<1 | 2>(1);
  const [filas, setFilas] = useState<Fila[]>([filaVacia(1)]);
  const [errorPaso, setErrorPaso] = useState<string>();
  const siguiente = useRef(2);
  const paso1 = useRef<HTMLFieldSetElement>(null);

  if (estado.enviado) {
    return (
      <div className="mx-auto max-w-lg rounded-xl bg-white p-8 text-center shadow">
        <CheckCircle2 className="mx-auto size-14 text-green-700" aria-hidden />
        <h2 className="mt-3 text-xl font-semibold text-oliva">¡Solicitud enviada!</h2>
        <p className="mt-2 text-sm">
          Revisaremos tus datos y te escribiremos al correo indicado con tu usuario y contraseña cuando la solicitud sea aprobada.
        </p>
        <Link href="/" className="btn-oliva mt-6">
          Volver al inicio
        </Link>
      </div>
    );
  }

  const cambiar = (clave: number, campo: keyof Omit<Fila, "clave">, valor: string) =>
    setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, [campo]: valor } : f)));

  function irPaso2() {
    setErrorPaso(undefined);
    // Validación nativa de los campos del paso 1 + reglas propias.
    const campos = paso1.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select") ?? [];
    for (const c of campos) {
      if (!c.checkValidity()) {
        c.reportValidity();
        return;
      }
    }
    const ruc = (paso1.current?.querySelector<HTMLInputElement>("input[name=ruc]")?.value ?? "").trim();
    if (!rucValido(ruc)) return setErrorPaso("El RUC no es válido. Revisa los 11 dígitos.");
    if (filas.some((f) => f.hasta < f.desde)) return setErrorPaso("En un frente, la fecha final es anterior a la inicial.");
    setPaso(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <form
      // Envío manual: así React no limpia el formulario si el servidor devuelve un error.
      onSubmit={(e) => {
        e.preventDefault();
        const datos = new FormData(e.currentTarget);
        startTransition(() => accion(datos));
      }}
      className="space-y-6"
    >
      <ol className="flex gap-2 text-sm font-semibold" aria-label="Pasos">
        <li className={`rounded-full px-4 py-1 ${paso === 1 ? "bg-marca text-white" : "bg-white text-oliva"}`}>1. Empresa y frentes</li>
        <li className={`rounded-full px-4 py-1 ${paso === 2 ? "bg-marca text-white" : "bg-white text-oliva"}`}>2. Contactos y usuario</li>
      </ol>

      {(estado.error || errorPaso) && (
        <p role="alert" className="alerta-error">
          {errorPaso ?? estado.error}
        </p>
      )}

      {/* Campo trampa para robots (oculto a personas y lectores de pantalla). */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Sitio web
          <input name="sitio_web" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <input type="hidden" name="frentes" value={JSON.stringify(filas.map(({ clave: _c, ...f }) => f))} />

      <fieldset ref={paso1} hidden={paso !== 1} className="space-y-4">
        <div className="panel grid gap-3 md:grid-cols-[12rem_1fr]">
          <label className="block">
            <span className="etiqueta">RUC *</span>
            <input name="ruc" required inputMode="numeric" pattern="\d{11}" maxLength={11} className="campo font-mono" />
          </label>
          <label className="block">
            <span className="etiqueta">Razón social *</span>
            <input name="razon_social" required maxLength={200} className="campo" />
          </label>
          <label className="block md:col-span-2">
            <span className="etiqueta">Dirección</span>
            <input name="direccion" maxLength={300} className="campo" />
          </label>
        </div>

        <div className="space-y-2">
          <h2 className="font-semibold text-oliva">Proyectos y frentes de trabajo</h2>
          <div className="overflow-x-auto rounded-xl shadow">
            <table className="tabla min-w-[56rem]">
              <thead>
                <tr>
                  <th scope="col">Proyecto *</th>
                  <th scope="col">Área *</th>
                  <th scope="col">Frente de trabajo *</th>
                  <th scope="col">Sponsor</th>
                  <th scope="col">Inicio contrato *</th>
                  <th scope="col">Fin contrato *</th>
                  <th scope="col">
                    <span className="sr-only">Quitar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={f.clave}>
                    <td>
                      <select
                        required
                        value={f.proyecto_id}
                        onChange={(e) => cambiar(f.clave, "proyecto_id", e.target.value)}
                        aria-label={`Proyecto, fila ${i + 1}`}
                        className="campo"
                      >
                        <option value="" disabled>
                          Elige…
                        </option>
                        {proyectos.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.nombre}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        required
                        value={f.area_id}
                        onChange={(e) => cambiar(f.clave, "area_id", e.target.value)}
                        aria-label={`Área, fila ${i + 1}`}
                        className="campo"
                      >
                        <option value="" disabled>
                          Elige…
                        </option>
                        {areas.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.nombre}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        required
                        minLength={2}
                        maxLength={150}
                        value={f.frente}
                        onChange={(e) => cambiar(f.clave, "frente", e.target.value)}
                        aria-label={`Frente de trabajo, fila ${i + 1}`}
                        className="campo uppercase"
                      />
                    </td>
                    <td>
                      <input
                        maxLength={150}
                        value={f.sponsor}
                        onChange={(e) => cambiar(f.clave, "sponsor", e.target.value)}
                        aria-label={`Sponsor, fila ${i + 1}`}
                        className="campo"
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        required
                        value={f.desde}
                        onChange={(e) => cambiar(f.clave, "desde", e.target.value)}
                        aria-label={`Inicio de contrato, fila ${i + 1}`}
                        className="campo"
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        required
                        min={f.desde || undefined}
                        value={f.hasta}
                        onChange={(e) => cambiar(f.clave, "hasta", e.target.value)}
                        aria-label={`Fin de contrato, fila ${i + 1}`}
                        className="campo"
                      />
                    </td>
                    <td>
                      {filas.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))}
                          className="btn-icono text-red-700 hover:bg-red-50"
                          aria-label={`Quitar fila ${i + 1}`}
                        >
                          <Trash2 className="size-5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length < 30 && (
            <button
              type="button"
              onClick={() => setFilas((fs) => [...fs, filaVacia(siguiente.current++)])}
              className="btn-secundario"
            >
              <Plus className="size-4" aria-hidden /> Agregar frente
            </button>
          )}
          <p className="text-xs text-gris-medio">¿No encuentras tu proyecto o área? Escríbenos desde «Contáctanos» después de registrarte.</p>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={irPaso2} className="btn-oliva">
            Siguiente
          </button>
        </div>
      </fieldset>

      <fieldset hidden={paso !== 2} disabled={paso !== 2} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {CONTACTOS.map((c) => (
            <div key={c.tipo} className="panel space-y-2">
              <h2 className="text-sm font-semibold text-oliva">{c.titulo}</h2>
              <label className="block">
                <span className="etiqueta">Nombre *</span>
                <input name={`${c.tipo}.nombre`} required minLength={2} maxLength={150} className="campo" />
              </label>
              <label className="block">
                <span className="etiqueta">Teléfono</span>
                <input name={`${c.tipo}.telefono`} maxLength={60} inputMode="tel" className="campo" />
              </label>
              <label className="block">
                <span className="etiqueta">Correo *</span>
                <input name={`${c.tipo}.correo`} type="email" required maxLength={254} className="campo" />
              </label>
            </div>
          ))}
        </div>

        <div className="panel grid gap-3 md:grid-cols-3">
          <h2 className="font-semibold text-oliva md:col-span-3">Tus datos de usuario</h2>
          <label className="block">
            <span className="etiqueta">Nombre completo *</span>
            <input name="usuario_nombre" required minLength={2} maxLength={150} autoComplete="name" className="campo" />
          </label>
          <label className="block">
            <span className="etiqueta">Correo (será tu usuario) *</span>
            <input name="usuario_correo" type="email" required maxLength={254} autoComplete="email" className="campo" />
          </label>
          <label className="block">
            <span className="etiqueta">Teléfono</span>
            <input name="usuario_telefono" maxLength={30} inputMode="tel" autoComplete="tel" className="campo" />
          </label>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acepta_tyc" required className="mt-0.5 size-4 accent-marca" />
          <span>
            Acepto los términos y condiciones del servicio y el tratamiento de mis datos para gestionar el registro.
          </span>
        </label>

        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => setPaso(1)} className="btn-secundario">
            Anterior
          </button>
          <button type="submit" className="btn-oliva" disabled={pendiente} aria-busy={pendiente}>
            {pendiente ? "Enviando…" : "Enviar solicitud"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
