create temp table u (clave text primary key, id uuid); grant select on u to authenticated;
insert into u values ('sa', gen_random_uuid()), ('ca', gen_random_uuid());
insert into auth.users (id, email, raw_app_meta_data)
select id, clave || '@prueba.example.com', case clave when 'sa' then jsonb_build_object('rol_codigo','superadmin')
  else jsonb_build_object('rol_codigo','contratista','empresa_id',(select empresa_id from public.racion_saldos group by 1 order by count(*) desc limit 1)) end from u;
create temp table t (prueba text, ms numeric);
create or replace function pg_temp.medir(p_nombre text, p_clave text, p_sql text, p_n int default 30) returns void language plpgsql as $$
declare i int; t0 timestamptz; r record; c bigint;
begin
  for i in 1..p_n loop
    perform set_config('role','authenticated',true);
    perform set_config('request.jwt.claims', json_build_object('sub',(select id from u where clave=p_clave),'role','authenticated','aal','aal2')::text, true);
    t0 := clock_timestamp();
    execute 'select count(*) from (' || p_sql || ') x' into c;
    perform set_config('role','postgres',true);
    insert into t values (p_nombre || ' [' || c || ' filas]', extract(epoch from clock_timestamp()-t0)*1000);
  end loop;
end $$;
select pg_temp.medir('Sesión: perfil + menú + alertas (mi_sesion)', 'ca', 'select public.mi_sesion()');
select pg_temp.medir('Tablero del contratista: 1 mes de su empresa', 'ca', $q$select * from public.resumen_raciones(date '2026-06-01', date '2026-06-30', (select empresa_id from public.racion_saldos group by 1 order by count(*) desc limit 1))$q$);
select pg_temp.medir('Tablero del superadmin: 1 mes, todas las empresas', 'sa', $q$select * from public.resumen_raciones(date '2026-06-01', date '2026-06-30', null)$q$);
select pg_temp.medir('Tablero del superadmin: 3 meses, todas las empresas', 'sa', $q$select * from public.resumen_raciones(date '2026-04-01', date '2026-06-30', null)$q$);
select pg_temp.medir('Consulta detallada: 1 mes, primera página de 50', 'ca', $q$select * from public.racion_saldos where fecha between '2026-06-01' and '2026-06-30' and cantidad > 0 order by fecha, comedor_id limit 50$q$);
select pg_temp.medir('Conteo total de la consulta (paginación)', 'ca', $q$select 1 from public.racion_saldos where fecha between '2026-06-01' and '2026-06-30' and cantidad > 0$q$);
select prueba, count(*) n, round(percentile_cont(0.5) within group (order by ms)::numeric,1) mediana_ms, round(percentile_cont(0.95) within group (order by ms)::numeric,1) p95_ms, round(max(ms),1) max_ms from t group by prueba order by min(ctid);
