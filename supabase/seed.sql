-- =============================================================================
-- Kuntur Wasi · Datos de EJEMPLO para desarrollo y pruebas.
-- No contiene datos personales reales: empresas, personas y correos son ficticios.
-- Los catálogos reales (comedores, servicios, tarifas, frentes, clientes) se
-- cargan en producción con el importador de Excel.
-- Es idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- Servicios -------------------------------------------------------------------
insert into public.servicios (nombre, tipo_servicio_id, es_a_campo, orden)
select v.nombre, t.id, v.campo, v.orden
from (values
  ('DESAYUNO',                  'DESAYUNO', false, 1),
  ('DESAYUNO A CAMPO',          'DESAYUNO', true,  2),
  ('ALMUERZO',                  'ALMUERZO', false, 3),
  ('ALMUERZO A CAMPO',          'ALMUERZO', true,  4),
  ('DESAYUNO ALMUERZO',         'ALMUERZO', false, 5),
  ('DESAYUNO ALMUERZO A CAMPO', 'ALMUERZO', true,  6),
  ('CENA',                      'CENA',     false, 7),
  ('CENA A CAMPO',              'CENA',     true,  8),
  ('ALMUERZO CENA',             'CENA',     false, 9),
  ('ALMUERZO CENA A CAMPO',     'CENA',     true,  10)
) as v(nombre, tipo, campo, orden)
join public.tipos_servicio t on t.codigo = v.tipo
on conflict do nothing;

-- Tarifas de EJEMPLO (no son los precios reales) ----------------------------------
insert into public.servicio_tarifas (servicio_id, precio, vigente_desde)
select s.id, v.precio, date '2026-01-01'
from (values
  ('DESAYUNO', 10.00), ('DESAYUNO A CAMPO', 10.00),
  ('ALMUERZO', 20.00), ('ALMUERZO A CAMPO', 20.00),
  ('DESAYUNO ALMUERZO', 20.00), ('DESAYUNO ALMUERZO A CAMPO', 20.00),
  ('CENA', 18.00), ('CENA A CAMPO', 18.00),
  ('ALMUERZO CENA', 18.00), ('ALMUERZO CENA A CAMPO', 18.00)
) as v(nombre, precio)
join public.servicios s on s.nombre = v.nombre
where not exists (select 1 from public.servicio_tarifas st where st.servicio_id = s.id);

-- Comedores (catálogo operativo) ------------------------------------------------
insert into public.comedores (nombre, sector_id, habilitado_raciones, habilitado_refrigerios)
select v.nombre, s.id, true, v.refrigerios
from (values
  ('KM 52',                      'PARTE_ALTA', true),
  ('TALLERES I',                 'PARTE_ALTA', true),
  ('TALLERES II',                'PARTE_ALTA', false),
  ('PLANTA PAMPA LARGA',         'PARTE_ALTA', false),
  ('1400',                       'PARTE_ALTA', false),
  ('KM 37',                      'PARTE_BAJA', true),
  ('QUINUA COMPLEX',             'PARTE_BAJA', false),
  ('PLANTA YANACOCHA NORTE',     'PARTE_BAJA', false),
  ('CARPA OESTE 1',              'PARTE_BAJA', false),
  ('CARPA OESTE 2',              'PARTE_BAJA', false),
  ('BARRACAS - HUANDOY',         'BARRACAS',   false),
  ('BARRACAS - PAMPA LARGA',     'BARRACAS',   true),
  ('BARRACAS - YANACOCHA NORTE', 'BARRACAS',   false)
) as v(nombre, sector, refrigerios)
join public.sectores s on s.codigo = v.sector
on conflict do nothing;

-- Servicios por comedor (propuesta deducida del historial; ver MAPEO_MIGRACION §2)
insert into public.comedor_servicios (comedor_id, servicio_id)
select c.id, s.id
from (values
  ('KM 52', null), ('KM 37', null),
  ('QUINUA COMPLEX', 'ALMUERZO'), ('QUINUA COMPLEX', 'ALMUERZO A CAMPO'),
  ('TALLERES I', 'DESAYUNO'), ('TALLERES I', 'ALMUERZO'), ('TALLERES I', 'ALMUERZO A CAMPO'),
  ('TALLERES II', 'ALMUERZO'), ('TALLERES II', 'ALMUERZO A CAMPO'),
  ('PLANTA PAMPA LARGA', 'ALMUERZO'), ('PLANTA PAMPA LARGA', 'ALMUERZO A CAMPO'),
  ('PLANTA YANACOCHA NORTE', 'ALMUERZO'), ('PLANTA YANACOCHA NORTE', 'ALMUERZO A CAMPO'),
  ('1400', 'ALMUERZO'), ('1400', 'ALMUERZO A CAMPO'),
  ('CARPA OESTE 1', 'ALMUERZO'), ('CARPA OESTE 1', 'ALMUERZO A CAMPO'),
  ('CARPA OESTE 2', 'ALMUERZO'),
  ('BARRACAS - HUANDOY', 'DESAYUNO'), ('BARRACAS - HUANDOY', 'ALMUERZO'), ('BARRACAS - HUANDOY', 'CENA'),
  ('BARRACAS - HUANDOY', 'DESAYUNO ALMUERZO'), ('BARRACAS - HUANDOY', 'ALMUERZO A CAMPO'),
  ('BARRACAS - PAMPA LARGA', 'DESAYUNO'), ('BARRACAS - PAMPA LARGA', 'ALMUERZO'), ('BARRACAS - PAMPA LARGA', 'CENA'),
  ('BARRACAS - PAMPA LARGA', 'DESAYUNO ALMUERZO'), ('BARRACAS - PAMPA LARGA', 'ALMUERZO CENA'),
  ('BARRACAS - PAMPA LARGA', 'ALMUERZO A CAMPO'),
  ('BARRACAS - YANACOCHA NORTE', 'ALMUERZO'), ('BARRACAS - YANACOCHA NORTE', 'ALMUERZO A CAMPO')
) as v(comedor, servicio)
join public.comedores c on c.nombre = v.comedor
join public.servicios s on v.servicio is null or s.nombre = v.servicio
on conflict do nothing;

-- Proyectos, áreas y frentes de EJEMPLO ------------------------------------------
insert into public.proyectos (nombre) values ('YANACOCHA'), ('SULFUROS'), ('WTP'), ('QUETCHER')
on conflict do nothing;

insert into public.areas (nombre) values ('LEGAL'), ('MANTENIMIENTO MINA'), ('SERVICIOS GENERALES'), ('PROCESOS')
on conflict do nothing;

insert into public.frentes_trabajo (proyecto_id, area_id, nombre, sponsor, contrato_desde, contrato_hasta)
select p.id, a.id, v.frente, 'Sponsor de ejemplo', date '2026-01-01', date '2027-12-31'
from (values
  ('YANACOCHA', 'LEGAL',               'FRENTE DEMO 1'),
  ('YANACOCHA', 'MANTENIMIENTO MINA',  'FRENTE DEMO 2'),
  ('WTP',       'SERVICIOS GENERALES', 'FRENTE DEMO 3'),
  ('SULFUROS',  'PROCESOS',            'FRENTE DEMO 4')
) as v(proyecto, area, frente)
join public.proyectos p on p.nombre = v.proyecto
join public.areas a on a.nombre = v.area
on conflict do nothing;

-- Empresas ficticias -----------------------------------------------------------------
insert into public.empresas (ruc, razon_social, nombre_corto, direccion, tipo) values
  ('20999999019', 'EMPRESA DEMO ALFA S.A.C.', 'DEMO ALFA', 'Dirección de ejemplo 123', 'empresa'),
  ('20999999027', 'EMPRESA DEMO BETA S.R.L.', 'DEMO BETA', 'Dirección de ejemplo 456', 'empresa')
on conflict (ruc) do nothing;

insert into public.empresa_contactos (empresa_id, tipo, nombre, telefono, correo, recibe_notificaciones, origen_id)
select e.id, v.tipo, v.nombre, '900000000', v.correo, v.tipo = 'gestion_raciones', 'seed:' || v.correo || ':' || v.tipo
from (values
  ('20999999019', 'gestion_raciones', 'Contacto Raciones Alfa',    'raciones@alfa.example.com'),
  ('20999999019', 'facturacion',      'Contacto Facturación Alfa', 'facturacion@alfa.example.com'),
  ('20999999019', 'cobranzas',        'Contacto Cobranzas Alfa',   'cobranzas@alfa.example.com'),
  ('20999999027', 'gestion_raciones', 'Contacto Raciones Beta',    'raciones@beta.example.com')
) as v(ruc, tipo, nombre, correo)
join public.empresas e on e.ruc = v.ruc
on conflict (origen_id) do nothing;

insert into public.empresa_frentes (empresa_id, frente_id, contrato_desde, contrato_hasta)
select e.id, f.id, date '2026-01-01', date '2027-12-31'
from (values
  ('20999999019', 'FRENTE DEMO 1'), ('20999999019', 'FRENTE DEMO 2'),
  ('20999999027', 'FRENTE DEMO 3'), ('20999999027', 'FRENTE DEMO 4')
) as v(ruc, frente)
join public.empresas e on e.ruc = v.ruc
join public.frentes_trabajo f on f.nombre = v.frente
on conflict do nothing;
