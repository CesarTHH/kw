import type { Metadata } from "next";
import { BotonEnviar } from "@/components/BotonEnviar";
import { Encabezado } from "@/components/Encabezado";
import { Avisos } from "@/components/maestras/Avisos";
import { obtenerMenu, requerirPermiso } from "@/lib/auth";
import { CLAVES_EDITABLES, DIAS_ISO, ETIQUETAS_GENERAL, MODOS_CORREO, MODULOS_HORARIO } from "@/lib/configuracion";
import { puede } from "@/lib/permisos";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { guardarGeneral, guardarHorarios } from "./acciones";

export const metadata: Metadata = { title: "Configuración y horarios" };

type Regla = { modulo: string; regla: string; valor: unknown; descripcion: string };
type Config = { clave: string; valor: unknown; descripcion: string | null };

export default async function PaginaConfiguracion({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const ctx = await requerirPermiso("admin.configuracion");
  const editar = puede(await obtenerMenu(), "admin.configuracion", "editar");
  const { ok, error } = await searchParams;
  const supabase = await crearClienteServidor();

  const [{ data: reglasData }, { data: configData }, { data: hora }] = await Promise.all([
    supabase.from("config_horarios").select("modulo, regla, valor, descripcion").order("modulo").order("regla"),
    supabase.from("configuracion").select("clave, valor, descripcion").in("clave", [...CLAVES_EDITABLES]),
    supabase.rpc("hora_servidor").maybeSingle(),
  ]);
  const reglas = (reglasData ?? []) as Regla[];
  const config = new Map(((configData ?? []) as Config[]).map((c) => [c.clave, c]));
  const modulos = Object.keys(MODULOS_HORARIO).filter((m) => reglas.some((r) => r.modulo === m));
  const zonas = Intl.supportedValuesOf("timeZone");
  const ahora = hora as { ahora_local?: string; zona?: string } | null;

  return (
    <>
      <Encabezado titulo="Configuración y horarios" ctx={ctx} />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6">
        <Avisos ok={ok} error={error} />
        {ahora?.ahora_local && (
          <p className="text-sm text-oliva">
            Hora oficial del sistema: <strong>{ahora.ahora_local.slice(0, 16).replace("T", " ")}</strong> ({ahora.zona}). Todos
            los plazos se calculan con esta hora, no con la del equipo del usuario.
          </p>
        )}

        <form action={guardarHorarios} className="space-y-4">
          <h2 className="text-xl font-semibold text-oliva">Horarios y plazos</h2>
          <p className="text-sm text-gris-medio">
            Solo el Superadmin puede registrar fuera de estos plazos, indicando siempre el motivo.
          </p>
          {modulos.map((m) => (
            <fieldset key={m} className="panel space-y-3">
              <legend className="rounded bg-oliva px-3 py-1 text-sm font-semibold text-white">{MODULOS_HORARIO[m]}</legend>
              {reglas
                .filter((r) => r.modulo === m)
                .map((r) => (
                  <CampoRegla key={r.regla} regla={r} editar={editar} />
                ))}
            </fieldset>
          ))}
          {editar && (
            <div className="flex justify-end">
              <BotonEnviar pendiente="Guardando…">Guardar horarios</BotonEnviar>
            </div>
          )}
        </form>

        <form action={guardarGeneral} className="panel space-y-3">
          <h2 className="text-xl font-semibold text-oliva">Configuración general</h2>
          {CLAVES_EDITABLES.filter((k) => config.has(k)).map((k) => {
            const c = config.get(k)!;
            const meta = ETIQUETAS_GENERAL[k];
            const valor = c.valor === null || c.valor === undefined ? "" : String(c.valor);
            return (
              <label key={k} className="block">
                <span className="etiqueta">{meta.etiqueta}</span>
                {meta.tipo === "zona" ? (
                  <select name={k} defaultValue={valor} disabled={!editar} className="campo">
                    {zonas.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                ) : meta.tipo === "modo" ? (
                  <select name={k} defaultValue={valor} disabled={!editar} className="campo">
                    {Object.entries(MODOS_CORREO).map(([m, t]) => (
                      <option key={m} value={m}>
                        {t}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name={k}
                    type={meta.tipo === "correo" ? "email" : meta.tipo === "bytes" ? "number" : meta.tipo === "url" ? "url" : "text"}
                    min={meta.tipo === "bytes" ? 1024 : undefined}
                    defaultValue={valor}
                    maxLength={300}
                    disabled={!editar}
                    className="campo"
                  />
                )}
                {c.descripcion && <span className="mt-1 block text-xs text-gris-medio">{c.descripcion}</span>}
              </label>
            );
          })}
          {editar && (
            <div className="flex justify-end">
              <BotonEnviar pendiente="Guardando…">Guardar configuración</BotonEnviar>
            </div>
          )}
        </form>
      </main>
    </>
  );
}

function CampoRegla({ regla: r, editar }: { regla: Regla; editar: boolean }) {
  const nombre = `${r.modulo}.${r.regla}`;
  const v = r.valor;
  let control: React.ReactNode;
  if (typeof v === "boolean") {
    control = (
      <input aria-labelledby={`d-${nombre}`} type="checkbox" name={nombre} defaultChecked={v} disabled={!editar} className="size-5 accent-marca" />
    );
  } else if (typeof v === "number") {
    control = (
      <input aria-labelledby={`d-${nombre}`} type="number" name={nombre} defaultValue={v} min={0} max={1000} step={1} required disabled={!editar} className="campo w-32" />
    );
  } else if (typeof v === "string") {
    control = <input aria-labelledby={`d-${nombre}`} type="time" name={nombre} defaultValue={v} required disabled={!editar} className="campo w-36" />;
  } else if (v && typeof v === "object") {
    const o = v as { dia_semana?: number; hora?: string };
    control = (
      <span className="flex flex-wrap gap-2">
        <select aria-labelledby={`d-${nombre}`} name={`${nombre}.dia_semana`} defaultValue={String(o.dia_semana ?? 3)} disabled={!editar} className="campo w-40">
          {DIAS_ISO.slice(1).map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
        <input aria-labelledby={`d-${nombre}`} type="time" name={`${nombre}.hora`} defaultValue={o.hora ?? "23:59"} required disabled={!editar} className="campo w-36" />
      </span>
    );
  }
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto]">
      <span id={`d-${nombre}`} className="text-sm">
        {r.descripcion}
      </span>
      <div>{control}</div>
    </div>
  );
}
