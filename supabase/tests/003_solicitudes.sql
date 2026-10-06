-- Pruebas de solicitudes de registro y validación de horarios (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

create temporary table u (clave text primary key, id uuid);
grant select on u to authenticated;
insert into u values ('sa', gen_random_uuid()), ('admin', gen_random_uuid()), ('ca', gen_random_uuid());
insert into auth.users (id, email, raw_app_meta_data)
select id, clave || '@prueba.example.com',
  case clave
    when 'sa'    then jsonb_build_object('rol_codigo', 'superadmin')
    when 'admin' then jsonb_build_object('rol_codigo', 'admin')
    else jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999019'))
  end
from u;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from u where clave = p_clave), 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;
create or replace function pg_temp.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Solicitudes de ejemplo (las inserta el servidor con service_role).
create temporary table s (clave text primary key, id uuid);
grant select on s to authenticated;
with nueva as (
  insert into public.solicitudes_registro (ruc, razon_social, usuario_nombre, usuario_correo, frentes, contactos, acepta_tyc)
  values ('20999999035', 'Empresa Nueva SAC', 'Ana Prueba', 'ana@prueba.example.com',
    jsonb_build_array(
      jsonb_build_object('proyecto_id', (select id from public.proyectos where nombre = 'YANACOCHA'),
                         'area_id', (select id from public.areas where nombre = 'LEGAL'),
                         'frente', '  frente demo 1 ', 'sponsor', 'S', 'desde', '2026-01-01', 'hasta', '2026-12-31'),
      jsonb_build_object('proyecto_id', (select id from public.proyectos where nombre = 'WTP'),
                         'area_id', (select id from public.areas where nombre = 'PROCESOS'),
                         'frente', 'Frente Nuevo', 'sponsor', '', 'desde', '2026-02-01', 'hasta', '2026-11-30')),
    jsonb_build_array(
      jsonb_build_object('tipo', 'gestion_raciones', 'nombre', 'Ana Prueba', 'telefono', '999', 'correo', 'ANA@prueba.example.com'),
      jsonb_build_object('tipo', 'facturacion', 'nombre', 'Luis Prueba', 'telefono', '', 'correo', 'luis@prueba.example.com')),
    true)
  returning id)
insert into s select 'nueva', id from nueva;
with otra as (
  insert into public.solicitudes_registro (ruc, razon_social, usuario_nombre, usuario_correo, frentes, contactos, acepta_tyc)
  values ('20999999019', 'Otra', 'Beto', 'beto@prueba.example.com',
    jsonb_build_array(jsonb_build_object('proyecto_id', (select id from public.proyectos where nombre = 'YANACOCHA'),
      'area_id', (select id from public.areas where nombre = 'LEGAL'), 'frente', 'X', 'desde', '2026-01-01', 'hasta', '2026-12-31')),
    jsonb_build_array(jsonb_build_object('tipo', 'cobranzas', 'nombre', 'Beto', 'correo', 'beto@prueba.example.com')),
    true)
  returning id)
insert into s select 'otra', id from otra;

-- 1-2. Restricciones de la tabla
select throws_ok(
  $$insert into public.solicitudes_registro (ruc, razon_social, usuario_nombre, usuario_correo, frentes, contactos, acepta_tyc)
    values ('20999999043', 'X SAC', 'Ana', 'ANA@prueba.example.com', '[{}]', '[{}]', true)$$,
  '23505', null, 'Solo una solicitud pendiente por correo');
select throws_ok(
  $$insert into public.solicitudes_registro (ruc, razon_social, usuario_nombre, usuario_correo, frentes, contactos, acepta_tyc)
    values ('20999999043', 'X SAC', 'Zoe', 'zoe@prueba.example.com', '[{}]', '[{}]', false)$$,
  '23514', null, 'Sin aceptar los términos no se registra');

-- 3-5. Accesos
set local role anon;
select throws_ok('select * from public.solicitudes_registro', '42501', null, 'anon no lee solicitudes');
reset role;
select pg_temp.como('ca');
select is((select count(*)::int from public.solicitudes_registro), 0, 'Contratista no ve solicitudes');
select throws_ok($$select public.aprobar_solicitud((select id from s where clave = 'nueva'))$$,
  '42501', null, 'Contratista no puede aprobar');
select throws_ok($$insert into public.solicitudes_registro (ruc, razon_social, usuario_nombre, usuario_correo, frentes, contactos, acepta_tyc)
                   values ('20999999043', 'X SAC', 'Zoe', 'zoe@prueba.example.com', '[{}]', '[{}]', true)$$,
  '42501', null, 'Un usuario no inserta solicitudes directamente');

-- 7-15. Superadmin aprueba
select pg_temp.como('sa');
select is((select count(*)::int from public.solicitudes_registro), 2, 'Superadmin ve las solicitudes');
select throws_ok($$update public.solicitudes_registro set estado = 'aprobada'$$,
  '42501', null, 'El estado solo cambia con las funciones de aprobación');
select lives_ok($$select public.aprobar_solicitud((select id from s where clave = 'nueva'))$$, 'Superadmin aprueba la solicitud');
select is((select estado from public.solicitudes_registro where id = (select id from s where clave = 'nueva')), 'aprobada',
  'La solicitud queda aprobada');
select ok(exists (select 1 from public.empresas where ruc = '20999999035' and razon_social = 'Empresa Nueva SAC'),
  'Se crea la empresa');
select is((select count(*)::int from public.empresa_contactos c join public.empresas e on e.id = c.empresa_id
           where e.ruc = '20999999035'), 2, 'Se crean sus contactos');
select is((select correo from public.empresa_contactos c join public.empresas e on e.id = c.empresa_id
           where e.ruc = '20999999035' and c.tipo = 'gestion_raciones'), 'ana@prueba.example.com',
  'El correo del contacto se guarda en minúsculas');
select is((select count(*)::int from public.frentes_trabajo where nombre = 'FRENTE DEMO 1'), 1,
  'Un frente existente se reutiliza (no se duplica)');
select is((select count(*)::int from public.empresa_frentes ef join public.empresas e on e.id = ef.empresa_id
           where e.ruc = '20999999035'), 2, 'La empresa queda asignada a sus dos frentes');
select throws_ok($$select public.aprobar_solicitud((select id from s where clave = 'nueva'))$$,
  '22023', null, 'No se aprueba dos veces');

-- 16-17. Rechazo
select throws_ok($$select public.rechazar_solicitud((select id from s where clave = 'otra'), 'no')$$,
  '22023', null, 'El rechazo exige un motivo');
select lives_ok($$select public.rechazar_solicitud((select id from s where clave = 'otra'), 'RUC ya registrado')$$,
  'Superadmin rechaza con motivo');

-- 18-20. Validación de horarios
select throws_ok($$update public.config_horarios set valor = '"25:00"' where modulo = 'adicion' and regla = 'hora_limite_dia_anterior'$$,
  '22023', null, 'Rechaza horas inválidas');
select throws_ok($$update public.config_horarios set valor = '"48"' where modulo = 'reduccion' and regla = 'horas_anticipacion'$$,
  '22023', null, 'Rechaza cambiar el tipo de un valor');
select throws_ok($$update public.config_horarios set valor = '{"dia_semana": 9, "hora": "23:59"}'
                   where modulo = 'programacion' and regla = 'cierre_semana_siguiente'$$,
  '22023', null, 'Rechaza días de la semana fuera de rango');
select pg_temp.reset();

select * from finish();
rollback;
