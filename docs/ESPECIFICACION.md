# Especificación funcional — Portal de Raciones Kuntur Wasi

**Fase 0 · Actualizada con las respuestas P1–P6 y P8 · 05/10/2026**

Este documento describe lo que hará la nueva web app, módulo por módulo. Sale del prompt del proyecto, de las 14 capturas de pantalla, de los 7 CSV maestros, del Excel `DATA SOLICITUD v3.xlsx` (320.163 registros) y del Word con 4 modelos de correo.

Las marcas significan:

- **[CONFIRMADO]**: lo dijiste tú o se ve claramente en las capturas o los datos.
- **[PROPUESTA]**: decisión mía razonable, que puedes cambiar.
- **[PREGUNTA Pn]**: necesito tu respuesta; está en `PREGUNTAS_FASE0.md`.

---

## 1. Lo que encontré en los datos (resumen)

| Hallazgo | Detalle | Consecuencia para el diseño |
|---|---|---|
| La app actual guarda las raciones como **movimientos**, no como saldos | El Excel tiene una fila por día, comedor y servicio, con `TIPO REGISTRO` = Programación (235.632), Adicionales (40.598), Reducciones (15.344, en negativo) y Traslados (28.589, en pares −/+) | Confirma el modelo de "movimientos + saldo" del prompt. La migración es directa |
| Las raciones vigentes de un día = **suma de todas sus filas** | Ejemplo del correo de traslado: CENA −20 y ALMUERZO CENA +20 el mismo día | La consulta y el dashboard suman movimientos |
| Hay **6.319 programaciones en negativo** | Son reducciones de lo ya registrado [CONFIRMADO P6] | Se migran como reducciones |
| El usuario de la app actual **es el RUC de la empresa** | En "Usuarios Admin" cada fila es un RUC con rol y contraseña; en el Excel, `Usuario` = RUC | Hoy hay una cuenta por empresa; en la app nueva, una por persona [CONFIRMADO P1] |
| Unas **25.800 filas las registró otra cuenta** en nombre de la empresa | 3 cuentas internas de Kuntur Wasi aparecen operando por muchas empresas | Admin/Superadmin necesitan registrar en nombre de una empresa (ya está en el prompt) |
| Muchos registros se hicieron **después del plazo** | 41.857 filas se crearon en un día posterior a la fecha del servicio; solo ~3.300 desde cuentas internas, el resto con la cuenta de la propia empresa | En la app nueva solo el Superadmin puede saltarlas, con motivo [CONFIRMADO P5] |
| La programación semanal se concentra el **miércoles** | ~108.000 filas de "semana siguiente" se crearon un miércoles y ~19.000 un jueves | El cierre es el miércoles a las 23:59 [CONFIRMADO P3] |
| Los traslados **sí cruzaron sectores** | De ~9.800 traslados emparejados, ~3.400 fueron entre PARTE ALTA y PARTE BAJA | La regla es reciente; desde ahora se aplica y es configurable [CONFIRMADO P8] |
| Los traslados de servicio siguen el **"tipo de servicio"** | Casi todos van de un servicio a otro del mismo `TIPO SERVICIO` (DESAYUNO / ALMUERZO / CENA) | Regla propuesta: destino con el mismo tipo **[PROPUESTA]** |
| Los servicios tienen **precio por periodo** | `MAESTRO DE SERVICIOS`: 10 servicios × 15 periodos con `DESDE`/`HASTA` | Tabla de tarifas con vigencia; el sistema calcula el costo según la fecha |
| **No hay tabla de qué servicios ofrece cada comedor** | Se puede deducir del historial (por ejemplo, 1400 solo atendió ALMUERZO) | Propongo cargar una tabla inicial con el historial, para que la revises **[PREGUNTA P9]** |
| El maestro de frentes **no tiene RUC** | `MAESTRO DE PROYECTO - CLIENTE` = Proyecto + Área + Proyecto menor + Sponsor + contrato, sin empresa | Pero 205 de 220 frentes los usa una sola empresa **[PREGUNTA P10]** |
| Faltan datos en `Datos\` | No están: usuarios y roles, productos y precios de refrigerios, composición del estándar, historial de refrigerios | Se crean datos de ejemplo; el Superadmin los gestiona desde su panel [CONFIRMADO P2] |
| Hay módulos en la app actual que **no están en el prompt** | Menú: Registro de puntos K, Registro de kitchenette, Entrega pedidos de kitchenette, Gestión de pagos; en Raciones: **Solicitudes express** | No se implementan [CONFIRMADO P4] |
| Power Apps graba **fila por fila** | ~1 segundo por fila; envíos de hasta 505 filas que tardaron hasta 40 minutos | En la app nueva un envío es una sola transacción (< 2 s) |

---

## 2. Usuarios, roles y permisos

### 2.1 Roles iniciales [CONFIRMADO]

| Rol | Menús por defecto | Alcance de datos |
|---|---|---|
| Superadmin | Todos + administración (tablas maestras, configuración, auditoría, correos, importador, métricas) | Todas las empresas |
| Admin | Gestiona tus raciones, Refrigerios, Menú semanal, Manual y T&C, Contáctanos; sube PDFs del menú | Todas las empresas (con selector de empresa) |
| Contratista | Gestiona tus raciones, Refrigerios, Menú semanal, Manual y T&C, Contáctanos | Solo su empresa, sin selector |
| Comedor | Gestiona tus raciones, Menú semanal, Refrigerios | **[PREGUNTA P7]** |
| Supervisor | Gestiona tus raciones, Menú semanal, Refrigerios | **[PREGUNTA P7]** |

### 2.2 Permisos configurables [CONFIRMADO]

- El Superadmin crea, edita y desactiva roles.
- Cada rol tiene permisos por **menú → pestaña → acción** (ver, crear, enviar, exportar, aprobar).
- Cada rol tiene un **alcance**: "su empresa", "todas" o "su comedor".
- Permiso especial **"Saltar reglas de horario"**: exclusivo del Superadmin, no se puede asignar a otros roles. Exige escribir un motivo y queda en la auditoría. [CONFIRMADO P5]

### 2.3 Cuentas [CONFIRMADO P1]

- Login con **correo + contraseña** de cada persona, no con RUC compartido.
- Un usuario pertenece a una empresa (Contratista) o a ninguna (roles internos).
- Una empresa puede tener uno o varios usuarios.
- Datos iniciales: **un usuario de ejemplo por rol** (Superadmin, Admin, Contratista, Comedor, Supervisor). Los usuarios reales los crea el Superadmin desde su panel. [CONFIRMADO P2]
- MFA obligatorio para Superadmin y Admin.

---

## 3. Pantallas y módulos

Estilo: barra superior naranja con el logo KW, título del módulo y, a la derecha, empresa + usuario y botón "Inicio". Paneles grises (`#E8E9E4`), encabezados de grilla oscuros (`#5C5E4E` / `#76776A`), botones redondeados naranjas (`#F58634`). Íconos en los botones: escoba = limpiar, tacho = borrar fila, (+) = agregar a la grilla, avión de papel = enviar.

### 3.1 Login [CONFIRMADO, captura]

- Fondo naranja con el logo KW CATERING y una foto a la derecha.
- Campos Usuario y Contraseña (con ojo para mostrar), enlace "¿Olvidó su contraseña?", botón **Iniciar** (`#5C5E4E`).
- Versión de la app abajo a la izquierda.
- Botón **Registrarse** visible en la pantalla de inicio.
- Después del login: popup de alerta si hay una activa (3.12).

### 3.2 Registro de nuevo cliente [CONFIRMADO, captura + prompt]

Pantalla "Registro nuevo cliente", con dos pasos:

1. **Datos de la empresa y sus proyectos** (captura): RUC, Razón social, Dirección. A la izquierda, "Data Proyectos": Área\*, Sponsor\*, Proyecto\*, Frente de trabajo\*, Contrato desde\*, Contrato hasta\*. Botones limpiar, borrar, agregar y siguiente. La grilla muestra Proyecto, Área, Frente Trabajo, Sponsor, Inicio y Fin de contrato.
2. **Contactos**: nombre, teléfono y correo del responsable de **Gestión de raciones**, de **Facturación** y de **Cobranzas**. Además, el correo y la contraseña del usuario que se registra **[PROPUESTA]**.

Validaciones:

- RUC de 11 dígitos con dígito verificador.
- "Contrato hasta" mayor o igual que "Contrato desde".
- Al menos un frente.

La solicitud queda **Pendiente**. Admin o Superadmin la aprueban (crean o asocian la empresa, los frentes, los contactos y el usuario) o la rechazan con un motivo. Se envía un correo en ambos casos.

**[PREGUNTA P11]** ¿Quién aprueba? ¿Una empresa ya registrada puede pedir frentes nuevos por esta misma vía?

### 3.3 Menú principal [CONFIRMADO, captura]

Íconos circulares grises con etiqueta. Se muestran solo los permitidos para el rol: Tablas maestras, Gestiona tus raciones, Registro de refrigerios, Menú semanal, **Manual, términos y condiciones** (hoy es un solo botón), Contáctanos.

Módulos de la app actual que **no se implementan**: Registro de puntos K, Registro de kitchenette, Entrega pedidos de kitchenette, Gestión de pagos. [CONFIRMADO P4]

### 3.4 Tablas maestras / Data maestra (Superadmin) [CONFIRMADO, captura]

Hoy tiene pestañas en tres grupos (Info Clientes, Maestros, Solicitudes). En Info Clientes hay sub-pestañas: Clientes, Frente Trabajo, Contactos, Usuarios Contratistas, Usuarios Admin. A la derecha, un panel de Filtros/Acciones con el formulario de la fila seleccionada (Crear usuario, Reset pass, borrar, guardar, cancelar).

En la app nueva se mantiene ese esquema (grilla a la izquierda, formulario a la derecha) para:

- **Clientes**: empresas, sus contactos y sus correos de notificación.
- **Frentes de trabajo**: proyecto, área, frente, sponsor, vigencia de contrato.
- **Usuarios**: estado, rol, empresa, último acceso; acciones "Crear usuario", "Enviar enlace para restablecer contraseña" y "Contraseña temporal". **Nunca se muestra la contraseña**, ni enmascarada.
- **Maestros**: proyectos, áreas, comedores (sector y habilitaciones), servicios y tarifas con vigencia, comedor-servicio, compatibilidad de traslados, productos de refrigerio, composición del estándar, horarios de entrega.
- **Solicitudes**: bandeja de registros pendientes (3.2).

Funciones comunes: búsqueda, filtros, orden, paginación en el servidor, exportar a Excel, desactivar en lugar de borrar.

### 3.5 Gestiona tus raciones [CONFIRMADO, capturas]

En la barra superior está el selector **"Seleccionar empresa"**, solo para roles con alcance "todas". A la derecha hay tres botones grandes: Programa tus raciones, Adiciona / Reduce tus raciones, Traslada tus raciones. "Solicitudes express" no se implementa [CONFIRMADO P4].

**a) Dashboard**

- Selector de **Fecha** (por defecto hoy).
- Gráfico de **barras por servicio** con las raciones vigentes de ese día.
- Al hacer clic en una barra: tabla **Comedor | Cant.** de ese servicio.
- La captura muestra que hoy las etiquetas del eje X salen mal (cantidades en lugar de nombres de servicio). Se corrige mostrando el nombre del servicio.
- **[PROPUESTA]** Agregar el total del día y del mes, y el costo estimado según la tarifa vigente. **[PREGUNTA P12]**

**b) Consulta detallada**

- Filtros: Fecha (hoy es una sola fecha; se cambia a **rango desde-hasta** [CONFIRMADO, prompt]), Proyecto, Área, Frente de trabajo, Comedor, Servicio. Botones Buscar y Limpiar, y un botón para plegar los filtros.
- Grilla: Fecha | Proyecto | Área | Frente Trabajo | Comedor | Servicio | Cant. (cantidad **vigente**: suma de movimientos).
- **[PROPUESTA]** Opción para ver el detalle de movimientos (programado, +adicional, −reducción, ±traslado) y exportar a Excel.

**c) Programa tus raciones** (pantalla "Programación de raciones")

- Formulario: Proyecto\*, Área\*, Frente de trabajo, Cant\*, Fecha desde\*, Fecha hasta\*, Comedor\*, Servicio\*.
- Los desplegables están encadenados: Proyecto → Área → Frente; Comedor → solo los servicios que ofrece ese comedor.
- **Agregar (+)**: crea una fila por cada día del rango en la grilla **"Previsualización de raciones por registrar"**. En esa grilla se puede editar la cantidad y borrar filas.
- Grilla **"Raciones registradas"**: lo ya enviado por la empresa en el rango visible.
- Fechas permitidas: desde la primera semana abierta hasta **6 semanas** desde hoy (sección 4).
- Si la fila repite una combinación ya programada, se avisa ("ya tienes 5 programadas ese día; esto suma 5 más") **[PROPUESTA]** **[PREGUNTA P13]**.
- **Enviar**: popup de confirmación con N filas y total de raciones → transacción → correo "Detalle de Programación de Raciones".
- El borrador se guarda en el servidor por usuario y empresa.
- **[PREGUNTA P14]** La "proyección mensual" que mencionas no aparece en la captura. ¿Qué cálculo es?

**d) Adiciona / Reduce tus raciones** (pantalla "Adición/Reducción de raciones")

- Formulario: Proyecto\*, Área\*, Frente\*, Cantidad\*, interruptor **Adiciones / Reducciones**, Fecha\*, Comedor\*, Servicio\*.
- La grilla "Raciones registradas" muestra lo vigente para la combinación elegida.
- La previsualización mezcla adiciones (+) y reducciones (−). Una reducción nunca puede dejar el saldo por debajo de 0; se valida al agregar y otra vez al enviar, con bloqueo.
- Una reducción se registra con cantidad negativa sobre lo ya programado, como hoy [CONFIRMADO P6].
- Plazos: adición hasta las 17:00 del día anterior; reducción hasta D−2 a las 23:59.
- **Enviar**: confirmación → transacción → correo "Detalle de Adición/Reducción de Raciones" (una sola tabla con + y −, como en el modelo).

**e) Traslada tus raciones** (pantalla "Traslados de Raciones")

- **Fecha** → se eligen las raciones actuales en la grilla "Raciones registradas" → panel "Raciones actuales en el sistema" (comedor, servicio y cantidad, solo lectura).
- Panel "Raciones a trasladar": Comedor destino\*, Servicio destino\*, Cantidad\* (menor o igual a lo disponible).
- Destinos permitidos: servicios del mismo **tipo** **[PROPUESTA]** que el comedor destino ofrezca, y comedores **del mismo sector** [CONFIRMADO P8]. Las dos reglas son matrices configurables por el Superadmin.
- La previsualización muestra el par: origen (−N) y destino (+N).
- **Enviar** → transacción → correo "Detalle de Traslado de Raciones" (tabla con las filas − y +).
- La captura muestra "Cantidad −4" en el panel de raciones actuales: es un error de signo de la app actual. Se mostrará el saldo positivo.

**f) Solicitudes express**: no se implementa [CONFIRMADO P4].

### 3.6 Solicitud de refrigerios [CONFIRMADO, capturas]

- Formulario: Fecha desde/hasta\*, **Hora de entrega**\* (desplegable de turnos; en las capturas: 9:30 am, 11:30 am, 6:00 pm), interruptor **Estándar / Especial**, **Encargado de recojo**\* (nombre y apellidos), Comedor\* (solo comedores habilitados para refrigerios), Cant refrigerios\*.
- **Estándar**: composición fija desde tabla. En el correo modelo son 2 sándwich cárnico, 1 gaseosa, 2 fruta, 1 frutos secos, 1 chocolate, 1 sachet de ají, 1 sachet de mayonesa, 3 servilletas y 1 bolsa de papel, a **S/ 29,78 sin IGV** por unidad.
- Datos iniciales: los productos del estándar (los del correo modelo) con precios **de ejemplo**. El Superadmin crea, edita y desactiva productos y precios desde su panel [CONFIRMADO P2].
- **Especial**: Producto\* + Cant prod\*, botón (+). Los productos se acumulan en la grilla inferior **Producto | Precio sin IGV | Cantidad**.
- Grillas: (1) refrigerios registrados, (2) previsualización con columnas Fecha | Comedor | Turno Entrega | Composición | Cant | Precio sin IGV | Tipo | Encargado, (3) productos especiales.
- La previsualización es editable: cantidad por fila y composición (agregar o quitar productos). El precio se recalcula al instante.
- Se guarda el precio vigente al enviar.
- Plazos: registro para el día D hasta las 17:00 de D−1; reducción con 48 h. Turnos entre 06:00 y 21:30, configurables.
- **Enviar** → transacción → correo "Detalle de Solicitud de Refrigerios".
- **[PREGUNTA P15]**: cálculo de "estándar + especiales", modificación o reducción de pedidos enviados, y si existe historial de refrigerios para migrar.

### 3.7 Menú semanal [CONFIRMADO, prompt]

- Dos PDF visibles en un visor y descargables.
- Admin y Superadmin los reemplazan: solo PDF, menos de 1 MB, se guardan versiones anteriores.
- No hay captura **[PREGUNTA P16]**.

### 3.8 Manual, términos y condiciones [CONFIRMADO, captura del menú]

- Un botón del menú con dos documentos: Manual y Términos y condiciones (PDF, solo descarga).
- El Superadmin los sube y se guardan versiones.
- **[PROPUESTA]** Al registrarse, el usuario acepta los T&C vigentes y se guarda la versión aceptada. Los correos ya dicen "sujeta a los términos y condiciones aceptados… en el momento del registro".

### 3.9 Contáctanos [CONFIRMADO, captura]

- Editor de texto enriquecido a la izquierda: formato, negrita, cursiva, subrayado, enlace, listas.
- A la derecha: **Copia a**, **Asunto\***, **Adjuntar archivo** y botón **Enviar correo**.
- Destinatario fijo configurable, con copia al remitente.
- El texto HTML se limpia en el servidor antes de enviarlo.
- **[PREGUNTA P17]** El destinatario del prompt (`adm.kw@kunturwasicatering.com`) es distinto del que aparece en los correos (`adm.ktw@kunturwasi-catering.com`).

### 3.10 Configuración (Superadmin) [CONFIRMADO]

- Zona horaria, plazos por módulo, turnos de refrigerio, remitente, CCO y destinatario de Contáctanos, límites de archivos.
- Plantillas de correo editables.
- Todo cambio queda en la auditoría.

### 3.11 Auditoría, historial de correos y métricas (Superadmin) [CONFIRMADO]

Según el prompt (secciones 8 y 9.13).

### 3.12 Alerta post-login (Superadmin) [CONFIRMADO]

Texto configurable, vigencia, roles destinatarios, mostrar una vez o siempre.

### 3.13 Importador de Excel (Superadmin) [CONFIRMADO]

Ver `MAPEO_MIGRACION.md`.

---

## 4. Reglas de horario (valores por defecto, todos configurables)

Hora oficial: la de la base de datos, en **America/Lima**.

| Regla | Valor por defecto | Estado |
|---|---|---|
| Ventana máxima de programación | Hasta el domingo de la 6.ª semana desde hoy | [PROPUESTA aceptada] |
| Cierre semanal de programación | La semana siguiente (lunes a domingo) se puede programar hasta el **miércoles a las 23:59** | [CONFIRMADO P3] |
| Programar la semana en curso | No permitido; se usa Adiciona/Reduce | [PROPUESTA] |
| Adición para el día D | Hasta D−1 a las 17:00 | [CONFIRMADO] |
| Reducción para el día D | Hasta D−2 a las 23:59 (48 h antes del inicio del día D) | [PROPUESTA aceptada] |
| Traslado para el día D | Igual que la reducción (el origen se reduce) | [PROPUESTA aceptada] |
| Refrigerio para el día D | Hasta D−1 a las 17:00; después de esa hora, ni el mismo día ni el siguiente | [CONFIRMADO] |
| Reducción de refrigerio | 48 h antes | [CONFIRMADO] |
| Turnos de entrega de refrigerio | Lista configurable entre 06:00 y 21:30 | [CONFIRMADO] |
| Feriados | Sin tratamiento especial | **[PREGUNTA P18]** |

Las reglas se validan en la interfaz (fechas deshabilitadas, con el motivo), en el servidor y en la base de datos. Solo el Superadmin puede saltarlas, indicando un motivo que queda en la auditoría.

---

## 5. Correos (4 modelos del Word + los nuevos)

Estructura común de los modelos:

- **Asunto**: `Detalle de <tipo> - <RUC>`
- **Remitente** mostrado: "Administración de Facturación"
- **Destinatarios**: correos de la empresa separados por `;`
- **Cuerpo**: "Estimada empresa \<RAZÓN SOCIAL\>. Se ha registrado la siguiente solicitud", seguido de la tabla y del texto fijo ("Si usted no reconoce esta solicitud…", "…es informativo y no requiere de respuesta…", contacto, "Saludos Cordiales, Equipo de Facturación", nota de términos y condiciones).

| Plantilla | Columnas de la tabla |
|---|---|
| Programación de Raciones | Fecha, Proyecto, Área, Frente Trabajo, Comedor, Servicio, Cantidad |
| Adición/Reducción de Raciones | Las mismas; cantidad con signo |
| Traslado de Raciones | Las mismas; filas − (origen) y + (destino) |
| Solicitud de Refrigerios | Fecha, Comedor, Turno Entrega, Composición, Cant., Precio sin IGV, Tipo, Encargado |

Plantillas nuevas, sin modelo en el Word: registro recibido, registro aprobado, registro rechazado, invitación de usuario, restablecer contraseña, Contáctanos.

El modelo de Adición/Reducción incluye el texto resaltado "[de acuerdo con lo previamente acordado]" **[PREGUNTA P19]**.

---

## 6. Fuera de alcance

- Puntos K, Kitchenette, Entrega de pedidos de kitchenette, Gestión de pagos, Solicitudes express [CONFIRMADO P4].
- Facturación o valorización mensual (los datos de tarifas existen; ¿se necesita un reporte? P12).
