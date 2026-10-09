# Avance del proyecto

| Fase | Estado | Fecha | Notas |
|---|---|---|---|
| 0. Análisis | **Completa** | 05/10/2026 | P1–P6 y P8 respondidas; las demás preguntas se resuelven en la fase de cada módulo |
| 1. Base | **Entregada, compila y pasa todas las pruebas en GitHub** | 06/10/2026 | Pendiente: tu prueba en el navegador |
| 2. Maestras y registro | Pendiente | | |
| 3. Correos | Pendiente | | |
| 4. Gestiona tus raciones | Pendiente | | |
| 5. Refrigerios | Pendiente | | |
| 6. Contenido y contacto | Pendiente | | |
| 7. Importador, métricas y rendimiento | Pendiente | | |
| 8. Despliegue | Pendiente | | |

## Fase 0: qué se revisó

- 7 CSV maestros y el Excel de solicitudes (320.163 filas, ene-2025 a dic-2026).
- 14 capturas de pantalla: registro, login, menú, Data maestra, dashboard, consulta, programación, adición/reducción, traslado, refrigerios (3) y Contáctanos.
- Word con 4 modelos de correo.
- No se escribió código de la app.

## Nota de seguridad

En el mensaje inicial del proyecto se compartió en texto plano la contraseña de la cuenta Microsoft que usan los contratistas. **Debe cambiarse.** Esa contraseña no se guardó en ningún archivo del proyecto.

## Fase 1: qué se entregó

- **Base de datos** (`supabase/migrations`, 6 migraciones):
  - Organización y catálogos.
  - Roles, menús y permisos configurables.
  - Perfiles de usuario.
  - Auditoría automática de cambios.
  - Configuración y horarios.
  - Hora oficial del servidor.
  - RLS en todas las tablas.
- **Pruebas de seguridad de la base:** 56 pruebas pgTAP, todas aprobadas en PostgreSQL. Cubren aislamiento entre empresas, MFA, escalamiento de privilegios y auditoría.
- **App:**
  - Inicio, login, recuperación y cambio de contraseña, verificación en dos pasos.
  - Menú principal dinámico según permisos.
  - Pantalla de roles y permisos (Superadmin).
  - Páginas "en construcción" para los módulos de fases siguientes.
- **Seguridad de la app:**
  - CSP con nonce y cabeceras HTTP seguras.
  - Límite de intentos de login.
  - Redirecciones seguras.
  - Verificación de permiso en cada página y en cada acción.
- **Calidad:**
  - Pruebas unitarias (Vitest).
  - CI en GitHub (lint, tipos, pruebas, build, auditoría de dependencias, pruebas de la base).
  - Dependabot.
- **Revisión de seguridad independiente:** se corrigieron todos los hallazgos de prioridad alta y media.

## Pendientes conocidos

- 06/10/2026: primera ejecución en GitHub Actions en verde (lint, tipos, pruebas unitarias, build, auditoría de dependencias y 56 pruebas de seguridad en Supabase real).
- Proyecto Supabase de pruebas: `kw-raciones-pruebas` (us-east-1), con migraciones, datos de ejemplo y un usuario por rol.
- La IP registrada en la auditoría es la del servidor de la app; la IP real del usuario se agregará en la Fase 3.
- Después de verificar el segundo factor, la app vuelve al menú en lugar de a la página que se pidió originalmente. Es una mejora menor.

## Fase 2: qué se entregó (06/10/2026)

- **Tablas maestras** (`/maestras`), con pestañas según los permisos de cada rol:
  - **Clientes y contactos:** búsqueda, paginación, alta y edición de empresas (RUC con dígito verificador), contactos por tipo (gestión de raciones, facturación, cobranzas) y lista de frentes asignados.
  - **Frentes de trabajo:** alta y edición, filtro por proyecto, asignación de empresas con fechas de contrato.
  - **Catálogos:** proyectos, áreas, sectores, comedores, servicios y tarifas (sin fechas que se crucen), más las matrices **servicios por comedor** y **traslados entre sectores**.
  - **Usuarios:** alta con contraseña temporal que se muestra una sola vez, edición de rol / empresa / comedor, activar y desactivar (bloquea también el acceso en Supabase Auth) y restablecer contraseña.
  - **Solicitudes de registro:** bandeja para aprobar (crea empresa, contactos, frentes y la cuenta del contratista) o rechazar con motivo. Si el RUC ya existe, se pide confirmar que el solicitante pertenece a esa empresa.
  - Nada se borra: los registros se desactivan.
  - Exportación a Excel (CSV) con el permiso "exportar", protegida contra fórmulas maliciosas.
- **Registro público de nuevos clientes** (`/registro`): dos pasos (empresa y frentes; contactos y usuario), aceptación de términos, campo trampa contra robots y límite de envíos.
- **Configuración y horarios** (`/admin/configuracion`): plazos por módulo (con validación en la base de datos), zona horaria oficial y datos generales.
- **Base de datos:** migración `solicitudes` y 21 pruebas nuevas (77 en total, todas aprobadas).
- **Revisión de seguridad independiente:** se corrigieron todos los hallazgos.
- **Correos** de aprobación y rechazo: se activan en la Fase 3 (Amazon SES). Mientras tanto, la contraseña temporal se entrega por un canal seguro.

## Fase 3: qué se entregó (06/10/2026)

- **Cola de correos (outbox):** cada acción que notifica deja el correo en la base de datos dentro de la misma operación. Si la operación falla, no queda ningún correo a medias.
- **Envío automático:** Supabase Cron revisa la cola cada minuto y llama a la Edge Function `enviar-correos`, que arma el correo y lo envía por Amazon SES. Reintenta con espera creciente; tras 6 intentos lo marca como fallido.
  - Un envío por destinatario, para saber el estado de cada uno.
  - Copia oculta interna opcional (Configuración).
  - Contactos de la empresa marcados para recibir notificaciones (máximo 5).
- **Modo "solo registrar"** (activo ahora): los correos se arman y se guardan, pero no salen. Se cambia a "Enviar por Amazon SES" en Configuración cuando SES esté listo.
- **Plantillas** basadas en el Word (programación, adición/reducción, traslado, refrigerios) y nuevas (registro recibido, aprobado y rechazado, cuenta creada, Contáctanos). El Superadmin las edita con vista previa.
- **Correos ya conectados:** registro recibido, registro aprobado, registro rechazado (con el motivo) y cuenta creada. Los de raciones y refrigerios se conectan en las Fases 4 y 5.
- **Historial de correos** (Administración): búsqueda por empresa, RUC, asunto, destinatario, tipo, estado y fechas; contenido tal como se envió; estado por destinatario; botón "Reenviar".
- **Eventos de SES** (entregado, rebote, queja) por SNS con verificación de firma. Las direcciones que rebotan o marcan spam quedan bloqueadas y se listan en "Direcciones bloqueadas".
- Probado en el proyecto de pruebas: un correo encolado se procesó en menos de un minuto.
- 22 pruebas nuevas de base de datos (99 en total) y pruebas unitarias de plantillas y firma SNS.

## Fase 4: qué se entregó (07/10/2026)

- **Modelo de raciones:** cada "Enviar" crea un envío con sus movimientos (programación, adición, reducción, traslado), que no se editan ni se borran. Los saldos por día se actualizan en la misma operación y nunca quedan por debajo de 0. Un doble clic no duplica el envío.
- **Reglas de horario** en una sola función (TypeScript) con su espejo exacto en la base de datos, probadas en los bordes (16:59:59, 17:00:00, cambio de semana, fin de mes y de año):
  - programación de la semana siguiente hasta el miércoles 23:59, máximo 6 semanas, la semana en curso no;
  - adiciones hasta las 17:00 del día anterior;
  - reducciones y traslados hasta 48 horas antes del inicio del día.
  - Solo el Superadmin puede registrar fuera de plazo, con un motivo que queda en la auditoría.
- **Dashboard:** raciones del día por servicio (al elegir uno, el detalle por comedor), total del día y del mes, gráfico de la semana. Admin y Superadmin ven además el costo estimado con la tarifa vigente.
- **Consulta detallada:** filtros por rango de fechas, proyecto, área, frente, comedor y servicio; vista de raciones vigentes o de movimientos; exportación a Excel.
- **Programa / Adiciona-Reduce / Traslada:** formularios con listas encadenadas (proyecto → área → frente; comedor → servicios que ofrece), grilla de previsualización editable que se guarda sola, grilla de raciones registradas, confirmación antes de enviar y correo con la tabla de registros.
  - Las reducciones nunca superan lo registrado.
  - Los traslados solo van a comedores del mismo sector y a servicios compatibles.
- **Selector de empresa** para Admin y Superadmin. El usuario de comedor solo ve su comedor.
- 35 pruebas nuevas de base de datos (136 en total) y pruebas unitarias de plazos y reglas. Revisión de seguridad independiente: hallazgos corregidos.

**Criterios por defecto pendientes de confirmar:** programar dos veces lo mismo suma (P13); el costo lo ven solo Admin y Superadmin (P12); la "proyección mensual" se muestra como total por mes (P14).

## Fase 5: qué se entregó (07/10/2026)

- **Catálogos de refrigerios** (Maestras → Catálogos): productos, precios con vigencia (sin solapes), turnos de entrega (9:30 am, 11:30 am, 6:00 pm por defecto), precio del estándar y composición del estándar.
- **Solicitud de refrigerios:** rango de fechas, turno, tipo (estándar, especial, estándar + especial), encargado de recojo, comedor (solo los habilitados), cantidad y productos especiales. Grilla de previsualización editable que se guarda sola, con precio unitario y total en vivo.
- **Precio y composición congelados al enviar:** el pedido guarda el precio vigente ese día aunque después cambie la tabla de precios.
- **Plazos:** hasta las 17:00 del día anterior; reducir o anular hasta 48 horas antes del inicio del día. Ambos configurables. Solo el Superadmin registra fuera de plazo, con motivo.
- **Pedidos registrados** con botón **Reducir** (reducir a 0 = anular). Cada envío y reducción deja auditoría y correo "Solicitud de refrigerios" con la tabla (fecha, comedor, turno, composición, cantidad, precio sin IGV, tipo, encargado).
- Los usuarios contratistas **sí ven el precio** (confirmado por el cliente).
- 25 pruebas nuevas de base de datos (161 en total) y pruebas unitarias de plazos y precios. Revisión independiente: hallazgos corregidos.

## Fase 6: qué se entregó (07/10/2026)

- **Menú semanal:** dos PDFs (Menú 1 y Menú 2) con visor dentro de la página y botón "Descargar PDF". Admin y Superadmin publican una versión nueva (solo PDF real, menos de 1 MB). Historial de versiones y opción de volver a publicar una anterior. Los demás usuarios solo ven la versión vigente.
- **Manual, términos y condiciones:** mismo esquema (descarga, versiones). Solo el Superadmin publica.
- **Alertas post-login** (Administración → Alertas): título, mensaje con formato básico (**negrita**, *cursiva*, listas, enlaces https), fechas de inicio y fin, roles destinatarios y "una sola vez" o "en cada inicio de sesión". Se muestran en una ventana al entrar.
- **Contáctanos:** Para fijo (configurable), hasta 5 direcciones en copia, asunto, mensaje y adjuntos (PDF, imágenes, Excel, Word; 10 MB en total). Se revisa el tipo real de cada archivo al subirlo y otra vez antes de enviarlo. Copia al remitente y "Responder" llega al usuario. Historial de mensajes enviados. Máximo 10 mensajes por hora por usuario.
- Archivos en buckets privados de Supabase Storage; descarga solo para quien tiene permiso. Los archivos subidos que no se usan se borran solos.
- 33 pruebas nuevas de base de datos (194 en total) y pruebas unitarias de tipos de archivo, correo MIME, fechas y texto con formato. Revisión independiente: hallazgos corregidos.

## Fase 7: qué se entregó (08/10/2026)

- **Auditoría** (Administración → Auditoría): todo lo que se crea, modifica o envía, los inicios de sesión y los cambios de configuración y permisos. Filtros por usuario, empresa, módulo, acción y fechas; detalle con los campos que cambiaron (antes y después); exportación a Excel (CSV). Solo la ven los roles de Kuntur Wasi con permiso.
- **Métricas de uso** (últimos 7, 30 o 90 días): usuarios activos por día y por semana, inicios de sesión, envíos por día y por módulo, empresas sin actividad (con su último envío), errores recientes del servidor y correos que no salieron. El tiempo de respuesta de las páginas se verá en Google Cloud cuando la app esté publicada (Fase 8).
- **Registro de errores:** los errores inesperados del servidor quedan en una tabla (sin datos personales) para las métricas.
- **Importador** (Administración → Importar Excel), solo Superadmin:
  - Acepta el Excel `DATA SOLICITUD` y los 7 CSV `MAESTRO DE …` con el formato actual (se puede subir solo una parte).
  - **Simulación** obligatoria: cuántos registros se crean o ya existen por tabla y la lista de errores y advertencias (fila, columna, motivo), descargable.
  - **Importación por partes** con barra de avance: maestros, historial en lotes de ~5000 filas y recálculo de saldos mes por mes. Si se corta, se continúa donde quedó.
  - **Idempotente:** cada fila guarda su origen; volver a importar el mismo archivo no duplica nada.
  - Reglas de docs/MAPEO_MIGRACION.md: frentes del historial que no están en el maestro se crean inactivos; envíos agrupados por cuenta, empresa y tipo (menos de 5 minutos entre filas); traslados emparejados; la migración no envía correos.
  - Con los archivos reales: 320 163 filas leídas en ~10 segundos, 26 929 envíos, 2 errores (dos tarifas de DESAYUNO que se cruzan) y 37 advertencias.
- 25 pruebas nuevas de base de datos (219 en total) y pruebas unitarias del lector de Excel/CSV y de la simulación. Revisión independiente: hallazgos corregidos.

## Mejora de rendimiento y diseño (08/10/2026)

- **Carga más rápida:** antes cada página hacía unas 5 consultas seguidas a la base de datos (sesión, perfil, menú, alertas). Ahora la sesión se verifica sin salir del servidor (firma del token) y perfil + menú + alertas llegan en **una sola consulta** (`mi_sesion`).
- Consultas de cada pantalla en paralelo (lista + detalle + catálogos a la vez) y resultados reutilizados dentro de la misma petición.
- 16 índices nuevos en llaves foráneas (búsquedas y borrados más rápidos).
- **Pantallas de carga** (esqueletos) al navegar: la respuesta se ve al instante.
- Menos trabajo en el navegador: tablas y totales no se recalculan si no cambian.
- Importador: descargas y firmas en paralelo; la lista solo trae lo que muestra.
- **Diseño** (mismos colores y funciones): encabezado fijo con botones de inicio y salida centrados; menú principal en cuadrícula de 2 a 6 columnas; botones e íconos del mismo tamaño y centrados; campos de 40 px de alto (cómodos en el celular); tablas con desplazamiento horizontal en pantallas pequeñas; formularios en una columna en celulares; gráfico semanal y pestañas adaptados al celular.

## Fase 8: publicación (preparada 08/10/2026)

- Contenedor Docker de producción (sin código fuente ni datos, usuario sin privilegios) y ruta de salud `/api/salud`.
- Flujo de GitHub Actions **Desplegar a Cloud Run**: se ejecuta solo cuando el CI de `main` pasa; se autentica con Workload Identity Federation.
- Script `scripts/gcp-configurar.sh` para Cloud Shell: servicios, almacén de imágenes, cuentas de servicio, clave de Supabase en Secret Manager y conexión con GitHub.
- Guía paso a paso en `docs/OPERACION.md` (Google Cloud, variables de GitHub, dominio en Cloudflare, Supabase, SES en producción, día a día).
- Pendiente de la usuaria: crear el proyecto de Google Cloud y seguir la guía.

## Prueba de rendimiento con volumen real (09/10/2026)

- Se cargó en una base local un volumen sintético igual al histórico (165 empresas, 27 000 envíos, 320 000 movimientos, 278 840 saldos) y se midieron las consultas principales con las reglas de seguridad activas (`supabase/rendimiento/`).
- Hallazgo: las políticas RLS de raciones y refrigerios evaluaban una función por fila. Tablero del contratista: más de 300 s; consulta detallada: 3,3 s; tablero del superadmin: 5,6 s.
- Corrección (migración `rendimiento_rls`): el perfil se calcula una vez por consulta. Resultado (mediana de 30 ejecuciones): tablero del contratista 50 ms, consulta detallada 8 ms, tablero del superadmin 16 ms (1 mes) y 39 ms (3 meses).
