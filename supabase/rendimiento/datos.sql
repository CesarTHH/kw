-- Prueba de rendimiento con volumen sintético equivalente al histórico (no usa datos reales).
-- Uso (base local con migraciones y seed): psql -f datos.sql && psql -f consultas.sql
-- Volumen sintético equivalente al histórico real (sin datos reales).
set session_replication_role = replica; -- sin triggers de auditoría para cargar rápido
insert into public.empresas (ruc, razon_social, nombre_corto, tipo)
select lpad((20000000000 + g)::text, 11, '0'), 'EMPRESA SINTETICA ' || g, 'SINT ' || g, 'empresa' from generate_series(1, 163) g;
insert into public.frentes_trabajo (proyecto_id, area_id, nombre, contrato_desde, contrato_hasta)
select (select id from public.proyectos order by nombre limit 1 offset (g % 4)), (select id from public.areas order by nombre limit 1 offset (g % 4)),
  'FRENTE SINT ' || g, date '2025-01-01', date '2027-12-31' from generate_series(1, 260) g;
create temp table ef as
select e.id empresa_id, f.id frente_id, row_number() over () n
from (select id, row_number() over (order by ruc) r from public.empresas) e
join (select id, row_number() over (order by nombre) r from public.frentes_trabajo) f on f.r % 165 = e.r % 165;
insert into public.empresa_frentes (empresa_id, frente_id, contrato_desde, contrato_hasta)
select empresa_id, frente_id, date '2025-01-01', date '2027-12-31' from ef on conflict do nothing;
create temp table cs as select c.id comedor_id, s.id servicio_id, row_number() over () n
from (select id from public.comedores order by nombre limit 13) c cross join (select id from public.servicios order by nombre limit 6) s;
-- 27 000 envíos y 320 000 movimientos entre ene-2025 y dic-2026
insert into public.envios (id, empresa_id, usuario_id, tipo, clave_idempotencia, enviado_en, total_filas, total_raciones)
select gen_random_uuid(), (select empresa_id from ef where n = 1 + (g % (select count(*) from ef))), gen_random_uuid(), 'migracion', gen_random_uuid(),
  timestamp '2025-01-01' + (g * interval '33 minutes'), 12, 0 from generate_series(1, 27000) g;
create temp table ev as select id, empresa_id, row_number() over (order by enviado_en) n from public.envios where tipo = 'migracion';
insert into public.racion_movimientos (envio_id, empresa_id, fecha, frente_id, comedor_id, servicio_id, tipo_movimiento, cantidad)
select ev.id, ev.empresa_id, date '2025-01-01' + ((g * 7) % 730), (select frente_id from ef where ef.empresa_id = ev.empresa_id limit 1),
  cs.comedor_id, cs.servicio_id, 'migracion', 1 + (g % 40)
from generate_series(1, 320000) g
join ev on ev.n = 1 + (g % 27000)
join cs on cs.n = 1 + (g % (select count(*) from cs));
insert into public.racion_saldos (empresa_id, fecha, frente_id, comedor_id, servicio_id, cantidad)
select empresa_id, fecha, frente_id, comedor_id, servicio_id, sum(cantidad) from public.racion_movimientos
group by 1,2,3,4,5 on conflict do nothing;
set session_replication_role = origin;
analyze;
select (select count(*) from public.racion_movimientos) movs, (select count(*) from public.racion_saldos) saldos, (select count(*) from public.empresas) empresas, (select count(*) from public.envios) envios;
