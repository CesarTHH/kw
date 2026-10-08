-- Ejecutar UNA vez en Supabase → SQL Editor (proyecto de pruebas).
-- Es la migración 20261008040000_importador_funciones más su registro en el historial.

-- =============================================================================
-- Kuntur Wasi · Fase 7 · importador (3/3): simulación, catálogos, lotes del historial y saldos (se ejecuta en el SQL Editor).
-- =============================================================================

create or replace function public.importacion_guardar_analisis(
  p_id uuid, p_resumen jsonb, p_problemas jsonb, p_errores int, p_advertencias int, p_lotes int, p_meses date[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not seguridad.puede_importar() then
    raise exception 'No tienes permiso para importar' using errcode = '42501';
  end if;
  perform 1 from public.importaciones where id = p_id and estado in ('subido', 'analizado') for update;
  if not found then
    raise exception 'La importación no existe o ya se ejecutó' using errcode = '22023';
  end if;
  delete from public.importacion_problemas where importacion_id = p_id;
  insert into public.importacion_problemas (importacion_id, n, nivel, archivo, fila, columna, motivo)
  select p_id, x.ord::int, x.p ->> 'nivel', left(x.p ->> 'archivo', 200), (x.p ->> 'fila')::int,
         left(x.p ->> 'columna', 120), left(x.p ->> 'motivo', 500)
  from jsonb_array_elements(coalesce(p_problemas, '[]'::jsonb)) with ordinality as x(p, ord)
  limit 5000;
  update public.importaciones
  set estado = 'analizado', resumen = p_resumen, errores = coalesce(p_errores, 0), advertencias = coalesce(p_advertencias, 0),
      lotes_total = coalesce(p_lotes, 0), meses = coalesce(p_meses, '{}')
  where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Paso 1: catálogos (proyectos, áreas, frentes, empresas, contactos, comedores,
-- servicios, tarifas, comedor-servicios, empresa-frentes). Todo por nombre o RUC.
-- ---------------------------------------------------------------------------
create or replace function public.importacion_catalogos(p_id uuid, p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n jsonb := '{}'::jsonb;
  c int;
begin
  if not seguridad.puede_importar() then
    raise exception 'No tienes permiso para importar' using errcode = '42501';
  end if;
  perform 1 from public.importaciones where id = p_id and estado = 'importando' for update;
  if not found then
    raise exception 'La importación no está en curso' using errcode = '22023';
  end if;

  -- Proyectos y áreas: se crean los que faltan; el estado se toma del maestro si viene.
  update public.proyectos p set activo = x.activo
  from jsonb_to_recordset(coalesce(p_datos -> 'proyectos', '[]')) x(nombre text, activo boolean)
  where seguridad.normalizar_nombre(p.nombre) = seguridad.normalizar_nombre(x.nombre) and x.activo is not null and p.activo <> x.activo;
  insert into public.proyectos (nombre, activo)
  select x.nombre, coalesce(x.activo, true) from jsonb_to_recordset(coalesce(p_datos -> 'proyectos', '[]')) x(nombre text, activo boolean)
  on conflict ((seguridad.normalizar_nombre(nombre))) do nothing;
  get diagnostics c = row_count; n := n || jsonb_build_object('proyectos', c);

  update public.areas a set activo = x.activo
  from jsonb_to_recordset(coalesce(p_datos -> 'areas', '[]')) x(nombre text, activo boolean)
  where seguridad.normalizar_nombre(a.nombre) = seguridad.normalizar_nombre(x.nombre) and x.activo is not null and a.activo <> x.activo;
  insert into public.areas (nombre, activo)
  select x.nombre, coalesce(x.activo, true) from jsonb_to_recordset(coalesce(p_datos -> 'areas', '[]')) x(nombre text, activo boolean)
  on conflict ((seguridad.normalizar_nombre(nombre))) do nothing;
  get diagnostics c = row_count; n := n || jsonb_build_object('areas', c);

  -- Frentes: los del maestro actualizan sponsor y contrato; los creados por la migración quedan inactivos.
  insert into public.frentes_trabajo (proyecto_id, area_id, nombre, sponsor, contrato_desde, contrato_hasta, activo, creado_por_migracion, origen_id)
  select p.id, a.id, x.nombre, x.sponsor, x.desde, x.hasta, not x.migracion, x.migracion, x.origen_id
  from jsonb_to_recordset(coalesce(p_datos -> 'frentes', '[]'))
       x(proyecto text, area text, nombre text, sponsor text, desde date, hasta date, migracion boolean, origen_id text)
  join public.proyectos p on seguridad.normalizar_nombre(p.nombre) = seguridad.normalizar_nombre(x.proyecto)
  join public.areas a on seguridad.normalizar_nombre(a.nombre) = seguridad.normalizar_nombre(x.area)
  -- Un frente renombrado en la app conserva su origen: no se vuelve a crear.
  where not exists (select 1 from public.frentes_trabajo f where f.origen_id = x.origen_id
                    and seguridad.normalizar_nombre(f.nombre) <> seguridad.normalizar_nombre(x.nombre))
  on conflict (proyecto_id, area_id, (seguridad.normalizar_nombre(nombre))) do update
    set sponsor = coalesce(excluded.sponsor, public.frentes_trabajo.sponsor),
        contrato_desde = coalesce(excluded.contrato_desde, public.frentes_trabajo.contrato_desde),
        contrato_hasta = coalesce(excluded.contrato_hasta, public.frentes_trabajo.contrato_hasta),
        -- Un frente que solo venía del historial se activa cuando aparece en el maestro.
        activo = public.frentes_trabajo.activo or public.frentes_trabajo.creado_por_migracion,
        creado_por_migracion = false,
        origen_id = coalesce(public.frentes_trabajo.origen_id, excluded.origen_id)
    where not excluded.creado_por_migracion;
  get diagnostics c = row_count; n := n || jsonb_build_object('frentes', c);

  -- Empresas por RUC.
  insert into public.empresas (ruc, razon_social, nombre_corto, direccion, tipo, telefonos, origen_id)
  select x.ruc, x.razon_social, x.nombre_corto, x.direccion, x.tipo, x.telefonos, x.origen_id
  from jsonb_to_recordset(coalesce(p_datos -> 'empresas', '[]'))
       x(ruc text, razon_social text, nombre_corto text, direccion text, tipo text, telefonos text, origen_id text)
  on conflict (ruc) do update
    set razon_social = excluded.razon_social, nombre_corto = excluded.nombre_corto,
        direccion = coalesce(excluded.direccion, public.empresas.direccion), tipo = excluded.tipo,
        telefonos = coalesce(excluded.telefonos, public.empresas.telefonos),
        origen_id = coalesce(public.empresas.origen_id, excluded.origen_id)
    where (public.empresas.razon_social, public.empresas.nombre_corto, public.empresas.tipo,
           public.empresas.direccion, public.empresas.telefonos, public.empresas.origen_id)
          is distinct from (excluded.razon_social, excluded.nombre_corto, excluded.tipo,
           coalesce(excluded.direccion, public.empresas.direccion), coalesce(excluded.telefonos, public.empresas.telefonos),
           coalesce(public.empresas.origen_id, excluded.origen_id));
  get diagnostics c = row_count; n := n || jsonb_build_object('empresas', c);

  insert into public.empresa_contactos (empresa_id, tipo, nombre, telefono, correo, recibe_notificaciones, origen_id)
  select e.id, x.tipo, x.nombre, x.telefono, x.correo, x.recibe, x.origen_id
  from jsonb_to_recordset(coalesce(p_datos -> 'contactos', '[]'))
       x(ruc text, tipo text, nombre text, telefono text, correo text, recibe boolean, origen_id text)
  join public.empresas e on e.ruc = x.ruc
  on conflict (origen_id) do update set nombre = excluded.nombre, telefono = coalesce(excluded.telefono, public.empresa_contactos.telefono)
    where (public.empresa_contactos.nombre, public.empresa_contactos.telefono)
          is distinct from (excluded.nombre, coalesce(excluded.telefono, public.empresa_contactos.telefono));
  get diagnostics c = row_count; n := n || jsonb_build_object('contactos', c);

  -- Comedores: los nuevos se crean con lo que dice el maestro. En los que ya existen solo se completa
  -- el sector si faltaba: lo que se habilitó o deshabilitó en la app no se pisa.
  insert into public.comedores (nombre, sector_id, habilitado_raciones, habilitado_refrigerios, habilitado_puntos_k, habilitado_kitchenette, activo, origen_id)
  select x.nombre, s.id, x.raciones, x.refrigerios, x.puntos_k, x.kitchenette, x.activo, x.origen_id
  from jsonb_to_recordset(coalesce(p_datos -> 'comedores', '[]'))
       x(nombre text, sector text, raciones boolean, refrigerios boolean, puntos_k boolean, kitchenette boolean, activo boolean, origen_id text)
  left join public.sectores s on s.codigo = x.sector
  where not exists (select 1 from public.comedores c where c.origen_id = x.origen_id)
  on conflict ((seguridad.normalizar_nombre(nombre))) do update
    set sector_id = coalesce(public.comedores.sector_id, excluded.sector_id),
        origen_id = coalesce(public.comedores.origen_id, excluded.origen_id)
    where public.comedores.sector_id is null and excluded.sector_id is not null
       or public.comedores.origen_id is null;
  get diagnostics c = row_count; n := n || jsonb_build_object('comedores', c);

  insert into public.servicios (nombre, tipo_servicio_id, es_a_campo)
  select x.nombre, t.id, x.a_campo
  from jsonb_to_recordset(coalesce(p_datos -> 'servicios', '[]')) x(nombre text, tipo text, a_campo boolean)
  join public.tipos_servicio t on t.codigo = x.tipo
  on conflict ((seguridad.normalizar_nombre(nombre))) do nothing;
  get diagnostics c = row_count; n := n || jsonb_build_object('servicios', c);

  -- Tarifas: el archivo manda. Las actuales que se cruzan con una del archivo (y no empiezan el mismo día) se quitan.
  drop table if exists t_tarifas;
  create temporary table t_tarifas on commit drop as
  select s.id as servicio_id, x.precio, x.desde, x.hasta
  from jsonb_to_recordset(coalesce(p_datos -> 'tarifas', '[]')) x(servicio text, precio numeric, desde date, hasta date)
  join public.servicios s on seguridad.normalizar_nombre(s.nombre) = seguridad.normalizar_nombre(x.servicio);
  delete from public.servicio_tarifas st
  using t_tarifas t
  where st.servicio_id = t.servicio_id and st.vigente_desde <> t.desde
    and daterange(st.vigente_desde, st.vigente_hasta, '[]') && daterange(t.desde, t.hasta, '[]');
  get diagnostics c = row_count; n := n || jsonb_build_object('tarifas_reemplazadas', c);
  update public.servicio_tarifas st set precio = t.precio, vigente_hasta = t.hasta
  from t_tarifas t
  where st.servicio_id = t.servicio_id and st.vigente_desde = t.desde and (st.precio <> t.precio or st.vigente_hasta <> t.hasta);
  insert into public.servicio_tarifas (servicio_id, precio, vigente_desde, vigente_hasta)
  select t.servicio_id, t.precio, t.desde, t.hasta from t_tarifas t
  where not exists (select 1 from public.servicio_tarifas st where st.servicio_id = t.servicio_id and st.vigente_desde = t.desde);
  get diagnostics c = row_count; n := n || jsonb_build_object('tarifas', c);

  insert into public.comedor_servicios (comedor_id, servicio_id)
  select co.id, se.id
  from jsonb_to_recordset(coalesce(p_datos -> 'comedor_servicios', '[]')) x(comedor text, servicio text)
  join public.comedores co on seguridad.normalizar_nombre(co.nombre) = seguridad.normalizar_nombre(x.comedor)
  join public.servicios se on seguridad.normalizar_nombre(se.nombre) = seguridad.normalizar_nombre(x.servicio)
  on conflict do nothing;
  get diagnostics c = row_count; n := n || jsonb_build_object('comedor_servicios', c);

  insert into public.empresa_frentes (empresa_id, frente_id)
  select distinct e.id, fr.id
  from jsonb_to_recordset(coalesce(p_datos -> 'empresa_frentes', '[]')) x(ruc text, proyecto text, area text, frente text)
  join public.empresas e on e.ruc = x.ruc
  join public.proyectos p on seguridad.normalizar_nombre(p.nombre) = seguridad.normalizar_nombre(x.proyecto)
  join public.areas a on seguridad.normalizar_nombre(a.nombre) = seguridad.normalizar_nombre(x.area)
  join public.frentes_trabajo fr on fr.proyecto_id = p.id and fr.area_id = a.id
                                 and seguridad.normalizar_nombre(fr.nombre) = seguridad.normalizar_nombre(x.frente)
  on conflict do nothing;
  get diagnostics c = row_count; n := n || jsonb_build_object('empresa_frentes', c);

  update public.importaciones set catalogos_hechos = true, resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('catalogos', n)
  where id = p_id;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Paso 2: un lote del historial. Movimiento = arreglo
-- [origen_id, envio, ruc, fecha, proyecto, area, frente, comedor, servicio, tipo, cantidad, par]
-- ---------------------------------------------------------------------------
create or replace function public.importacion_movimientos(p_id uuid, p_lote int, p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total       int;
  v_existentes  int;
  v_insertados  int;
  v_faltan      int;
  v_ejemplo     text;
begin
  if not seguridad.puede_importar() then
    raise exception 'No tienes permiso para importar' using errcode = '42501';
  end if;
  perform 1 from public.importaciones where id = p_id and estado = 'importando' and catalogos_hechos for update;
  if not found then
    raise exception 'La importación no está en curso o faltan los catálogos' using errcode = '22023';
  end if;
  if p_lote < 0 or p_lote >= (select lotes_total from public.importaciones where id = p_id) then
    raise exception 'Lote fuera de rango' using errcode = '22023';
  end if;
  if exists (select 1 from public.importacion_lotes where importacion_id = p_id and lote = p_lote) then
    return jsonb_build_object('repetido', true);
  end if;

  insert into public.envios (empresa_id, usuario_id, tipo, clave_idempotencia, enviado_en, total_filas, total_raciones, origen_id, usuario_origen)
  select e.id, auth.uid(), 'migracion', md5(x.origen_id)::uuid, x.enviado_en, x.filas, x.total, x.origen_id, x.usuario
  from jsonb_to_recordset(coalesce(p_datos -> 'envios', '[]'))
       x(origen_id text, ruc text, usuario text, enviado_en timestamptz, filas int, total int)
  join public.empresas e on e.ruc = x.ruc
  on conflict (origen_id) do nothing;

  drop table if exists t_filas;
  create temporary table t_filas on commit drop as
  select x ->> 0 as origen, x ->> 1 as envio, x ->> 2 as ruc, (x ->> 3)::date as fecha,
         x ->> 4 as proyecto, x ->> 5 as area, x ->> 6 as frente, x ->> 7 as comedor, x ->> 8 as servicio,
         x ->> 9 as tipo, (x ->> 10)::int as cantidad, x ->> 11 as par
  from jsonb_array_elements(coalesce(p_datos -> 'movimientos', '[]')) x;
  select count(*) into v_total from t_filas;
  select count(*) into v_existentes from t_filas f join public.racion_movimientos m on m.origen_id = f.origen;

  drop table if exists t_resueltas;
  create temporary table t_resueltas on commit drop as
  select f.origen, en.id as envio_id, en.enviado_en, em.id as empresa_id, f.fecha, fr.id as frente_id,
         co.id as comedor_id, se.id as servicio_id, f.tipo, f.cantidad, f.par
  from t_filas f
  join public.envios en on en.origen_id = f.envio
  join public.empresas em on em.ruc = f.ruc
  join public.proyectos p on seguridad.normalizar_nombre(p.nombre) = seguridad.normalizar_nombre(f.proyecto)
  join public.areas a on seguridad.normalizar_nombre(a.nombre) = seguridad.normalizar_nombre(f.area)
  join public.frentes_trabajo fr on fr.proyecto_id = p.id and fr.area_id = a.id
                                 and seguridad.normalizar_nombre(fr.nombre) = seguridad.normalizar_nombre(f.frente)
  join public.comedores co on seguridad.normalizar_nombre(co.nombre) = seguridad.normalizar_nombre(f.comedor)
  join public.servicios se on seguridad.normalizar_nombre(se.nombre) = seguridad.normalizar_nombre(f.servicio);

  v_faltan := v_total - (select count(*) from t_resueltas);
  if v_faltan > 0 then
    select concat_ws(' / ', f.ruc, f.proyecto, f.area, f.frente, f.comedor, f.servicio) into v_ejemplo
    from t_filas f where not exists (select 1 from t_resueltas r where r.origen = f.origen) limit 1;
    raise exception 'Lote %: % filas no coinciden con los catálogos (por ejemplo: %)', p_lote, v_faltan, v_ejemplo using errcode = '22023';
  end if;

  insert into public.racion_movimientos (envio_id, empresa_id, fecha, frente_id, comedor_id, servicio_id, tipo_movimiento, cantidad, created_at, origen_id)
  select r.envio_id, r.empresa_id, r.fecha, r.frente_id, r.comedor_id, r.servicio_id, r.tipo, r.cantidad, r.enviado_en, r.origen
  from t_resueltas r
  on conflict (origen_id) where origen_id is not null do nothing;
  get diagnostics v_insertados = row_count;

  -- Pares de traslado (salida ↔ entrada).
  update public.racion_movimientos m set traslado_par = o.id
  from t_resueltas r
  join public.racion_movimientos o on o.origen_id = r.par
  where m.origen_id = r.origen and r.par is not null and m.traslado_par is null;

  -- Totales de los envíos según sus movimientos reales (por si un envío reúne filas de otra importación).
  update public.envios e
  set total_filas = x.filas, total_raciones = x.total
  from (select m.envio_id, count(*)::int as filas, sum(m.cantidad)::int as total
        from public.racion_movimientos m
        where m.envio_id in (select distinct envio_id from t_resueltas)
        group by m.envio_id) x
  where e.id = x.envio_id and (e.total_filas, e.total_raciones) is distinct from (x.filas, x.total);

  insert into public.importacion_lotes (importacion_id, lote, insertados, existentes)
  values (p_id, p_lote, v_insertados, v_existentes);
  update public.importaciones set lotes_hechos = (select count(*) from public.importacion_lotes where importacion_id = p_id)
  where id = p_id;
  return jsonb_build_object('insertados', v_insertados, 'existentes', v_existentes);
end;
$$;

-- ---------------------------------------------------------------------------
-- Paso 3: saldos de un mes = suma de todos sus movimientos (nunca menos de 0).
-- ---------------------------------------------------------------------------
create or replace function public.importacion_saldos(p_id uuid, p_mes date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mes        date := date_trunc('month', p_mes)::date;
  v_negativos  int;
  v_claves     int;
begin
  if not seguridad.puede_importar() then
    raise exception 'No tienes permiso para importar' using errcode = '42501';
  end if;
  perform 1 from public.importaciones where id = p_id and estado = 'importando' for update;
  if not found then
    raise exception 'La importación no está en curso' using errcode = '22023';
  end if;

  -- Mientras se recalcula, nadie más cambia saldos (los envíos en vivo esperan unos segundos).
  lock table public.racion_saldos in share row exclusive mode;
  drop table if exists t_saldos;
  create temporary table t_saldos on commit drop as
  select empresa_id, fecha, frente_id, comedor_id, servicio_id, sum(cantidad)::int as cantidad
  from public.racion_movimientos
  where fecha >= v_mes and fecha < (v_mes + interval '1 month')::date
  group by 1, 2, 3, 4, 5;
  select count(*), count(*) filter (where cantidad < 0) into v_claves, v_negativos from t_saldos;

  insert into public.racion_saldos (empresa_id, fecha, frente_id, comedor_id, servicio_id, cantidad)
  select empresa_id, fecha, frente_id, comedor_id, servicio_id, greatest(cantidad, 0) from t_saldos
  on conflict (empresa_id, fecha, frente_id, comedor_id, servicio_id) do update
    set cantidad = excluded.cantidad, updated_at = now()
    where public.racion_saldos.cantidad <> excluded.cantidad;

  update public.importaciones
  set meses_listos = case when v_mes = any (meses_listos) then meses_listos else meses_listos || v_mes end,
      meses_hechos = cardinality(case when v_mes = any (meses_listos) then meses_listos else meses_listos || v_mes end),
      resultado = coalesce(resultado, '{}'::jsonb)
                  || jsonb_build_object('saldos_negativos', coalesce((resultado ->> 'saldos_negativos')::int, 0) + v_negativos)
  where id = p_id;
  return jsonb_build_object('claves', v_claves, 'negativos', v_negativos);
end;
$$;

revoke execute on function public.importacion_guardar_analisis(uuid, jsonb, jsonb, int, int, int, date[]) from public, anon;
revoke execute on function public.importacion_catalogos(uuid, jsonb) from public, anon;
revoke execute on function public.importacion_movimientos(uuid, int, jsonb) from public, anon;
revoke execute on function public.importacion_saldos(uuid, date) from public, anon;
grant execute on function public.importacion_guardar_analisis(uuid, jsonb, jsonb, int, int, int, date[]) to authenticated;
grant execute on function public.importacion_catalogos(uuid, jsonb) to authenticated;
grant execute on function public.importacion_movimientos(uuid, int, jsonb) to authenticated;
grant execute on function public.importacion_saldos(uuid, date) to authenticated;

revoke execute on all functions in schema seguridad from public, anon;
grant execute on all functions in schema seguridad to authenticated, service_role;
revoke execute on function seguridad.mover_saldo(uuid, date, uuid, uuid, uuid, int) from authenticated;
revoke execute on function seguridad.encolar_correo(text, jsonb, text[], uuid, uuid, boolean) from authenticated;
revoke execute on function seguridad.disparar_envio_correos() from authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261008040000', 'importador_funciones')
on conflict (version) do nothing;
