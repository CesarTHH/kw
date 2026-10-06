# Preguntas de la Fase 0

**05/10/2026.** Responde debajo de cada una (aunque sea con "OK a la propuesta"). P1 a P6 ya están respondidas. El resto puede esperar a la fase del módulo correspondiente.

## Bloquean el diseño

**P1. Cuentas por persona o por empresa.** Hoy cada empresa entra con su RUC y una contraseña compartida. Propongo que cada persona tenga su propio usuario (su correo) y que una empresa pueda tener varios. ¿De acuerdo? ¿El login será con correo (propuesta) o se mantiene el RUC como usuario?
> Respuesta (05/10): "También sería una opción". **Decisión:** cada persona con su usuario (correo); una empresa puede tener uno o varios usuarios.

**P2. Faltan archivos.** Necesito, si existen:
1. la lista de usuarios con rol y estado, **sin contraseñas**;
2. los productos de refrigerio con su precio sin IGV;
3. la composición del refrigerio estándar ("segunda captura");
4. los turnos de entrega de refrigerio;
5. capturas de: primera página del registro, Menú semanal, Manual/T&C, Solicitudes express y las otras pestañas de Data maestra.
> Respuesta (05/10): por ahora no hacen falta los usuarios reales. **Decisión:** se crea un usuario de ejemplo por cada rol; el Superadmin crea usuarios y productos de refrigerio desde su panel. Se cargan productos de ejemplo con la composición del estándar del correo modelo.

**P3. Plazos exactos.**
- a) El cierre de la semana siguiente: en los datos, la mayoría programa **durante el miércoles** (y algunos el jueves). ¿El cierre es el **jueves 00:00** (fin del miércoles) o el miércoles 00:00 (inicio)?
- b) "6 semanas desde hoy": ¿hasta el domingo de la 6.ª semana?
- c) Reducción con 48 h: ¿48 h antes del inicio del día (ejemplo: para el viernes, hasta el miércoles 23:59)?
- d) ¿Qué plazo tienen los traslados? Propongo el mismo de la reducción.
- e) ¿Se puede programar la semana en curso, o solo usar adicionales?
> Respuesta (05/10): **cierre semanal el miércoles a las 23:59** (la semana siguiente se bloquea el jueves 00:00). Configurable. b) a e) quedan con la propuesta: domingo de la 6.ª semana; reducción y traslado hasta D−2 23:59; la semana en curso solo con adicionales.

**P4. Módulos que existen hoy y no están en el prompt:** Registro de puntos K, Registro de kitchenette, Entrega pedidos de kitchenette, Gestión de pagos y **Solicitudes express** (dentro de Gestiona tus raciones). ¿Quedan fuera de esta migración? ¿Qué hace "Solicitudes express"?
> Respuesta (05/10): **no se implementan** Puntos K, Kitchenette, Entrega de kitchenette, Gestión de pagos ni Solicitudes express. Solo los módulos detallados.

**P5. Excepciones de horario.** En el historial hay 41.857 filas registradas en un día posterior a la fecha del servicio. Solo ~3.300 vienen de cuentas internas de KW; el resto se hizo con la cuenta de la propia empresa. ¿Las registraba el equipo de KW entrando como la empresa, o la app actual no bloquea fechas pasadas? Propongo un permiso "Saltar reglas de horario" (solo Superadmin por defecto) que exija escribir un motivo y quede auditado. ¿Qué roles deben tenerlo?
> Respuesta (05/10): **solo el Superadmin** puede saltar las reglas de horario (con motivo y auditoría).

**P6. Programaciones negativas.** Hay 6.319 filas de "Programación" con cantidad negativa. ¿Son correcciones hechas por el equipo de KW? En la app nueva propongo que una corrección se haga como "Reducción" o como "Ajuste de admin" (fuera de plazo y con motivo).
> Respuesta (05/10): son **reducciones**: se reduce lo registrado ingresando una cantidad negativa. **Decisión:** se migran como `reduccion`.

## Se pueden responder después

**P7. Roles Comedor y Supervisor:** ¿qué hacen exactamente? ¿Solo consultan o también registran? ¿El rol Comedor ve todas las empresas pero solo su comedor?
> Respuesta:

**P8. Traslados entre sectores.** Pediste "solo dentro del mismo sector (parte alta / parte baja)", pero en el historial ~3.400 traslados fueron entre PARTE ALTA y PARTE BAJA. ¿Se aplica la regla desde ahora? ¿Y BARRACAS es un tercer sector que solo traslada dentro de sí mismo?
> Respuesta (05/10): la regla es reciente, por eso el historial tiene traslados entre sectores. **Decisión:** solo se permite trasladar dentro del mismo sector, con una matriz configurable por el Superadmin. Sigue pendiente: ¿BARRACAS es un sector propio que solo traslada dentro de sí mismo?

**P9. Servicios por comedor.** Revisa la tabla de `MAPEO_MIGRACION.md` §2 (deducida del historial). ¿Es correcta? `BARRACAS - PAMPA LARGA` no tiene sector: ¿cuál es el suyo?
> Respuesta:

**P10. Frentes por empresa.** El maestro de frentes no tiene RUC. ¿Una empresa solo puede usar los frentes que registró (los que aprobó KW) o puede elegir cualquier frente? Propongo: solo los suyos, con contrato vigente.
> Respuesta:

**P11. Registro.** ¿Quién aprueba los registros: solo el Superadmin o también el Admin? ¿Una empresa ya registrada pide frentes nuevos por el mismo formulario?
> Respuesta:

**P12. Precios y costo.** Las tarifas de servicios (por ejemplo, ALMUERZO S/ 24,82), ¿son sin IGV? ¿Las empresas deben ver el costo estimado en el dashboard, o solo cantidades?
> Respuesta:

**P13. Programar dos veces lo mismo.** Si ya programé 5 almuerzos para el lunes y vuelvo a programar 5, ¿se suman (10) o se reemplaza? Hoy se suman.
> Respuesta:

**P14. "Proyección mensual".** En la grilla de raciones registradas mencionas un cálculo de proyección mensual que no veo en la captura. ¿Qué muestra?
> Respuesta:

**P15. Refrigerios.**
- a) "Estándar + especiales": si pido 10 estándar y agrego 5 FRUTA, ¿cada refrigerio lleva 5 frutas extra (50 en total) o son 5 frutas en total?
- b) ¿Se pueden reducir o anular refrigerios ya enviados? ¿Desde qué pantalla?
- c) ¿Hay historial de refrigerios para migrar?
> Respuesta:

**P16. Menú semanal.** ¿Los 2 PDFs son, por ejemplo, "parte alta" y "parte baja", o semana actual y semana siguiente?
> Respuesta:

**P17. Correo de contacto.** El prompt usa `adm.kw@kunturwasicatering.com` y los correos actuales muestran `adm.ktw@kunturwasi-catering.com`. ¿Cuál es el correcto? ¿Qué dominio usaremos para enviar (por ejemplo, `notificaciones@kunturwasi-catering.com`)?
> Respuesta:

**P18. Feriados:** ¿cambian algún plazo?
> Respuesta:

**P19.** El modelo de Adición/Reducción dice "Se ha registrado la siguiente solicitud **de acuerdo con lo previamente acordado**" (texto resaltado). ¿Ese texto va en todos los correos, solo en ese, o se quita?
> Respuesta:

**P20. Destinatarios de los correos.** ¿Quiénes reciben las confirmaciones? Propongo: el usuario que envía + los contactos de "Gestión de raciones" de la empresa (máximo 5) + CCO opcional a un buzón interno.
> Respuesta:
