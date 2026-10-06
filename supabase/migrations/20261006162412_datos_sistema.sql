-- =============================================================================
-- Kuntur Wasi · Migración 5: datos del sistema (roles base, menús, permisos
-- por defecto, configuración y horarios por defecto, sectores y tipos de
-- servicio). Son datos necesarios también en producción.
-- =============================================================================

-- Roles base -----------------------------------------------------------------
insert into public.roles (codigo, nombre, descripcion, alcance, requiere_mfa, es_sistema) values
  ('superadmin',  'Superadmin',  'Acceso total. Único rol que puede registrar fuera de plazo.', 'todas',   true,  true),
  ('admin',       'Admin',       'Equipo de Kuntur Wasi. Opera por cualquier empresa.',          'todas',   true,  true),
  ('contratista', 'Contratista', 'Usuario de una empresa contratista. Solo ve su empresa.',      'empresa', false, true),
  ('comedor',     'Comedor',     'Personal de comedor. Consulta las raciones de su comedor.',    'comedor', false, true),
  ('supervisor',  'Supervisor',  'Supervisión. Consulta raciones de todas las empresas.',        'todas',   false, true);

-- Menús ----------------------------------------------------------------------
insert into public.menus (codigo, padre_codigo, nombre, icono, ruta, orden, acciones_disponibles) values
  ('maestras',                 null,       'Tablas maestras',            'database',  '/maestras',             10, array['ver']),
  ('maestras.clientes',        'maestras', 'Clientes y contactos',       null,        '/maestras/clientes',    11, array['ver','editar','exportar']),
  ('maestras.frentes',         'maestras', 'Frentes de trabajo',         null,        '/maestras/frentes',     12, array['ver','editar','exportar']),
  ('maestras.usuarios',        'maestras', 'Usuarios',                   null,        '/maestras/usuarios',    13, array['ver','editar','crear','exportar']),
  ('maestras.catalogos',       'maestras', 'Catálogos',                  null,        '/maestras/catalogos',   14, array['ver','editar','exportar']),
  ('maestras.solicitudes',     'maestras', 'Solicitudes de registro',    null,        '/maestras/solicitudes', 15, array['ver','aprobar']),

  ('raciones',                  null,       'Gestiona tus raciones',     'utensils',  '/raciones',                   20, array['ver']),
  ('raciones.dashboard',        'raciones', 'Dashboard',                 null,        '/raciones',                   21, array['ver']),
  ('raciones.consulta',         'raciones', 'Consulta detallada',        null,        '/raciones/consulta',          22, array['ver','exportar']),
  ('raciones.programar',        'raciones', 'Programa tus raciones',     null,        '/raciones/programar',         23, array['ver','enviar']),
  ('raciones.adicionar_reducir','raciones', 'Adiciona / Reduce tus raciones', null,   '/raciones/adicionar-reducir', 24, array['ver','enviar']),
  ('raciones.trasladar',        'raciones', 'Traslada tus raciones',     null,        '/raciones/trasladar',         25, array['ver','enviar']),

  ('refrigerios',   null, 'Registro de refrigerios',            'sandwich', '/refrigerios',  30, array['ver','enviar','exportar']),
  ('menu_semanal',  null, 'Menú semanal',                       'bowl',     '/menu-semanal', 40, array['ver','editar']),
  ('manual_tyc',    null, 'Manual, términos y condiciones',     'pdf',      '/documentos',   50, array['ver','editar']),
  ('contactanos',   null, 'Contáctanos',                        'mail',     '/contactanos',  60, array['ver','enviar']),

  ('admin',               null,    'Administración',        'settings', '/admin',               70, array['ver']),
  ('admin.roles',         'admin', 'Roles y permisos',      null,       '/admin/roles',         71, array['ver']),
  ('admin.configuracion', 'admin', 'Configuración y horarios', null,    '/admin/configuracion', 72, array['ver','editar']),
  ('admin.auditoria',     'admin', 'Auditoría',             null,       '/admin/auditoria',     73, array['ver','exportar']),
  ('admin.correos',       'admin', 'Historial de correos',  null,       '/admin/correos',       74, array['ver','enviar']),
  ('admin.alertas',       'admin', 'Alertas post-login',    null,       '/admin/alertas',       75, array['ver','editar']),
  ('admin.importador',    'admin', 'Importar Excel',        null,       '/admin/importador',    76, array['ver','enviar']),
  ('admin.metricas',      'admin', 'Métricas de uso',       null,       '/admin/metricas',      77, array['ver']);

-- Permisos por defecto (el Superadmin tiene todo sin necesidad de filas) -----
insert into public.rol_permisos (rol_id, menu_codigo, acciones)
select r.id, p.menu, p.acciones
from (values
  -- Admin
  ('admin', 'raciones',                   array['ver']),
  ('admin', 'raciones.dashboard',         array['ver']),
  ('admin', 'raciones.consulta',          array['ver','exportar']),
  ('admin', 'raciones.programar',         array['ver','enviar']),
  ('admin', 'raciones.adicionar_reducir', array['ver','enviar']),
  ('admin', 'raciones.trasladar',         array['ver','enviar']),
  ('admin', 'refrigerios',                array['ver','enviar','exportar']),
  ('admin', 'menu_semanal',               array['ver','editar']),
  ('admin', 'manual_tyc',                 array['ver']),
  ('admin', 'contactanos',                array['ver','enviar']),
  -- Contratista
  ('contratista', 'raciones',                   array['ver']),
  ('contratista', 'raciones.dashboard',         array['ver']),
  ('contratista', 'raciones.consulta',          array['ver','exportar']),
  ('contratista', 'raciones.programar',         array['ver','enviar']),
  ('contratista', 'raciones.adicionar_reducir', array['ver','enviar']),
  ('contratista', 'raciones.trasladar',         array['ver','enviar']),
  ('contratista', 'refrigerios',                array['ver','enviar']),
  ('contratista', 'menu_semanal',               array['ver']),
  ('contratista', 'manual_tyc',                 array['ver']),
  ('contratista', 'contactanos',                array['ver','enviar']),
  -- Comedor (consulta; pendiente P7)
  ('comedor', 'raciones',           array['ver']),
  ('comedor', 'raciones.dashboard', array['ver']),
  ('comedor', 'raciones.consulta',  array['ver','exportar']),
  ('comedor', 'refrigerios',        array['ver']),
  ('comedor', 'menu_semanal',       array['ver']),
  -- Supervisor (consulta; pendiente P7)
  ('supervisor', 'raciones',           array['ver']),
  ('supervisor', 'raciones.dashboard', array['ver']),
  ('supervisor', 'raciones.consulta',  array['ver','exportar']),
  ('supervisor', 'refrigerios',        array['ver']),
  ('supervisor', 'menu_semanal',       array['ver'])
) as p(rol, menu, acciones)
join public.roles r on r.codigo = p.rol;

-- Configuración general --------------------------------------------------------
insert into public.configuracion (clave, valor, descripcion, publica) values
  ('zona_horaria',              '"America/Lima"',                    'Zona horaria oficial para todos los plazos', true),
  ('correo.remitente_nombre',   '"Administración de Facturación"',   'Nombre que aparece como remitente de los correos', false),
  ('correo.remitente_direccion','""',                                'Dirección de envío (se define al configurar Amazon SES)', false),
  ('correo.cco_interno',        '""',                                'Copia oculta opcional de todas las confirmaciones', false),
  ('contacto.destinatario',     '"adm.kw@kunturwasicatering.com"',   'Destinatario del formulario Contáctanos (pendiente P17)', false),
  ('archivos.pdf_menu_max_bytes',      '1048576',  'Tamaño máximo de cada PDF del menú semanal', true),
  ('archivos.contacto_max_bytes',      '10485760', 'Tamaño máximo total de adjuntos en Contáctanos', true),
  ('archivos.contacto_tipos',          '["application/pdf","image/png","image/jpeg","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]', 'Tipos de archivo permitidos en Contáctanos', true);

-- Horarios por defecto (todos editables por el Superadmin) --------------------
-- dia_semana: 1 = lunes … 7 = domingo (ISO).
insert into public.config_horarios (modulo, regla, valor, descripcion) values
  ('programacion', 'semanas_maximas',          '6',                                 'Hasta cuántas semanas hacia adelante se puede programar'),
  ('programacion', 'cierre_semana_siguiente',  '{"dia_semana": 3, "hora": "23:59"}', 'Último momento para programar la semana siguiente (miércoles 23:59)'),
  ('programacion', 'permite_semana_en_curso',  'false',                             'Si se permite programar la semana en curso (si no, se usa Adicionales)'),
  ('adicion',      'hora_limite_dia_anterior', '"17:00"',                           'Las adiciones para el día D se aceptan hasta esta hora del día D-1'),
  ('reduccion',    'horas_anticipacion',       '48',                                'Las reducciones para el día D se aceptan hasta N horas antes del inicio del día D'),
  ('traslado',     'horas_anticipacion',       '48',                                'Los traslados para el día D se aceptan hasta N horas antes del inicio del día D'),
  ('refrigerio',   'hora_limite_dia_anterior', '"17:00"',                           'Refrigerios para el día D se registran hasta esta hora del día D-1'),
  ('refrigerio',   'horas_anticipacion_reduccion', '48',                            'Reducción de refrigerios: N horas antes del inicio del día'),
  ('refrigerio',   'entrega_desde',            '"06:00"',                           'Primera hora de entrega permitida'),
  ('refrigerio',   'entrega_hasta',            '"21:30"',                           'Última hora de entrega permitida');

-- Sectores y tipos de servicio ---------------------------------------------
insert into public.sectores (codigo, nombre) values
  ('PARTE_ALTA', 'Parte alta'),
  ('PARTE_BAJA', 'Parte baja'),
  ('BARRACAS',   'Barracas');

-- Regla inicial de traslados: solo dentro del mismo sector (configurable).
insert into public.traslado_reglas_sector (sector_origen_id, sector_destino_id)
select id, id from public.sectores;

insert into public.tipos_servicio (codigo, nombre, orden) values
  ('DESAYUNO', 'Desayuno', 1),
  ('ALMUERZO', 'Almuerzo', 2),
  ('CENA',     'Cena',     3);
