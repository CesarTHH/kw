-- Pruebas del módulo de correos (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create temporary table u (clave text primary key, id uuid);
grant select on u to authenticated;
insert into u values ('sa', gen_random_uuid()), ('admin', gen_random_uuid()), ('ca', gen_random_uuid());

update public.configuracion set valor = '"buzon@interno.example.com"' where clave = 'correo.cco_interno';

insert into auth.users (id, email, raw_app_meta_data)
select id, clave || '@prueba.example.com',
  case clave
    when 'sa'    then jsonb_build_object('rol_codigo', 'superadmin', 'nombre', 'Super')
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

-- 1-3. Cuenta creada
select is((select count(*)::int from public.correos_pendientes where plantilla = 'usuario_creado'
           and datos ->> 'correo_usuario' like '%@prueba.example.com'), 3,
  'Crear una cuenta con rol encola el correo de bienvenida');
select ok(exists (select 1 from public.correo_destinatarios d join public.correos_pendientes c on c.id = d.correo_id
                  where c.plantilla = 'usuario_creado' and d.correo = 'sa@prueba.example.com' and d.tipo = 'para'),
  'El destinatario es el propio usuario');
select ok(exists (select 1 from public.correo_destinatarios d join public.correos_pendientes c on c.id = d.correo_id
                  where c.plantilla = 'usuario_creado' and d.correo = 'buzon@interno.example.com' and d.tipo = 'cco'),
  'Se agrega la copia oculta interna');

insert into auth.users (id, email, raw_app_meta_data)
values (gen_random_uuid(), 'aprobado@prueba.example.com',
        jsonb_build_object('rol_codigo', 'contratista', 'solicitud_id', gen_random_uuid(),
                           'empresa_id', (select id from public.empresas where ruc = '20999999019')));
select is((select plantilla from public.correos_pendientes where datos ->> 'correo_usuario' = 'aprobado@prueba.example.com'),
  'registro_aprobado', 'Una cuenta creada desde una solicitud usa la plantilla de aprobación');

-- 5-8. Encolar con contactos, duplicados y suprimidos
insert into public.correos_suprimidos (correo, motivo) values ('rebota@prueba.example.com', 'rebote');
create temporary table c1 as
select seguridad.encolar_correo('programacion_raciones', '{"registros":[]}',
  array['Usuario@Prueba.example.com', 'usuario@prueba.example.com', 'rebota@prueba.example.com', 'no-es-correo'],
  (select id from public.empresas where ruc = '20999999019'), null, true) as id;
grant select on c1 to authenticated;
select is((select count(*)::int from public.correo_destinatarios where correo_id = (select id from c1) and correo = 'usuario@prueba.example.com'),
  1, 'No se repite un destinatario (mayúsculas/minúsculas)');
select is((select estado from public.correo_destinatarios where correo_id = (select id from c1) and correo = 'rebota@prueba.example.com'),
  'suprimido', 'Una dirección que rebotó no se vuelve a usar');
select ok((select count(*) from public.correo_destinatarios where correo_id = (select id from c1) and tipo = 'cc') between 1 and 5,
  'Se suman los contactos de la empresa que reciben notificaciones (máximo 5)');
select is((select datos ->> 'ruc' from public.correos_pendientes where id = (select id from c1)), '20999999019',
  'Se completan empresa y RUC para la plantilla');

-- 9. Sin destinatarios válidos
create temporary table c2 as
select seguridad.encolar_correo('programacion_raciones', '{}', array['rebota@prueba.example.com']) as id;
select is((select estado from public.correos_pendientes where id = (select id from c2)),
  'fallido', 'Sin destinatarios válidos el correo queda como fallido');

-- 10. Registro recibido
insert into public.solicitudes_registro (ruc, razon_social, usuario_nombre, usuario_correo, frentes, contactos, acepta_tyc)
values ('20999999035', 'Nueva SAC', 'Ana', 'ana@prueba.example.com', '[{}]', '[{}]', true);
select ok(exists (select 1 from public.correos_pendientes c join public.correo_destinatarios d on d.correo_id = c.id
                  where c.plantilla = 'registro_recibido' and d.correo = 'ana@prueba.example.com'),
  'Registrar una solicitud encola el aviso de recepción');

-- 11-15. Permisos
set local role anon;
select throws_ok('select * from public.correos_pendientes', '42501', null, 'anon no lee correos');
reset role;
select pg_temp.como('ca');
select is((select count(*)::int from public.correos_pendientes), 0, 'Contratista no ve el historial de correos');
select throws_ok($$select seguridad.encolar_correo('contacto', '{}', array['x@prueba.example.com'])$$,
  '42501', null, 'Un usuario no puede encolar correos directamente');
select throws_ok($$select * from public.correos_tomar_lote(5)$$, '42501', null, 'Un usuario no puede tomar la cola de envío');
select throws_ok($$select public.reenviar_correo((select id from c1))$$, '42501', null, 'Contratista no puede reenviar');

-- 16-19. Superadmin
select pg_temp.como('sa');
select ok((select count(*) from public.correos_pendientes) > 0, 'Superadmin ve el historial');
select lives_ok($$select public.reenviar_correo((select id from c1))$$, 'Superadmin reenvía un correo');
select is((select count(*)::int from public.correos_pendientes where reenvio_de = (select id from c1)), 1,
  'El reenvío queda enlazado al original');
select lives_ok($$update public.plantillas_correo set asunto = 'Nuevo asunto {{ruc}}' where codigo = 'contacto'$$,
  'Superadmin edita una plantilla');

-- 20. Admin no edita plantillas
select pg_temp.como('admin');
update public.plantillas_correo set asunto = 'hack' where codigo = 'contacto';
select pg_temp.reset();
select is((select asunto from public.plantillas_correo where codigo = 'contacto'), 'Nuevo asunto {{ruc}}',
  'Admin no puede editar plantillas');

-- 21-22. Rechazo y cola
select pg_temp.como('sa');
select public.rechazar_solicitud((select id from public.solicitudes_registro where usuario_correo = 'ana@prueba.example.com'), 'Datos incompletos');
select pg_temp.reset();
select ok(exists (select 1 from public.correos_pendientes where plantilla = 'registro_rechazado' and datos ->> 'motivo' = 'Datos incompletos'),
  'Rechazar una solicitud encola el correo con el motivo');
create temporary table lote as select * from public.correos_tomar_lote(100);
select ok((select count(*) from lote) > 0 and not exists (select 1 from public.correos_pendientes where estado = 'pendiente'),
  'El envío toma los correos pendientes y los marca como en proceso');

select * from finish();
rollback;
