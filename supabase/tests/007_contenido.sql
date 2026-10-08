-- Pruebas de documentos, alertas y Contáctanos (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

create temporary table u (clave text primary key, id uuid);
grant select on u to authenticated;
insert into u values ('ca', gen_random_uuid()), ('cb', gen_random_uuid()), ('ad', gen_random_uuid()), ('sa', gen_random_uuid());
insert into auth.users (id, email, raw_app_meta_data)
select id, clave || '@prueba.example.com',
  case clave
    when 'ca' then jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999019'))
    when 'cb' then jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999027'))
    when 'ad' then jsonb_build_object('rol_codigo', 'admin')
    else jsonb_build_object('rol_codigo', 'superadmin')
  end
from u;

create or replace function pg_temp.como(p_clave text, p_aal text default 'aal1', p_sesion text default 's1') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from u where clave = p_clave), 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sesion)::text, true);
end $$;
create or replace function pg_temp.objeto(p_bucket text, p_nombre text, p_duenio text, p_tamano bigint, p_mime text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (p_bucket, p_nombre, (select id::text from u where clave = p_duenio), jsonb_build_object('size', p_tamano, 'mimetype', p_mime));
$$;

-- 1-5. Quién ve y quién publica
select pg_temp.como('ca');
select ok(seguridad.puede_ver_documento('menu_1'), 'El contratista ve el menú semanal');
select ok(not seguridad.puede_editar_documento('menu_1'), 'El contratista no publica el menú');
select pg_temp.como('ad', 'aal2');
select ok(seguridad.puede_editar_documento('menu_2'), 'El Admin publica el menú');
select ok(not seguridad.puede_editar_documento('terminos'), 'El Admin no publica términos y condiciones');
select pg_temp.como('sa', 'aal2');
select ok(seguridad.puede_editar_documento('terminos'), 'El Superadmin publica términos y condiciones');

-- 6-11. Versiones
set local role postgres;
select pg_temp.objeto('documentos', 'menu_1/11111111-1111-1111-1111-111111111111.pdf', 'ad', 500000, 'application/pdf');
select pg_temp.objeto('documentos', 'menu_1/22222222-2222-2222-2222-222222222222.pdf', 'ad', 600000, 'application/pdf');
select pg_temp.objeto('documentos', 'menu_1/33333333-3333-3333-3333-333333333333.pdf', 'ad', 2000000, 'application/pdf');
select pg_temp.objeto('documentos', 'menu_2/44444444-4444-4444-4444-444444444444.pdf', 'sa', 1000, 'application/pdf');
select pg_temp.como('ad', 'aal2');
select lives_ok($$select public.registrar_documento('menu_1', 'menu_1/11111111-1111-1111-1111-111111111111.pdf', 'menu.pdf', 'Menú semana 41')$$,
  'Publicar la primera versión');
select lives_ok($$select public.registrar_documento('menu_1', 'menu_1/22222222-2222-2222-2222-222222222222.pdf', 'menu2.pdf', 'Menú semana 42')$$,
  'Publicar una nueva versión');
select is((select string_agg(version || ':' || vigente, ',' order by version) from public.documentos where tipo = 'menu_1'),
  '1:false,2:true', 'Solo la última versión queda vigente');
select throws_ok($$select public.registrar_documento('menu_1', 'menu_1/33333333-3333-3333-3333-333333333333.pdf', 'grande.pdf', 'Grande')$$,
  '22023', null, 'El menú no puede pasar de 1 MB');
select throws_ok($$select public.registrar_documento('menu_2', 'menu_2/44444444-4444-4444-4444-444444444444.pdf', 'ajeno.pdf', 'Ajeno')$$,
  '22023', null, 'Solo se publica un archivo subido por el mismo usuario');
select pg_temp.como('ca');
select is((select count(*)::int from public.documentos), 1, 'El contratista ve solo la versión vigente');

-- 12-13. Storage: el contratista no sube documentos; el Admin sí
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('documentos', 'menu_1/55555555-5555-5555-5555-555555555555.pdf', auth.uid()::text, '{}')$$,
  '42501', null, 'El contratista no sube PDFs del menú');
select pg_temp.como('ad', 'aal2');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('documentos', 'menu_2/66666666-6666-6666-6666-666666666666.pdf', auth.uid()::text, '{}')$$,
  'El Admin sube el PDF del menú');

-- 14-19. Alertas
select pg_temp.como('ca');
select throws_ok($$insert into public.alertas (titulo, contenido, desde, hasta, roles) values ('x', 'y', now(), now() + interval '1 day', '{contratista}')$$,
  '42501', null, 'El contratista no crea alertas');
select pg_temp.como('sa', 'aal2');
insert into public.alertas (titulo, contenido, desde, hasta, roles, una_vez) values
  ('Una vez', 'Aviso', now() - interval '1 hour', now() + interval '1 day', '{contratista}', true),
  ('Cada login', 'Recordatorio', now() - interval '1 hour', now() + interval '1 day', '{contratista}', false),
  ('Futura', 'Aún no', now() + interval '1 day', now() + interval '2 days', '{contratista}', false),
  ('Solo admin', 'Otro rol', now() - interval '1 hour', now() + interval '1 day', '{admin}', false);
select pg_temp.como('ca', 'aal1', 's1');
select is((select string_agg(titulo, ',' order by titulo) from public.mis_alertas()), 'Cada login,Una vez',
  'El contratista ve solo las alertas vigentes de su rol');
select public.marcar_alertas_vistas(array(select id from public.mis_alertas()));
select is((select count(*)::int from public.mis_alertas()), 0, 'Vistas en esta sesión, ya no se muestran');
select pg_temp.como('ca', 'aal1', 's2');
select is((select string_agg(titulo, ',') from public.mis_alertas()), 'Cada login',
  'En un nuevo login vuelve solo la de "cada login"');
select throws_ok($$insert into public.alertas_vistas (alerta_id, usuario_id) select id, auth.uid() from public.alertas limit 1$$,
  '42501', null, 'Las vistas solo se registran por la función');
select pg_temp.como('sa', 'aal2');
select throws_ok($$insert into public.alertas (titulo, contenido, desde, hasta, roles) values ('x', 'y', now(), now() + interval '1 day', '{inventado}')$$,
  '22023', null, 'Los roles de la alerta deben existir');

-- 20-28. Contáctanos
select pg_temp.como('ca');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('contacto', auth.uid()::text || '/77777777-7777-7777-7777-777777777777.pdf', auth.uid()::text, '{"size": 2048, "mimetype": "application/pdf"}')$$,
  'El contratista sube un adjunto en su carpeta');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('contacto', (select id::text from u where clave = 'cb') || '/88888888-8888-8888-8888-888888888888.pdf', auth.uid()::text, '{}')$$,
  '42501', null, 'No sube en la carpeta de otro usuario');
create temporary table m1 as
select public.enviar_contacto(array['Uno@Example.com', 'dos@example.com'], 'Consulta', 'Hola, una consulta.',
  jsonb_build_array(jsonb_build_object('ruta', (select id::text from u where clave = 'ca') || '/77777777-7777-7777-7777-777777777777.pdf', 'nombre', 'carta.pdf')),
  '99999999-9999-9999-9999-999999999999') as id;
grant select on m1 to authenticated;
select is(public.enviar_contacto(array['uno@example.com'], 'Otra', 'Otra', '[]', '99999999-9999-9999-9999-999999999999'),
  (select id from m1), 'Repetir el envío no lo duplica');
set local role postgres;
select is((select count(*)::int from public.correo_destinatarios d join public.mensajes_contacto m on m.correo_id = d.correo_id
           where m.id = (select id from m1)), 4, 'Va al destinatario, a las 2 copias y al remitente');
select is((select jsonb_array_length(c.adjuntos) || '|' || c.responder_a from public.correos_pendientes c
           join public.mensajes_contacto m on m.correo_id = c.id where m.id = (select id from m1)),
  '1|ca@prueba.example.com', 'El correo lleva el adjunto y "responder a" del remitente');
select pg_temp.como('ca');
select throws_ok($$select public.enviar_contacto('{}', 'Otra', 'Otra',
  jsonb_build_array(jsonb_build_object('ruta', (select id::text from u where clave = 'ca') || '/77777777-7777-7777-7777-777777777777.pdf', 'nombre', 'carta.pdf')),
  gen_random_uuid())$$, '22023', 'Un adjunto ya fue usado', 'Un adjunto no se usa dos veces');
select throws_ok($$select public.enviar_contacto(array['a@x.com','b@x.com','c@x.com','d@x.com','e@x.com','f@x.com'], 'A', 'B', '[]', gen_random_uuid())$$,
  '22023', null, 'Máximo 5 copias');
select throws_ok($$select public.enviar_contacto(array['no-es-correo'], 'A', 'B', '[]', gen_random_uuid())$$,
  '22023', 'Hay una dirección en copia que no es válida', 'Copias con formato válido');
set local role postgres;
update public.configuracion set valor = '1' where clave = 'contacto.max_por_hora';
select pg_temp.como('ca');
select throws_ok($$select public.enviar_contacto('{}', 'A', 'B', '[]', gen_random_uuid())$$,
  '22023', null, 'Límite de mensajes por hora');
select pg_temp.como('cb');
select is((select count(*)::int from public.mensajes_contacto), 0, 'Otro contratista no ve los mensajes ajenos');

-- 30. El contratista solo descarga la versión vigente del menú
select pg_temp.como('ca');
select is((select string_agg(name, ',') from storage.objects where bucket_id = 'documentos'),
  'menu_1/22222222-2222-2222-2222-222222222222.pdf', 'El contratista ve solo el archivo vigente, no versiones anteriores');

-- 31-33. Adjuntos: el nombre lleva la extensión real y el tipo debe coincidir con la ruta
set local role postgres;
update public.configuracion set valor = '10' where clave = 'contacto.max_por_hora';
select pg_temp.objeto('contacto', (select id::text from u where clave = 'ca') || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf', 'ca', 100, 'application/pdf');
select pg_temp.objeto('contacto', (select id::text from u where clave = 'ca') || '/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf', 'ca', 100, 'image/png');
select pg_temp.como('ca');
create temporary table m2 as
select public.enviar_contacto('{}', 'Factura', 'Adjunto factura',
  jsonb_build_array(jsonb_build_object('ruta', (select id::text from u where clave = 'ca') || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf', 'nombre', 'factura.hta')),
  gen_random_uuid()) as id;
select is((select m.adjuntos -> 0 ->> 'nombre' from public.mensajes_contacto m where m.id = (select id from m2)), 'factura.pdf',
  'El nombre del adjunto lleva la extensión del tipo real');
select throws_ok($$select public.enviar_contacto('{}', 'A', 'B',
  jsonb_build_array(jsonb_build_object('ruta', (select id::text from u where clave = 'ca') || '/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf', 'nombre', 'x.pdf')),
  gen_random_uuid())$$, '22023', 'Un adjunto no es válido', 'El tipo declarado debe coincidir con la extensión');
set local role postgres;
update public.plantillas_correo set activo = false where codigo = 'contacto';
select pg_temp.como('ca');
select throws_ok($$select public.enviar_contacto('{}', 'A', 'B', '[]', gen_random_uuid())$$,
  '22023', 'El envío de mensajes no está disponible en este momento', 'Sin plantilla activa no se da por enviado');

select * from finish();
rollback;
