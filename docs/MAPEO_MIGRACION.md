# Mapeo de migración — Excel y CSV actuales → base de datos nueva

**Fase 0 · Borrador para aprobación · 05/10/2026**

El importador del Superadmin aceptará el **mismo formato** de los archivos actuales:

- el libro `DATA SOLICITUD v3.xlsx`, hoja `query (2)`;
- los 7 CSV `MAESTRO DE … v2.csv` (UTF-8 con BOM).

Siempre se ejecuta primero una **simulación** que no escribe nada. Después se importa en este orden:

**proyectos → áreas → frentes → empresas → contactos → comedores → servicios y tarifas → comedor-servicios → movimientos**

## 1. Reglas generales de limpieza

| Regla | Ejemplo del dato actual |
|---|---|
| Quitar espacios al inicio y al final, y unir espacios dobles | `KM 52 `, `LIMPIEZA DE  FILTROS` |
| Comparar catálogos en mayúsculas y sin tildes; guardar el nombre original | `ILUMINACIÓN` = `ILUMINACION` |
| Booleanos `Verdadero` / `False` / `Activo` / `Inactivo` → `true` / `false` | Columnas `HABILITADO_*`, `ESTADO*` |
| Fechas `d/mm/aaaa` → `date` | `1/08/2022` |
| Marcas de tiempo `1/10/2026 10:24a. m.` (con espacio especial U+202F) → `timestamptz` en America/Lima | Columnas `Modified` / `Created` |
| Montos con punto decimal → `numeric(10,2)` | `24.07` |
| RUC: texto de 11 dígitos, se conservan ceros a la izquierda | `00000000000` (empresa de prueba) |
| Cada fila guarda `origen_id` = archivo + clave natural, para que reimportar no duplique | |

## 2. CSV maestros

### `MAESTRO DE PROYECTOS v2.csv` → `proyectos` (3 filas)

| Columna | Destino |
|---|---|
| NOMBRE PROYECTO | `proyectos.nombre` |
| ESTADO | `proyectos.activo` |

Falta **SULFUROS** (usado en 17 frentes y en el historial). El importador lo crea y lo informa como advertencia.

### `MAESTRO DE ÁREAS v2.csv` → `areas` (43 filas)

| Columna | Destino |
|---|---|
| NOMBRE AREA | `areas.nombre` |
| ESTADO | `areas.activo` |
| Modificado / Creado | `updated_at` / `created_at` |

Falta **OPERACIONES AGUA** (usada en frentes y en el historial). Se crea con advertencia.

### `MAESTRO DE PROYECTO - CLIENTE v2.csv` → `frentes_trabajo` (263 filas)

| Columna | Destino |
|---|---|
| PROYECTO | `proyecto_id` (por nombre) |
| ÁREA | `area_id` (por nombre) |
| PROYECTO MENOR | `frentes_trabajo.nombre` |
| SPONSOR | `sponsor` |
| CONTRATO DESDE / HASTA | `contrato_desde` / `contrato_hasta` |

- Hay 20 filas repetidas en (proyecto, área, frente): se unen en una y se conserva el contrato más amplio.
- **No trae RUC.** La relación empresa-frente se deduce del historial **[PREGUNTA P10]**.

### `MAESTRO DE CLIENTES v2.csv` → `empresas` (177 filas)

| Columna | Destino |
|---|---|
| RUC. | `ruc` (clave natural) |
| Razón social | `razon_social` |
| NOMBRE PERSONNEL | `nombre_corto` (es el nombre que aparece en el historial) |
| Dirección | `direccion` |
| Tipo Registro | `tipo` (Empresa / Persona) |
| TelefonoValo | `telefonos` (texto libre) |

### `MAESTRO DE CONTACTOS v2.csv` → `empresa_contactos` (653 filas)

| Columna | Destino |
|---|---|
| Title | `empresa_id` (por RUC). Todos los RUC existen en clientes |
| PERSONA DE CONTACTO | `nombre` |
| TELÉFONO | `telefono` |
| CORREO | `correo` (se valida el formato) |
| AREA DE CONTACTO | `tipo`: Gestión de raciones → gestion_raciones, Facturación → facturacion, Cobranzas → cobranzas |

- `recibe_notificaciones = true` para los contactos de "Gestión de raciones" **[PREGUNTA P20]**.
- 3 empresas no tienen ningún contacto (se informa).

### `MAESTRO DE COMEDORES v2.csv` → `comedores` (34 filas)

| Columna | Destino |
|---|---|
| NOMBRE COMEDOR | `nombre` |
| HABILITADO_RACIONES + ESTADO | `habilitado_raciones` (verdadero solo si las dos lo dicen) |
| HABILITADO_REFRIGERIOS + ESTADO_REFRIGERIOS | `habilitado_refrigerios` |
| HABILITADO_PUNTOSK + ESTADO_PUNTOSK | `habilitado_puntos_k` |
| HABILITADO_KITCH + ESTADO_KITCH | `habilitado_kitchenette` |
| TIPO_COMEDOR | `sector_id` (PARTE ALTA / PARTE BAJA / BARRACAS); vacío en 21 comedores, todos de kitchenette salvo `BARRACAS - PAMPA LARGA` |

Pregunta abierta: `BARRACAS - PAMPA LARGA` tiene sector vacío y los estados vacíos, pero se usa en el historial (2.596 filas). **[PREGUNTA P9]**

### `MAESTRO DE SERVICIOS v2.csv` → `servicios` + `servicio_tarifas` (124 filas)

| Columna | Destino |
|---|---|
| NOMBRE SERVICIO | `servicios.nombre` (10 distintos) |
| TIPO SERVICIO | `tipo_servicio_id` (DESAYUNO / ALMUERZO / CENA) |
| (derivado) | `es_a_campo` = el nombre contiene "A CAMPO" |
| COSTO SERVICIO | `servicio_tarifas.precio` |
| DESDE / HASTA | `vigente_desde` / `vigente_hasta` (`31/12/2099` = sin fin) |

El importador rechaza tarifas que se solapen para un mismo servicio.

### Tabla nueva: `comedor_servicios` (carga inicial propuesta, deducida del historial 2025-2026)

✔ = el comedor atendió ese servicio al menos una vez. Revísala **[PREGUNTA P9]**.

| Comedor | DES | ALM | CEN | DES-ALM | ALM-CEN | DES campo | ALM campo | CEN campo | DES-ALM campo | ALM-CEN campo |
|---|---|---|---|---|---|---|---|---|---|---|
| KM 52 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| KM 37 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| QUINUA COMPLEX | | ✔ | (2) | | | | ✔ | | | |
| TALLERES I | ✔ | ✔ | | | | | ✔ | | | (2) |
| TALLERES II | | ✔ | | | | | ✔ | | | |
| PLANTA PAMPA LARGA | | ✔ | | | | | ✔ | | | |
| PLANTA YANACOCHA NORTE | | ✔ | | | | | ✔ | | | |
| 1400 | | ✔ | | | | | ✔ | | | |
| CARPA OESTE 1 | | ✔ | | | | | ✔ | | | |
| CARPA OESTE 2 | | ✔ | | | | | | | | |
| BARRACAS - HUANDOY | ✔ | ✔ | ✔ | ✔ | | | ✔ | | | |
| BARRACAS - PAMPA LARGA | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ | | | |
| BARRACAS - YANACOCHA NORTE | | ✔ | | | | | ✔ | | | |

(2) = solo 2 registros: probablemente errores. Propongo no habilitarlos.

## 3. Historial: `DATA SOLICITUD v3.xlsx` → `envios` + `racion_movimientos` + `racion_saldos`

Hoja `query (2)`: 320.163 filas, fechas de servicio del 01/01/2025 al 31/12/2026, creadas entre el 13/12/2024 y el 04/10/2026. El libro une tres listas de SharePoint (`DATA SOLICITUD`, `v2`, `v3`).

| Columna Excel | Destino | Transformación |
|---|---|---|
| FECHA | `racion_movimientos.fecha` | Fecha sin hora |
| EMPRESA | `empresa_id` | Por RUC. Las 165 empresas existen en clientes |
| COMEDOR | `comedor_id` | Por nombre. Los 13 existen |
| SERVICIO | `servicio_id` | Por nombre. Los 10 existen |
| PROYECTO + AREA + PY VALORIZACION | `frente_id` | Por (proyecto, área, frente) normalizados. **34 combinaciones (26.544 filas) no existen en el maestro de frentes**: se crean como frentes inactivos con la marca "creado por migración" y se listan para revisión |
| CANTIDAD | `cantidad` | Entero con signo, se conserva el signo |
| TIPO REGISTRO | `tipo_movimiento` | Programación → `programacion` si es positiva; las 6.319 negativas son reducciones y se migran como `reduccion` [CONFIRMADO P6]; Adicionales → `adicion`; Reducciones → `reduccion`; Traslados → `traslado_salida` (negativo) o `traslado_entrada` (positivo) |
| Usuario | `envios.usuario_id` | El RUC o la cuenta actual se mapea a un usuario "histórico" por cuenta (los usuarios nuevos serán por persona, P1) |
| NOMBRE PERSONNEL | — | Solo para validar que coincide con la empresa |
| Creado | `envios.enviado_en`, `racion_movimientos.created_at` | Hora de Lima (los patrones de horario lo confirman) |
| Modificado | `auditoria` | Si es distinto de Creado, la fila fue editada en SharePoint |
| Tipo de elemento | — | Se descarta (siempre "Elemento") |
| Ruta de acceso | `origen_id` | Lista de origen + número de fila |

**Agrupación en envíos:** las filas de la misma cuenta, empresa y tipo, con menos de 5 minutos entre una y otra, forman un envío. Resultado estimado: ~27.000 envíos históricos.

**Pares de traslado:** dentro de un envío, cada salida (−N) se une con la entrada (+N) de la misma fecha y cantidad (`traslado_par_id`). Se emparejan unos 9.800 de forma exacta; el resto queda sin par y se informa.

**Saldos:** después de importar se recalcula `racion_saldos` sumando los movimientos. Ninguna de las 247.798 combinaciones queda en negativo.

**Correos:** la migración **no** envía correos.

**Rendimiento:** el archivo pesa 24 MB. El importador lo procesa en el servidor por lotes de 5.000 filas, con barra de avance.

## 4. Lo que no puedo migrar todavía (faltan archivos)

| Dato | Se necesita | Pregunta |
|---|---|---|
| Usuarios, roles y estado | No hace falta por ahora: se crea un usuario de ejemplo por rol y el Superadmin crea el resto | P2 respondida |
| Productos de refrigerio, precios y composición del estándar | No hace falta por ahora: se cargan productos de ejemplo y el Superadmin los gestiona | P2 respondida |
| Historial de refrigerios | Exportar la lista de solicitudes de refrigerios | P15 |
| Solicitudes de registro pendientes | Exportar la pestaña "Solicitudes" | P11 |
| PDFs del menú semanal, manual y T&C | Copiar los archivos vigentes | P16 |

**Contraseñas:** no se migran. Cada usuario recibe un correo para crear la suya. Además, como las contraseñas actuales se ven en "Data maestra", conviene darlas por expuestas.
