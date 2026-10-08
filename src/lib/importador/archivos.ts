/** Reconocimiento de los archivos del importador por su nombre (lo usan la pantalla y el servidor). */

const quitarTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export const TIPOS_ARCHIVO: Record<string, string> = {
  proyectos: "Maestro de proyectos",
  areas: "Maestro de áreas",
  frentes: "Maestro de proyecto - cliente (frentes)",
  empresas: "Maestro de clientes",
  contactos: "Maestro de contactos",
  comedores: "Maestro de comedores",
  servicios: "Maestro de servicios y tarifas",
  historial: "Historial de raciones (DATA SOLICITUD)",
};

/** Archivo reconocido por su nombre (como se exportan hoy). */
export function tipoArchivo(nombre: string): string | null {
  const k = quitarTildes(nombre);
  if (/\.XLSX$/.test(k)) return "historial";
  if (!/\.CSV$/.test(k)) return null;
  if (k.includes("PROYECTO - CLIENTE")) return "frentes";
  if (k.includes("MAESTRO DE PROYECTOS")) return "proyectos";
  if (k.includes("MAESTRO DE AREAS")) return "areas";
  if (k.includes("MAESTRO DE CLIENTES")) return "empresas";
  if (k.includes("MAESTRO DE CONTACTOS")) return "contactos";
  if (k.includes("MAESTRO DE COMEDORES")) return "comedores";
  if (k.includes("MAESTRO DE SERVICIOS")) return "servicios";
  return null;
}

export const MIME_ARCHIVO = (nombre: string) =>
  /\.xlsx$/i.test(nombre) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv";

/** Ruta en el bucket privado: <importación>/<n>.<extensión> (nunca el nombre original). */
export const rutaArchivo = (id: string, n: number, nombre: string) => `${id}/original-${n}.${/\.xlsx$/i.test(nombre) ? "xlsx" : "csv"}`;
export const rutaLote = (id: string, n: number) => `${id}/lotes/lote-${String(n).padStart(4, "0")}.json`;
export const rutaCatalogos = (id: string) => `${id}/lotes/catalogos.json`;

export const MAX_BYTES_IMPORTACION = 50 * 1024 * 1024;
