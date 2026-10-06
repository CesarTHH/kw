/** Claves de configuración general editables desde la pantalla. */
export const CLAVES_EDITABLES = [
  "zona_horaria",
  "app.url",
  "correo.modo",
  "correo.remitente_nombre",
  "correo.remitente_direccion",
  "correo.cco_interno",
  "contacto.destinatario",
  "archivos.pdf_menu_max_bytes",
  "archivos.contacto_max_bytes",
] as const;

/** Textos de la pantalla de configuración (claves conocidas). */
export const ETIQUETAS_GENERAL: Record<(typeof CLAVES_EDITABLES)[number], { etiqueta: string; tipo: "zona" | "texto" | "correo" | "bytes" | "url" | "modo" }> = {
  zona_horaria: { etiqueta: "Zona horaria oficial", tipo: "zona" },
  "app.url": { etiqueta: "Dirección pública de la app", tipo: "url" },
  "correo.modo": { etiqueta: "Envío de correos", tipo: "modo" },
  "correo.remitente_direccion": { etiqueta: "Dirección del remitente (verificada en Amazon SES)", tipo: "correo" },
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

export const MODOS_CORREO = { registrar: "Solo registrar (no envía; para pruebas)", enviar: "Enviar por Amazon SES" } as const;
