-- Pruebas de raciones: plazos, envíos, saldos, traslados y seguridad (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- ---------------------------------------------------------------------------
-- 1-11. Plazos con una hora fija (mismos casos que src/lib/raciones/plazos.test.ts)
-- ---------------------------------------------------------------------------
select is(seguridad.validar_plazo('adicion', '2026-10-15', '2026-10-14 16:59:59'), null, 'Adición: 16:59:59 del día anterior, sí');
select is(seguridad.validar_plazo('adicion', '2026-10-15', '2026-10-14 17:00:00'),
  'El plazo para adicionales del 15/10 venció el 14/10 a las 17:00', 'Adición: 17:00:00 del día anterior, no');
select is(seguridad.validar_plazo('reduccion', '2026-10-15', '2026-10-12 23:59:59'), null, 'Reducción: 48 h antes, sí');
select is(seguridad.validar_plazo('reduccion', '2026-10-15', '2026-10-13 00:00:00'),
  'El plazo para reducir el 15/10 venció el 12/10 a las 23:59', 'Reducción: dentro de las 48 h, no');
select is(seguridad.validar_plazo('traslado', '2027-01-02', '2026-12-31 00:00'),
  'El plazo para trasladar el 02/01 venció el 30/12 a las 23:59', 'Traslado: fin de año');
select is(seguridad.validar_plazo('programacion', '2026-10-12', '2026-10-07 23:59:59'), null, 'Programación: miércoles 23:59:59, sí');
select is(seguridad.validar_plazo('programacion', '2026-10-12', '2026-10-08 00:00:00'),
  'La programación de la semana del 12/10 cerró el miércoles 07/10 a las 23:59: usa Adiciona / Reduce',
  'Programación: jueves 00:00, la semana siguiente ya cerró');
select is(seguridad.validar_plazo('programacion', '2026-10-19', '2026-10-08 10:00'), null, 'Programación: la semana subsiguiente sigue abierta');
select is(seguridad.validar_plazo('programacion', '2026-11-23', '2026-10-07 10:00'),
  'Solo se puede programar hasta el 22/11 (6 semanas)', 'Programación: máximo 6 semanas');
select is(seguridad.validar_plazo('programacion', '2026-10-09', '2026-10-05 08:00'),
  'La semana en curso no se programa: para el 09/10 usa Adiciona / Reduce', 'Programación: semana en curso no');
select is(seguridad.validar_plazo('programacion', '2026-10-01', '2026-10-07 10:00'), 'El 01/10 ya pasó', 'Programación: fecha pasada');

-- ---------------------------------------------------------------------------
-- Preparación
-- ---------------------------------------------------------------------------
create temporary table u (clave text primary key, id uuid);
grant select on u to authenticated;
insert into u values ('sa', gen_random_uuid()), ('ca', gen_random_uuid()), ('cb', gen_random_uuid()), ('com', gen_random_uuid());
insert into auth.users (id, email, raw_app_meta_data)
select id, clave || '@prueba.example.com',
  case clave
    when 'sa'  then jsonb_build_object('rol_codigo', 'superadmin')
    when 'ca'  then jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999019'))
    when 'cb'  then jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999027'))
    else jsonb_build_object('rol_codigo', 'comedor', 'comedor_id', (select id from public.comedores where nombre = 'KM 52'))
  end
from u;

-- Ids y fechas útiles (hoy en la zona oficial)
create temporary table k as
select
  (select id from public.empresas where ruc = '20999999019') as alfa,
  (select id from public.empresas where ruc = '20999999027') as beta,
  (select id from public.frentes_trabajo where nombre = 'FRENTE DEMO 1') as f1,
  (select id from public.frentes_trabajo where nombre = 'FRENTE DEMO 3') as f3,
  (select id from public.comedores where nombre = 'KM 52') as km52,
  (select id from public.comedores where nombre = 'KM 37') as km37,
  (select id from public.comedores where nombre = 'TALLERES I') as talleres,
  (select id from public.comedores where nombre = 'QUINUA COMPLEX') as quinua,
  (select id from public.servicios where nombre = 'ALMUERZO') as almuerzo,
  (select id from public.servicios where nombre = 'CENA') as cena,
  (select id from public.servicios where nombre = 'DESAYUNO') as desayuno,
  (now() at time zone 'America/Lima')::date as hoy,
  ((now() at time zone 'America/Lima')::date - (extract(isodow from (now() at time zone 'America/Lima')::date)::int - 1) + 14) as prog,
  ((now() at time zone 'America/Lima')::date + 3) as d3,
  gen_random_uuid() as clave1;
grant select on k to authenticated;

create or replace function pg_temp.como(p_clave text, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from u where clave = p_clave), 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;
create or replace function pg_temp.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Una fila de envío
create or replace function pg_temp.fila(p_fecha date, p_frente uuid, p_comedor uuid, p_servicio uuid, p_cant int,
                                        p_comedor_d uuid default null, p_servicio_d uuid default null)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'fecha', p_fecha, 'frente_id', p_frente, 'comedor_id', p_comedor, 'servicio_id', p_servicio, 'cantidad', p_cant,
    'comedor_destino_id', p_comedor_d, 'servicio_destino_id', p_servicio_d)));
$$;
create or replace function pg_temp.saldo(p_fecha date, p_comedor uuid, p_servicio uuid) returns int language sql as $$
  select coalesce((select cantidad from public.racion_saldos
    where empresa_id = (select alfa from k) and fecha = p_fecha and frente_id = (select f1 from k)
      and comedor_id = p_comedor and servicio_id = p_servicio), 0);
$$;

-- ---------------------------------------------------------------------------
-- 12-16. Contratista A: programa, adiciona y reduce
-- ---------------------------------------------------------------------------
select pg_temp.como('ca');
create temporary table e1 as
select public.enviar_raciones('programacion', (select alfa from k),
  pg_temp.fila((select prog from k), (select f1 from k), (select km52 from k), (select almuerzo from k), 5),
  (select clave1 from k)) as id;
select is(pg_temp.saldo((select prog from k), (select km52 from k), (select almuerzo from k)), 5, 'Programar suma al saldo');
select is(public.enviar_raciones('programacion', (select alfa from k),
  pg_temp.fila((select prog from k), (select f1 from k), (select km52 from k), (select almuerzo from k), 5),
  (select clave1 from k)), (select id from e1), 'Repetir el envío (doble clic) devuelve el mismo envío');
select is(pg_temp.saldo((select prog from k), (select km52 from k), (select almuerzo from k)), 5, 'El envío repetido no suma dos veces');
select throws_ok($$select public.enviar_raciones('programacion', (select alfa from k),
  pg_temp.fila((select prog from k), (select f1 from k), (select km52 from k), (select almuerzo from k), 7),
  (select clave1 from k))$$, '22023', null, 'La misma clave con otro contenido se rechaza');

select lives_ok($$select public.enviar_raciones('adicion_reduccion', (select alfa from k),
  pg_temp.fila((select d3 from k), (select f1 from k), (select km52 from k), (select almuerzo from k), 3), gen_random_uuid())$$,
  'Adición dentro de plazo');
select throws_ok($$select public.enviar_raciones('adicion_reduccion', (select alfa from k),
  pg_temp.fila((select d3 from k), (select f1 from k), (select km52 from k), (select almuerzo from k), -5), gen_random_uuid())$$,
  '22023', null, 'No se puede reducir más de lo registrado');
select lives_ok($$select public.enviar_raciones('adicion_reduccion', (select alfa from k),
  pg_temp.fila((select d3 from k), (select f1 from k), (select km52 from k), (select almuerzo from k), -2), gen_random_uuid())$$,
  'Reducción dentro de lo registrado');
select is(pg_temp.saldo((select d3 from k), (select km52 from k), (select almuerzo from k)), 1, 'El saldo queda en 3 - 2 = 1');

-- ---------------------------------------------------------------------------
-- 19-25. Reglas
-- ---------------------------------------------------------------------------
select throws_ok($$select public.enviar_raciones('programacion', (select alfa from k),
  pg_temp.fila((select prog from k), (select f3 from k), (select km52 from k), (select almuerzo from k), 1), gen_random_uuid())$$,
  '22023', null, 'No se usa un frente que no está asignado a la empresa');
select throws_ok($$select public.enviar_raciones('programacion', (select alfa from k),
  pg_temp.fila((select prog from k), (select f1 from k), (select quinua from k), (select desayuno from k), 1), gen_random_uuid())$$,
  '22023', null, 'No se pide un servicio que el comedor no ofrece');
select throws_ok($$select public.enviar_raciones('traslado', (select alfa from k),
  pg_temp.fila((select d3 from k), (select f1 from k), (select km52 from k), (select almuerzo from k), 1, (select km37 from k), (select almuerzo from k)),
  gen_random_uuid())$$, '22023', null, 'No se traslada a un comedor de otro sector');
select throws_ok($$select public.enviar_raciones('traslado', (select alfa from k),
  pg_temp.fila((select d3 from k), (select f1 from k), (select km52 from k), (select almuerzo from k), 1, (select km52 from k), (select cena from k)),
  gen_random_uuid())$$, '22023', null, 'No se traslada almuerzo a cena');
select lives_ok($$select public.enviar_raciones('traslado', (select alfa from k),
  pg_temp.fila((select d3 from k), (select f1 from k), (select km52 from k), (select almuerzo from k), 1, (select talleres from k), (select almuerzo from k)),
  gen_random_uuid())$$, 'Traslado válido dentro del mismo sector');
select ok(pg_temp.saldo((select d3 from k), (select km52 from k), (select almuerzo from k)) = 0
          and pg_temp.saldo((select d3 from k), (select talleres from k), (select almuerzo from k)) = 1,
  'El traslado mueve la cantidad del origen al destino');
select throws_ok($$select public.enviar_raciones('programacion', (select alfa from k),
  pg_temp.fila((select hoy from k) + 1, (select f1 from k), (select km52 from k), (select almuerzo from k), 1), gen_random_uuid())$$,
  '22023', null, 'Fuera de plazo no se puede programar');

-- ---------------------------------------------------------------------------
-- 26-28. Permisos
-- ---------------------------------------------------------------------------
select throws_ok($$select public.enviar_raciones('programacion', (select alfa from k),
  pg_temp.fila((select hoy from k) + 1, (select f1 from k), (select km52 from k), (select almuerzo from k), 1), gen_random_uuid(), 'Pedido urgente')$$,
  '42501', null, 'Solo el Superadmin indica motivo para registrar fuera de plazo');
select throws_ok($$insert into public.racion_saldos (empresa_id, fecha, frente_id, comedor_id, servicio_id, cantidad)
                   select alfa, prog, f1, km52, almuerzo, 100 from k$$,
  '42501', null, 'Nadie escribe saldos directamente');
select pg_temp.como('cb');
select throws_ok($$select public.enviar_raciones('programacion', (select alfa from k),
  pg_temp.fila((select prog from k), (select f1 from k), (select km52 from k), (select almuerzo from k), 1), gen_random_uuid())$$,
  '42501', null, 'Una empresa no registra raciones para otra');
select is((select count(*)::int from public.racion_saldos where empresa_id = (select alfa from k)), 0,
  'Contratista B no ve las raciones de A');

-- ---------------------------------------------------------------------------
-- 30-31. Superadmin fuera de plazo y vista de comedor
-- ---------------------------------------------------------------------------
select pg_temp.como('sa', 'aal2');
create temporary table e2 as
select public.enviar_raciones('programacion', (select alfa from k),
  pg_temp.fila((select hoy from k) + 1, (select f1 from k), (select km52 from k), (select almuerzo from k), 2),
  gen_random_uuid(), 'Pedido urgente aprobado por gerencia') as id;
grant select on e2 to authenticated;
select ok((select fuera_de_plazo from public.envios where id = (select id from e2)),
  'El Superadmin registra fuera de plazo con motivo y queda marcado');

select pg_temp.como('com');
select ok((select count(*) from public.racion_saldos) > 0
          and not exists (select 1 from public.racion_saldos where comedor_id <> (select km52 from k)),
  'El usuario de comedor solo ve las raciones de su comedor');

-- ---------------------------------------------------------------------------
-- 32-34. Correo, auditoría y borradores
-- ---------------------------------------------------------------------------
select pg_temp.reset();
select ok(exists (select 1 from public.correos_pendientes c
                  where c.envio_id = (select id from e1) and c.plantilla = 'programacion_raciones'
                    and jsonb_array_length(c.datos -> 'registros') = 1 and c.datos ->> 'ruc' = '20999999019'),
  'El envío deja en cola el correo con la tabla de registros');
select ok(exists (select 1 from public.auditoria where accion = 'enviar_programacion' and entidad_id = (select id from e1)::text),
  'El envío queda en la auditoría');

select pg_temp.como('ca');
insert into public.borradores (empresa_id, modulo, filas) select alfa, 'programar', '[{"x":1}]' from k;
select throws_ok($$insert into public.borradores (usuario_id, empresa_id, modulo, filas)
                   select (select id from u where clave = 'cb'), alfa, 'programar', '[]' from k$$,
  '42501', null, 'Nadie guarda borradores a nombre de otro usuario');

select pg_temp.reset();
select * from finish();
rollback;
