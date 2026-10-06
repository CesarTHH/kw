-- =============================================================================
-- Pruebas de seguridad (pgTAP). Se ejecutan con: npx supabase test db
-- Verifican aislamiento entre empresas (RLS), roles, MFA, permisos y auditoría.
-- Todo ocurre dentro de una transacción que se deshace al final.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- ---------------------------------------------------------------------------
-- Preparación: usuarios de prueba (como postgres)
-- ---------------------------------------------------------------------------
create temporary table u (clave text primary key, id uuid);
grant select on u to authenticated, anon;

insert into u values
  ('sa',     gen_random_uuid()), ('admin', gen_random_uuid()),
  ('ca',     gen_random_uuid()), ('cb',    gen_random_uuid()),
  ('com',    gen_random_uuid()), ('sup',   gen_random_uuid()),
  ('pend',   gen_random_uuid()), ('inact', gen_random_uuid());

insert into auth.users (id, email, raw_app_meta_data)
select u.id, u.clave || '@prueba.example.com',
  case u.clave
    when 'sa'    then jsonb_build_object('rol_codigo', 'superadmin', 'nombre', 'SA prueba')
    when 'admin' then jsonb_build_object('rol_codigo', 'admin')
    when 'ca'    then jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999019'))
    when 'cb'    then jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999027'))
    when 'com'   then jsonb_build_object('rol_codigo', 'comedor', 'comedor_id', (select id from public.comedores where nombre = 'KM 52'))
    when 'sup'   then jsonb_build_object('rol_codigo', 'supervisor')
    when 'inact' then jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999019'))
    else '{}'::jsonb
  end
from u;

update public.perfiles set estado = 'inactivo' where id = (select id from u where clave = 'inact');

-- Cambia la sesión a un usuario (rol authenticated + claims del JWT).
create or replace function pg_temp.como(p_clave text, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from u where clave = p_clave), 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;
-- Ejecuta una sentencia y devuelve cuántas filas afectó (0 = bloqueada por RLS).
create or replace function pg_temp.filas(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function pg_temp.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1-2. Alta automática de perfiles
select is((select count(*)::int from public.perfiles where id in (select id from u) and estado = 'activo'), 6,
  'El trigger crea perfiles activos para los usuarios con rol');
select is((select estado from public.perfiles where id = (select id from u where clave = 'pend')), 'pendiente',
  'Usuario sin rol en app_metadata queda pendiente');

-- 3. RUC
select ok(seguridad.ruc_valido('20999999019') and not seguridad.ruc_valido('20999999010') and not seguridad.ruc_valido('123'),
  'Validación de dígito verificador del RUC');

-- 4. Tarifas sin solape
select throws_ok(
  $$insert into public.servicio_tarifas (servicio_id, precio, vigente_desde, vigente_hasta)
    select id, 1, date '2026-06-01', date '2026-06-30' from public.servicios where nombre = 'ALMUERZO'$$,
  '23P01', null, 'No se permiten dos tarifas vigentes a la vez para un servicio');

-- ---------------------------------------------------------------------------
-- Sin sesión (anon)
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok('select * from public.empresas', '42501', null, 'anon no puede leer empresas');
select throws_ok('select * from public.mi_menu()', '42501', null, 'anon no puede llamar a mi_menu');
select throws_ok('select * from public.perfiles', '42501', null, 'anon no puede leer perfiles');
reset role;

-- ---------------------------------------------------------------------------
-- Contratista de la empresa ALFA
-- ---------------------------------------------------------------------------
select pg_temp.como('ca');
select is((select count(*)::int from public.empresas), 1, 'Contratista A ve solo su empresa');
select is((select ruc from public.empresas), '20999999019', 'La empresa visible es la suya');
select is((select count(*)::int from public.empresa_contactos), 3, 'Contratista A ve solo sus contactos');
select is((select count(*)::int from public.frentes_trabajo), 2, 'Contratista A ve solo sus frentes');
select is((select count(*)::int from public.empresa_frentes), 2, 'Contratista A ve solo sus asignaciones de frentes');
select is((select count(*)::int from public.comedores), 13, 'Contratista A puede leer el catálogo de comedores');
select is(
  pg_temp.filas($q$update public.empresas set direccion = 'hack' where ruc = '20999999027'$q$),
  0, 'Contratista A no puede modificar la empresa B');
select is(
  pg_temp.filas($q$update public.empresas set direccion = 'hack' where ruc = '20999999019'$q$),
  0, 'Contratista A no puede modificar ni su propia empresa (sin permiso)');
select throws_ok($$insert into public.empresas (ruc, razon_social, nombre_corto) values ('20999999035', 'X', 'X')$$,
  '42501', null, 'Contratista no puede crear empresas');
select is(
  pg_temp.filas($q$update public.perfiles set rol_id = (select id from public.roles where codigo = 'admin') where id = auth.uid()$q$),
  0, 'Contratista no puede cambiarse de rol');
select throws_ok($$insert into public.rol_permisos (rol_id, menu_codigo, acciones)
                   select id, 'maestras', array['ver'] from public.roles where codigo = 'contratista'$$,
  '42501', null, 'Contratista no puede darse permisos');
select is((select count(*)::int from public.auditoria), 0, 'Contratista no ve la auditoría');
select throws_ok($$insert into public.auditoria (modulo, accion) values ('x', 'y')$$,
  '42501', null, 'Nadie escribe directamente en la auditoría');
select ok(exists (select 1 from public.mi_menu() where codigo = 'raciones.programar')
          and not exists (select 1 from public.mi_menu() where codigo in ('maestras', 'admin', 'admin.roles')),
  'Menú del contratista: raciones sí, maestras y administración no');
select ok(not exists (select 1 from public.configuracion where not publica), 'Contratista solo ve configuración pública');
select is(
  pg_temp.filas($q$update public.config_horarios set valor = '1'$q$),
  0, 'Contratista no puede cambiar horarios');
select is((select zona from public.hora_servidor()), 'America/Lima', 'La hora oficial usa la zona configurada');
select throws_ok($$select public.registrar_evento('borrar_todo')$$, '22023', null, 'registrar_evento rechaza acciones no permitidas');
select lives_ok($$select public.registrar_evento('login', '{"origen":"prueba"}')$$, 'registrar_evento acepta login');
select pg_temp.reset();
select ok((select ultimo_acceso is not null from public.perfiles where id = (select id from u where clave = 'ca')),
  'El login actualiza el último acceso');

-- ---------------------------------------------------------------------------
-- Otros roles
-- ---------------------------------------------------------------------------
select pg_temp.como('cb');
select is((select count(*)::int from public.empresas where ruc = '20999999019'), 0, 'Contratista B no ve la empresa A');

select pg_temp.como('pend');
select is((select count(*)::int from public.empresas), 0, 'Usuario pendiente no ve empresas');
select is((select estado from public.mi_contexto()), 'pendiente', 'mi_contexto informa el estado pendiente');

select pg_temp.como('inact');
select is((select count(*)::int from public.empresas), 0, 'Usuario inactivo no ve empresas');

select pg_temp.como('admin', 'aal1');
select is((select count(*)::int from public.empresas), 0, 'Admin sin MFA verificado no ve datos');
select is((select requiere_mfa and not mfa_verificado from public.mi_contexto()), true, 'mi_contexto indica que falta MFA');

select pg_temp.como('admin', 'aal2');
select is((select count(*)::int from public.empresas), 2, 'Admin con MFA ve todas las empresas');
select throws_ok($$insert into public.rol_permisos (rol_id, menu_codigo, acciones)
                   select id, 'maestras', array['ver'] from public.roles where codigo = 'admin'$$,
  '42501', null, 'Admin no puede modificar permisos');

select pg_temp.como('com');
select is((select count(*)::int from public.empresas), 2, 'Comedor consulta todas las empresas');
select is(
  pg_temp.filas($q$update public.comedores set nombre = 'X'$q$),
  0, 'Comedor no puede editar catálogos');

-- ---------------------------------------------------------------------------
-- Superadmin
-- ---------------------------------------------------------------------------
select pg_temp.como('sa', 'aal2');
select ok((select count(*) from public.auditoria) > 0, 'Superadmin ve la auditoría');
select lives_ok($$insert into public.rol_permisos (rol_id, menu_codigo, acciones)
                  select id, 'maestras.usuarios', array['ver','editar'] from public.roles where codigo = 'admin'$$,
  'Superadmin puede asignar permisos');
select throws_ok($$update public.perfiles set estado = 'inactivo' where id = auth.uid()$$,
  '23514', null, 'No se puede desactivar al último Superadmin');

-- Admin con permiso de usuarios no puede escalar privilegios
select pg_temp.como('admin', 'aal2');
select throws_ok($$update public.perfiles set rol_id = (select id from public.roles where codigo = 'superadmin')
                   where id = (select id from u where clave = 'cb')$$,
  '42501', null, 'Admin con permiso de usuarios no puede asignar el rol Superadmin');
select throws_ok($$update public.perfiles set rol_id = (select id from public.roles where codigo = 'contratista'),
                   empresa_id = (select id from public.empresas where ruc = '20999999019') where id = auth.uid()$$,
  '42501', null, 'Nadie (salvo Superadmin) cambia su propio rol');
select throws_ok($$update public.perfiles set correo = 'otro@x.com' where id = (select id from u where clave = 'cb')$$,
  '42501', null, 'El correo del perfil no se edita desde la app');
select throws_ok($$select public.registrar_evento('cambio_password')$$,
  '22023', null, 'Nadie puede marcar su contraseña como cambiada sin cambiarla');
select pg_temp.reset();

-- La obligación de cambiar contraseña solo se levanta cuando Auth guarda una nueva.
update public.perfiles set debe_cambiar_password = true where id = (select id from u where clave = 'cb');
update auth.users set encrypted_password = 'hash-nuevo' where id = (select id from u where clave = 'cb');
select is((select debe_cambiar_password from public.perfiles where id = (select id from u where clave = 'cb')), false,
  'Guardar una contraseña nueva levanta la obligación de cambiarla');
select ok(exists (select 1 from public.auditoria where accion = 'cambio_password' and usuario_id = (select id from u where clave = 'cb')),
  'El cambio de contraseña queda en la auditoría');

select ok(exists (select 1 from public.auditoria where entidad = 'rol_permisos' and accion = 'insert'
                  and usuario_id = (select id from u where clave = 'sa')),
  'La auditoría registra quién cambió los permisos');

select * from finish();
rollback;
