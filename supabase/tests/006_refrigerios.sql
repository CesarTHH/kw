-- Pruebas de refrigerios (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- 1-4. Plazos
select is(seguridad.validar_plazo('refrigerio', '2026-10-15', '2026-10-14 16:59:59'), null, 'Refrigerio: hasta las 16:59:59 del día anterior');
select is(seguridad.validar_plazo('refrigerio', '2026-10-15', '2026-10-14 17:00'),
  'El plazo para refrigerios del 15/10 venció el 14/10 a las 17:00', 'Refrigerio: desde las 17:00 ya no');
select is(seguridad.validar_plazo('refrigerio_reduccion', '2026-10-15', '2026-10-12 23:59'), null, 'Reducción de refrigerio: 48 h antes, sí');
select is(seguridad.validar_plazo('refrigerio_reduccion', '2026-10-15', '2026-10-13 00:00'),
  'El plazo para reducir refrigerios el 15/10 venció el 12/10 a las 23:59', 'Reducción de refrigerio: dentro de las 48 h, no');

create temporary table u (clave text primary key, id uuid);
grant select on u to authenticated;
insert into u values ('ca', gen_random_uuid()), ('cb', gen_random_uuid()), ('sa', gen_random_uuid());
insert into auth.users (id, email, raw_app_meta_data)
select id, clave || '@prueba.example.com',
  case clave
    when 'ca' then jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999019'))
    when 'cb' then jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999027'))
    else jsonb_build_object('rol_codigo', 'superadmin')
  end
from u;

create temporary table k as
select
  (select id from public.empresas where ruc = '20999999019') as alfa,
  (select id from public.comedores where nombre = 'KM 37') as km37,
  (select id from public.comedores where nombre = 'QUINUA COMPLEX') as quinua,
  (select id from public.refrigerio_turnos where hora = '18:00') as turno,
  (select id from public.refrigerio_productos where nombre = 'FRUTA') as fruta,
  (select id from public.refrigerio_productos where nombre = 'GASEOSA') as gaseosa,
  ((now() at time zone 'America/Lima')::date + 3) as d3,
  gen_random_uuid() as clave1;
grant select on k to authenticated;

create or replace function pg_temp.como(p_clave text, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from u where clave = p_clave), 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;
create or replace function pg_temp.pedido(p_fecha date, p_comedor uuid, p_tipo text, p_cant int, p_items jsonb default '[]')
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('fecha', p_fecha, 'comedor_id', p_comedor, 'turno_id', (select turno from k),
    'tipo', p_tipo, 'cantidad', p_cant, 'encargado', 'Nixon Mendoza', 'items', p_items));
$$;

-- 5-9. Estándar
select pg_temp.como('ca');
create temporary table e1 as
select public.enviar_refrigerios((select alfa from k), pg_temp.pedido((select d3 from k), (select km37 from k), 'estandar', 4), (select clave1 from k)) as id;
grant select on e1 to authenticated;
select is((select precio_unitario from public.refrigerio_pedidos where envio_id = (select id from e1)), 29.78::numeric,
  'El estándar toma el precio vigente');
select ok((select composicion from public.refrigerio_pedidos where envio_id = (select id from e1)) like '2 SANDWICH CÁRNICO EN PAPEL DE SEDA%',
  'La composición del estándar queda congelada en el pedido');
select is(public.enviar_refrigerios((select alfa from k), pg_temp.pedido((select d3 from k), (select km37 from k), 'estandar', 4), (select clave1 from k)),
  (select id from e1), 'Repetir el envío no lo duplica');
select is((select count(*)::int from public.refrigerio_pedidos where empresa_id = (select alfa from k)), 1, 'Hay un solo pedido');
set local role postgres;
select ok(exists (select 1 from public.correos_pendientes c where c.envio_id = (select id from e1) and c.plantilla = 'solicitud_refrigerios'
                  and c.datos -> 'registros' -> 0 ->> 'precio' = 'S/ 119,12'),
  'El correo lleva la tabla con el precio total (4 x 29,78)');
select pg_temp.como('ca');

-- 10-11. Estándar + especial: los productos se suman a cada refrigerio
select lives_ok($$select public.enviar_refrigerios((select alfa from k),
  pg_temp.pedido((select d3 from k), (select km37 from k), 'estandar_mas_especial', 10,
    jsonb_build_array(jsonb_build_object('producto_id', (select fruta from k), 'cantidad', 5))), gen_random_uuid())$$,
  'Estándar con productos especiales');
select is((select precio_unitario from public.refrigerio_pedidos where tipo = 'estandar_mas_especial'), 37.28::numeric,
  'Precio por refrigerio = estándar 29,78 + 5 frutas x 1,50');

-- 12-15. Reglas
select throws_ok($$select public.enviar_refrigerios((select alfa from k),
  pg_temp.pedido((select d3 from k), (select quinua from k), 'estandar', 1), gen_random_uuid())$$,
  '22023', null, 'Solo comedores habilitados para refrigerios');
select throws_ok($$select public.enviar_refrigerios((select alfa from k),
  pg_temp.pedido((now() at time zone 'America/Lima')::date, (select km37 from k), 'estandar', 1), gen_random_uuid())$$,
  '22023', null, 'No se piden refrigerios para hoy');
select throws_ok($$select public.enviar_refrigerios((select alfa from k),
  pg_temp.pedido((select d3 from k), (select km37 from k), 'especial', 1), gen_random_uuid())$$,
  '22023', null, 'Un especial necesita productos');
select throws_ok($$insert into public.refrigerio_productos (nombre) values ('X')$$, '42501', null,
  'Un contratista no edita el catálogo de productos');

-- 16-17. Reducción
select lives_ok($$select public.reducir_refrigerio((select id from public.refrigerio_pedidos where envio_id = (select id from e1)), 3, gen_random_uuid())$$,
  'Reducción dentro de plazo');
select throws_ok($$select public.reducir_refrigerio((select id from public.refrigerio_pedidos where envio_id = (select id from e1)), 2, gen_random_uuid())$$,
  '22023', null, 'No se reduce más de lo vigente (quedaba 1)');

-- 18. Otra empresa no ve los pedidos
select pg_temp.como('cb');
select is((select count(*)::int from public.refrigerio_pedidos), 0, 'Contratista B no ve los refrigerios de A');

-- 19-20. Alcance y motivo
select throws_ok($$select public.enviar_refrigerios((select alfa from k),
  pg_temp.pedido((select d3 from k), (select km37 from k), 'estandar', 1), gen_random_uuid())$$,
  '42501', null, 'Contratista B no pide refrigerios a nombre de A');
select pg_temp.como('ca');
select throws_ok($$select public.enviar_refrigerios((select alfa from k),
  pg_temp.pedido((select d3 from k), (select km37 from k), 'estandar', 1), gen_random_uuid(), 'Pedido urgente')$$,
  '42501', null, 'Solo el Superadmin envía con motivo');

-- 21. Producto repetido
select throws_ok($$select public.enviar_refrigerios((select alfa from k),
  pg_temp.pedido((select d3 from k), (select km37 from k), 'especial', 1,
    jsonb_build_array(jsonb_build_object('producto_id', (select fruta from k), 'cantidad', 80),
                      jsonb_build_object('producto_id', (select fruta from k), 'cantidad', 80))), gen_random_uuid())$$,
  '22023', 'El pedido 1 repite un producto', 'Un producto no se repite dentro del pedido');

-- 22. Envíos por módulo: los de refrigerios no se ven sin el permiso de refrigerios
set local role postgres;
create temporary table rol_ca as select rol_id from public.perfiles where id = (select id from u where clave = 'ca');
delete from public.rol_permisos where menu_codigo = 'refrigerios' and rol_id = (select rol_id from rol_ca);
select pg_temp.como('ca');
select is((select count(*)::int from public.envios where tipo = 'refrigerio'), 0, 'Sin permiso de refrigerios no ve esos envíos');

-- 23-25. Superadmin: fuera de plazo con motivo; composición estándar atómica
select pg_temp.como('sa', 'aal2');
select lives_ok($$select public.enviar_refrigerios((select alfa from k),
  pg_temp.pedido((now() at time zone 'America/Lima')::date, (select km37 from k), 'estandar', 2), gen_random_uuid(), 'Visita de gerencia')$$,
  'El Superadmin pide para hoy con motivo');
select lives_ok($$select public.guardar_estandar_refrigerio(jsonb_build_array(jsonb_build_object('producto_id', (select gaseosa from k), 'cantidad', 2)))$$,
  'Guardar la composición estándar');
select is((select string_agg(cantidad::text, ',') from public.refrigerio_estandar_items), '2',
  'La composición estándar se reemplaza completa');

select * from finish();
rollback;
