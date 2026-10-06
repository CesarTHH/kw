-- Pruebas del guardado atómico de permisos (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create temporary table u (clave text primary key, id uuid);
grant select on u to authenticated;
insert into u values ('sa', gen_random_uuid()), ('admin', gen_random_uuid());
insert into auth.users (id, email, raw_app_meta_data)
select id, clave || '@prueba.example.com',
       jsonb_build_object('rol_codigo', case clave when 'sa' then 'superadmin' else 'admin' end)
from u;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from u where clave = p_clave), 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

select pg_temp.como('admin');
select throws_ok(
  $$select public.guardar_permisos_rol((select id from public.roles where codigo = 'contratista'), '[]'::jsonb)$$,
  '42501', null, 'Admin no puede usar guardar_permisos_rol');

select pg_temp.como('sa');
select throws_ok(
  $$select public.guardar_permisos_rol((select id from public.roles where codigo = 'superadmin'), '[]'::jsonb)$$,
  '22023', null, 'No se editan los permisos del Superadmin');

select is(
  public.guardar_permisos_rol(
    (select id from public.roles where codigo = 'supervisor'),
    '[{"menu":"raciones","acciones":["ver"]},
      {"menu":"raciones.consulta","acciones":["ver","exportar","hackear"]},
      {"menu":"no.existe","acciones":["ver"]},
      {"menu":"raciones.trasladar","acciones":["borrar"]}]'::jsonb),
  2, 'Guarda solo menús existentes con acciones válidas');

select is(
  (select acciones from public.rol_permisos rp join public.roles r on r.id = rp.rol_id
   where r.codigo = 'supervisor' and rp.menu_codigo = 'raciones.consulta'),
  array['exportar', 'ver'], 'Descarta acciones inventadas');

select is(
  (select count(*)::int from public.rol_permisos rp join public.roles r on r.id = rp.rol_id where r.codigo = 'supervisor'),
  2, 'Reemplaza los permisos anteriores del rol');

select is(public.guardar_permisos_rol((select id from public.roles where codigo = 'supervisor'), '[]'::jsonb),
  0, 'Lista vacía deja el rol sin permisos');

select throws_ok(
  $$select public.guardar_permisos_rol((select id from public.roles where codigo = 'supervisor'), '{"x":1}'::jsonb)$$,
  '22023', null, 'Rechaza formatos que no son lista');

select throws_ok(
  $$select public.guardar_permisos_rol((select id from public.roles where codigo = 'supervisor'), null)$$,
  '22023', null, 'Rechaza permisos nulos (no borra el rol por accidente)');

select throws_ok(
  $$select public.guardar_permisos_rol((select id from public.roles where codigo = 'contratista'),
     '[{"menu":"maestras.usuarios","acciones":["ver","editar"]}]'::jsonb)$$,
  '22023', null, 'Un rol de alcance empresa no recibe tablas maestras ni administración');

select * from finish();
rollback;
