# Registro de decisiones

| # | Fecha | Decisión | Motivo | Estado |
|---|---|---|---|---|
| D1 | 29/09/2026 | Stack: TypeScript, Next.js, Supabase (us-east-1), Cloud Run (us-east4), Amazon SES, Cloudflare, GitHub | Ver el documento "Arquitectura y costos" | Aprobada |
| D2 | 05/10/2026 | Las raciones se guardan como **movimientos inmutables + tabla de saldos** | La app actual ya funciona así (Programación, Adicionales, Reducciones, Traslados con signo); la migración es directa y queda la trazabilidad completa | Propuesta |
| D3 | 05/10/2026 | Cada clic en "Enviar" = un **envío** con clave de idempotencia y una sola transacción | Hoy Power Apps graba fila por fila (~1 s por fila; envíos de hasta 40 min); un doble clic no debe duplicar | Propuesta |
| D4 | 05/10/2026 | La regla de traslado de servicio = **mismo tipo de servicio** (DESAYUNO / ALMUERZO / CENA), con tabla de excepciones | Coincide con el ejemplo del prompt y con más del 99 % de los traslados históricos | Propuesta |
| D5 | 05/10/2026 | Tarifas de servicio y precios de refrigerio **con vigencia** (desde/hasta) | El maestro de servicios ya tiene 15 periodos de precio | Propuesta |
| D6 | 05/10/2026 | Nueva tabla `comedor_servicios`, cargada al inicio desde el historial | Hoy no existe y el prompt la exige | Propuesta, pendiente P9 |
| D7 | 05/10/2026 | Las contraseñas no se migran ni se muestran; cada usuario define la suya por correo | Hoy la contraseña se ve (enmascarada) en Data maestra; regla de seguridad 4.6 | Propuesta |
| D8 | 05/10/2026 | Frentes y catálogos que no existen en los maestros se crean al migrar como **inactivos** y con la marca "creado por migración" | 34 combinaciones (26.544 filas) del historial no están en el maestro de frentes | Propuesta |
| D9 | 05/10/2026 | Se corrigen dos errores visibles de la app actual: las etiquetas del eje X del dashboard y el signo negativo en "Raciones actuales" del traslado | Capturas | Propuesta |
| D10 | 05/10/2026 | Una cuenta por persona (login con correo); una empresa puede tener varios usuarios | Respuesta P1 | Aprobada |
| D11 | 05/10/2026 | Datos iniciales: un usuario de ejemplo por rol y productos de refrigerio de ejemplo; el Superadmin crea los reales desde su panel | Respuesta P2 | Aprobada |
| D12 | 05/10/2026 | La programación de la semana siguiente cierra el **miércoles a las 23:59** (configurable) | Respuesta P3 y patrón de los datos | Aprobada |
| D13 | 05/10/2026 | No se implementan Puntos K, Kitchenette, Entrega de kitchenette, Gestión de pagos ni Solicitudes express | Respuesta P4 | Aprobada |
| D14 | 05/10/2026 | Solo el Superadmin puede registrar fuera de plazo, con motivo obligatorio y auditoría | Respuesta P5 | Aprobada |
| D15 | 05/10/2026 | Las programaciones negativas del historial se migran como reducciones | Respuesta P6 | Aprobada |
| D16 | 05/10/2026 | Traslados solo dentro del mismo sector, con matriz de sectores configurable | Respuesta P8 | Aprobada |
| D17 | 05/10/2026 | Los nombres reales de comedores y servicios se usan en los datos de ejemplo; empresas, personas, frentes y tarifas de ejemplo son ficticios | Son catálogos operativos sin datos personales y hacen realistas las pruebas | Aplicada |
| D18 | 05/10/2026 | Las cuentas solo las crea el administrador (registro libre de Supabase desactivado); rol y empresa van en `app_metadata`, que solo escribe el servidor | Evita que alguien se registre o se asigne un rol | Aplicada |
| D19 | 05/10/2026 | La verificación en dos pasos se exige en la base de datos: un rol con MFA no ve datos si la sesión no es `aal2` | Defensa aunque falle una pantalla | Aplicada |
| D20 | 05/10/2026 | Un usuario solo administra usuarios de su alcance; nadie salvo el Superadmin asigna el rol Superadmin ni cambia su propio rol; los roles de alcance "empresa" no reciben menús de administración | Revisión de seguridad de la Fase 1 | Aplicada |
| D21 | 05/10/2026 | El fin del cambio obligatorio de contraseña lo marca un trigger de `auth.users`, no la app | Revisión de seguridad: evita saltarse el cambio | Aplicada |
| D22 | 05/10/2026 | Los enlaces de correo se confirman con un botón (POST) | Los antivirus de correo corporativos abren los enlaces y gastarían el código | Aplicada |
| D23 | 06/10/2026 | Las cuentas nuevas reciben una contraseña temporal que se muestra una sola vez; el envío por correo llega en la Fase 3 | Aún no hay servicio de correo propio | Aplicada |
| D24 | 06/10/2026 | Crear, bloquear y restablecer contraseñas de usuarios solo lo pueden hacer roles de alcance "todas" | Esas acciones usan la clave secreta de Supabase (saltan RLS) | Aplicada |
| D25 | 06/10/2026 | Aprobar una solicitud con un RUC ya registrado exige confirmar que el solicitante pertenece a esa empresa | Un RUC es público: sin esta confirmación, cualquiera podría pedir acceso a otra empresa | Aplicada |
| D26 | 06/10/2026 | Se envía un correo por destinatario (no uno con todos en "Para") | Estado exacto por destinatario, rebotes bien asignados y, en sandbox, una dirección no verificada no bloquea a las demás. El costo en SES es el mismo | Aplicada |
| D27 | 06/10/2026 | Los correos de bienvenida y aprobación no llevan contraseñas ni enlaces con token: indican cómo crear la contraseña con "¿Olvidaste tu contraseña?" | Nada secreto queda guardado en el historial de correos | Aplicada |
| D28 | 06/10/2026 | La Edge Function se protege con un secreto guardado solo en Supabase Vault | No hay claves en el código ni en la configuración de la función | Aplicada |
| D29 | 07/10/2026 | Los envíos de raciones de una misma empresa se procesan de a uno (bloqueo por empresa) | Evita bloqueos cruzados entre traslados simultáneos; el volumen es bajo | Aplicada |
| D30 | 07/10/2026 | La clave de idempotencia guarda una huella del contenido: repetir lo mismo devuelve el envío original; otro contenido con la misma clave se rechaza | Un reintento no duplica ni pierde filas | Aplicada |
| D31 | 07/10/2026 | Reducción y traslado: el plazo es N horas antes del inicio del día (48 h → hasta D−2 a las 23:59) | Regla configurable "horas de anticipación" | Aplicada |
| D32 | 07/10/2026 | Refrigerios: el precio lo ven también los contratistas (pantalla y correo) | Confirmado por el cliente; igual que el correo actual | Aplicada |
| D33 | 07/10/2026 | Refrigerios: el precio y la composición se congelan con los valores vigentes el día del envío | Histórico de precios estable | Aplicada |
| D34 | 07/10/2026 | Cada módulo ve solo sus envíos (raciones o refrigerios) según su permiso | Mínimo privilegio | Aplicada |
| D35 | 07/10/2026 | Documentos (menú, términos, manual) con historial: cada publicación es un archivo nuevo; los usuarios solo acceden a la versión vigente | Se puede volver a una versión anterior sin exponer las antiguas | Aplicada |
| D36 | 07/10/2026 | Contáctanos: las copias (CC) pueden ser cualquier correo válido, con tope de 5 por mensaje y 10 mensajes por hora | Así lo pide el formulario original; el tope limita el abuso | Aplicada (revisable) |
| D37 | 07/10/2026 | Un correo con adjuntos se envía una sola vez a todos los destinatarios | Evita armar varias veces un mensaje pesado | Aplicada |
| D38 | 08/10/2026 | El importador lee el Excel sin librerías externas (lector propio por partes) | Archivos de 24 MB / 218 MB sin cargar todo en memoria; sin dependencias nuevas | Aplicada |
| D39 | 08/10/2026 | Al reimportar maestros, en comedores que ya existen solo se completa el sector: no se pisan las habilitaciones hechas en la app | Evita deshabilitar comedores por un archivo viejo | Aplicada |
| D40 | 08/10/2026 | Las tarifas del archivo reemplazan a las que se cruzan con ellas (se avisa en la simulación) | El maestro de servicios es la fuente de los precios históricos | Aplicada (revisable) |
| D41 | 08/10/2026 | Los envíos históricos quedan a nombre del Superadmin que importa, con la cuenta original en "usuario_origen" | Los usuarios nuevos son por persona; las cuentas antiguas eran por empresa | Aplicada |
| D42 | 08/10/2026 | Empresa-frente y comedor-servicio se deducen del historial (comedor-servicio solo si se usó más de 2 veces) | Preguntas P9 y P10; se pueden ajustar en Tablas maestras | Aplicada (revisable) |
