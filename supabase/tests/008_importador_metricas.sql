-- Pruebas del importador, métricas y auditoría (pgTAP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create temporary table u (clave text primary key, id uuid);
grant select on u to authenticated;
insert into u values ('ca', gen_random_uuid()), ('sa', gen_random_uuid());
insert into auth.users (id, email, raw_app_meta_data)
select id, clave || '@prueba.example.com',
  case clave
    when 'ca' then jsonb_build_object('rol_codigo', 'contratista', 'empresa_id', (select id from public.empresas where ruc = '20999999019'))
    else jsonb_build_object('rol_codigo', 'superadmin')
  end
from u;

create or replace function pg_temp.como(p_clave text, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from u where clave = p_clave), 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;

-- 1-3. Permisos
select pg_temp.como('ca');
select throws_ok($$select public.importacion_crear('[{"nombre":"x.csv"}]')$$, '42501', null, 'Un contratista no importa');
select throws_ok($$select public.metricas_uso(30)$$, '42501', null, 'Un contratista no ve las métricas');
select is((select count(*)::int from public.auditoria), 0, 'Un contratista no lee la auditoría');

-- 4-5. Crear y simular
select pg_temp.como('sa', 'aal2');
create temporary table imp as select public.importacion_crear('[{"nombre":"MAESTRO.csv","ruta":"x/MAESTRO.csv"}]') as id;
grant select on imp to authenticated;
select throws_ok($$select public.importacion_catalogos((select id from imp), '{}')$$, '22023', null, 'No se importa sin simular antes');
select lives_ok($$select public.importacion_guardar_analisis((select id from imp), '{"envios": 2}',
  '[{"nivel":"advertencia","archivo":"a.csv","fila":3,"columna":"X","motivo":"Prueba"}]', 0, 1, 1, array['2026-01-01']::date[])$$,
  'Guardar la simulación');
select is((select estado || ':' || lotes_total || ':' || advertencias from public.importaciones where id = (select id from imp)), 'analizado:1:1',
  'La simulación queda registrada');

-- 7-12. Catálogos
select lives_ok($$select public.importacion_marcar((select id from imp), 'importando')$$, 'Iniciar la importación');
create temporary table cat as select public.importacion_catalogos((select id from imp), $j${
  "proyectos": [{"nombre": "PROYECTO PRUEBA", "activo": true}],
  "areas": [{"nombre": "ÁREA PRUEBA", "activo": true}],
  "frentes": [
    {"proyecto": "PROYECTO PRUEBA", "area": "ÁREA PRUEBA", "nombre": "FRENTE A", "sponsor": "Ana", "desde": "2025-01-01", "hasta": "2026-12-31", "migracion": false, "origen_id": "frentes:a"},
    {"proyecto": "PROYECTO PRUEBA", "area": "ÁREA PRUEBA", "nombre": "FRENTE VIEJO", "sponsor": null, "desde": null, "hasta": null, "migracion": true, "origen_id": "frentes:v"}],
  "empresas": [{"ruc": "20999999019", "razon_social": "ALFA RAZON NUEVA SAC", "nombre_corto": "ALFA", "direccion": null, "tipo": "empresa", "telefonos": null, "origen_id": "clientes:20999999019"}],
  "contactos": [{"ruc": "20999999019", "tipo": "facturacion", "nombre": "Contacto Prueba", "telefono": null, "correo": "c@prueba.example.com", "recibe": false, "origen_id": "contactos:x"}],
  "comedores": [{"nombre": "KM 37", "sector": null, "raciones": true, "refrigerios": true, "puntos_k": false, "kitchenette": false, "activo": true, "origen_id": "comedores:KM 37"}],
  "servicios": [{"nombre": "DESAYUNO", "tipo": "DESAYUNO", "a_campo": false}],
  "tarifas": [{"servicio": "DESAYUNO", "precio": 15.5, "desde": "2025-06-01", "hasta": "2099-12-31"}],
  "comedor_servicios": [{"comedor": "KM 37", "servicio": "DESAYUNO"}],
  "empresa_frentes": [{"ruc": "20999999019", "proyecto": "PROYECTO PRUEBA", "area": "ÁREA PRUEBA", "frente": "FRENTE A"}]
}$j$) as r;
select is((select razon_social from public.empresas where ruc = '20999999019'), 'ALFA RAZON NUEVA SAC', 'La empresa se actualiza por RUC');
select is((select string_agg(nombre || ':' || activo || ':' || creado_por_migracion, ',' order by nombre) from public.frentes_trabajo
           where nombre in ('FRENTE A', 'FRENTE VIEJO')), 'FRENTE A:true:false,FRENTE VIEJO:false:true',
  'Los frentes que solo están en el historial se crean inactivos');
select is((select s.codigo from public.comedores c join public.sectores s on s.id = c.sector_id where c.nombre = 'KM 37'), 'PARTE_BAJA',
  'Un sector vacío en el archivo no borra el actual');
select is((select string_agg(precio::text || '@' || vigente_desde, ',') from public.servicio_tarifas st
           join public.servicios s on s.id = st.servicio_id where s.nombre = 'DESAYUNO'), '15.50@2025-06-01',
  'La tarifa del archivo reemplaza a la que se cruza');
select ok(exists (select 1 from public.empresa_frentes ef join public.frentes_trabajo f on f.id = ef.frente_id
                  where f.nombre = 'FRENTE A'), 'La empresa queda asociada al frente que usó');

-- 13-18. Movimientos
create temporary table lote as select $j${
  "envios": [{"origen_id": "he:1", "ruc": "20999999019", "usuario": "20999999019", "enviado_en": "2025-12-20T15:00:00Z", "filas": 3, "total": 10}],
  "movimientos": [
    ["h:1", "he:1", "20999999019", "2026-01-05", "PROYECTO PRUEBA", "ÁREA PRUEBA", "FRENTE A", "KM 37", "DESAYUNO", "programacion", 10, null],
    ["h:2", "he:1", "20999999019", "2026-01-05", "PROYECTO PRUEBA", "ÁREA PRUEBA", "FRENTE A", "KM 37", "DESAYUNO", "traslado_salida", -4, "h:3"],
    ["h:3", "he:1", "20999999019", "2026-01-05", "PROYECTO PRUEBA", "ÁREA PRUEBA", "FRENTE VIEJO", "KM 37", "DESAYUNO", "traslado_entrada", 4, "h:2"]]
}$j$::jsonb as d;
grant select on lote to authenticated;
select is(public.importacion_movimientos((select id from imp), 0, (select d from lote)) ->> 'insertados', '3', 'Se importan los movimientos del lote');
select is(public.importacion_movimientos((select id from imp), 0, (select d from lote)) ->> 'repetido', 'true', 'Un lote ya hecho no se repite');
select ok((select m.traslado_par = o.id from public.racion_movimientos m join public.racion_movimientos o on o.origen_id = 'h:3'
           where m.origen_id = 'h:2'), 'Los traslados quedan emparejados');
select throws_ok($$select public.importacion_movimientos((select id from imp), 1,
  '{"envios": [], "movimientos": [["h:9", "he:1", "20999999019", "2026-01-05", "NO EXISTE", "ÁREA PRUEBA", "FRENTE A", "KM 37", "DESAYUNO", "programacion", 1, null]]}')$$,
  '22023', null, 'Una fila que no coincide con los catálogos detiene el lote');
select is((select tipo || ':' || total_filas || ':' || usuario_origen from public.envios where origen_id = 'he:1'), 'migracion:3:20999999019',
  'El envío histórico guarda la cuenta de origen');
select is((select count(*)::int from public.correos_pendientes c join public.envios e on e.id = c.envio_id where e.origen_id = 'he:1'), 0,
  'La migración no envía correos');

-- 19-21. Saldos y cierre
select throws_ok($$select public.importacion_finalizar((select id from imp))$$, '22023', 'Faltan pasos por terminar', 'No se cierra con pasos pendientes');
select lives_ok($$select public.importacion_saldos((select id from imp), '2026-01-01')$$, 'Recalcular los saldos del mes');
select is((select string_agg(f.nombre || '=' || s.cantidad, ',' order by f.nombre) from public.racion_saldos s
           join public.frentes_trabajo f on f.id = s.frente_id where s.fecha = '2026-01-05' and f.nombre like 'FRENTE %'),
  'FRENTE A=6,FRENTE VIEJO=4', 'Los saldos suman los movimientos');
select lives_ok($$select public.importacion_finalizar((select id from imp))$$, 'Cerrar la importación');

-- 23-24. Métricas y auditoría
select ok((public.metricas_uso(30) -> 'totales') ? 'usuarios_activos', 'El Superadmin ve las métricas');
select ok(exists (select 1 from public.auditoria_tipos() where modulo = 'importador' and accion = 'importacion_terminada'),
  'Los filtros de auditoría listan los módulos y acciones presentes');

select * from finish();
rollback;
