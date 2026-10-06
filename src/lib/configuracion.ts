/** Claves de configuración general editables desde la pantalla. */
export const CLAVES_EDITABLES = [
  "zona_horaria",
  "correo.remitente_nombre",
  "correo.cco_interno",
  "contacto.destinatario",
  "archivos.pdf_menu_max_bytes",
  "archivos.contacto_max_bytes",
] as const;

/** Textos de la pantalla de configuración (claves conocidas). */
export const ETIQUETAS_GENERAL: Record<(typeof CLAVES_EDITABLES)[number], { etiqueta: string; tipo: "zona" | "texto" | "correo" | "bytes" }> = {
  zona_horaria: { etiqueta: "Zona horaria oficial", tipo: "zona" },
  "correo.remitente_nombre": { etiqueta: "Nombre del remitente de los correos", tipo: "texto" },
  "correo.cco_interno": { etiqueta: "Copia oculta interna (opcional)", tipo: "correo" },
  "contacto.destinatario": { etiqueta: "Destinatario de «Contáctanos»", tipo: "correo" },
  "archivos.pdf_menu_max_bytes": { etiqueta: "Tamaño máximo del PDF del menú (bytes)", tipo: "bytes" },
  "archivos.contacto_max_bytes": { etiqueta: "Tamaño máximo de adjuntos en Contáctanos (bytes)", tipo: "bytes" },
};

export const MODULOS_HORARIO: Record<string, string> = {
  programacion: "Programación semanal",
  adicion: "Adiciones",
  reduccion: "Reducciones",
  traslado: "Traslados",
  refrigerio: "Refrigerios",
};

export const DIAS_ISO = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;
