import type { Metadata } from "next";
import { FormContacto } from "@/components/contenido/FormContacto";
import { Encabezado } from "@/components/Encabezado";
import { requerirPermiso } from "@/lib/auth";
import { leerConfig, numero, zonaHoraria } from "@/lib/contenido/servidor";
import { fechaHora } from "@/lib/fechas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Contáctanos" };

type Mensaje = { id: string; created_at: string; asunto: string; cc: string[]; adjuntos: { nombre: string }[] };

export default async function Pagina() {
  const ctx = await requerirPermiso("contactanos", "enviar");
  const supabase = await crearClienteServidor();
  const [config, zona, { data }] = await Promise.all([
    leerConfig(["contacto.destinatario", "contacto.cc_maximo", "archivos.contacto_max_bytes"]),
    zonaHoraria(),
    supabase
      .from("mensajes_contacto")
      .select("id, created_at, asunto, cc, adjuntos")
      .eq("usuario_id", ctx.usuario_id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const para = String(config.get("contacto.destinatario") ?? "");
  const mensajes = (data ?? []) as Mensaje[];

  return (
    <>
      <Encabezado titulo="Contáctanos" ctx={ctx} />
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="t-nuevo">
          <h2 id="t-nuevo" className="mb-2 text-lg font-semibold text-oliva">
            Nuevo mensaje
          </h2>
          {para ? (
            <FormContacto
              para={para}
              ccMaximo={numero(config.get("contacto.cc_maximo"), 5)}
              maxBytes={numero(config.get("archivos.contacto_max_bytes"), 10_485_760)}
            />
          ) : (
            <p className="panel text-oliva">El destinatario de Contáctanos aún no está configurado.</p>
          )}
        </section>
        <section aria-labelledby="t-enviados">
          <h2 id="t-enviados" className="mb-2 text-lg font-semibold text-oliva">
            Mensajes enviados
          </h2>
          {mensajes.length === 0 ? (
            <p className="panel text-sm text-gris-medio">Aún no has enviado mensajes.</p>
          ) : (
            <ul className="space-y-2">
              {mensajes.map((m) => (
                <li key={m.id} className="panel py-3 text-sm">
                  <p className="font-semibold">{m.asunto}</p>
                  <p className="text-xs text-gris-medio">{fechaHora(m.created_at, zona)}</p>
                  {m.cc.length > 0 && <p className="text-xs">CC: {m.cc.join(", ")}</p>}
                  {m.adjuntos.length > 0 && <p className="text-xs">Adjuntos: {m.adjuntos.map((a) => a.nombre).join(", ")}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
