-- =============================================================================
-- Kuntur Wasi · Fase 7 (1/2): visor de auditoría y métricas de uso.
-- =============================================================================

-- La auditoría la leen solo los roles con permiso y alcance "todas" (Kuntur Wasi).
alter policy auditoria_leer on public.auditoria
  using ((select seguridad.tiene_permiso('admin.auditoria', 'ver')) and (select seguridad.mi_alcance()) = 'todas');

-- Módulos y acciones presentes (para los filtros). Recorre el índice (modulo, accion, en)
-- saltando de valor en valor, así no lee toda la tabla. Respeta la política de lectura.
create or replace function public.auditoria_tipos()
returns table (modulo text, accion text)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive t(modulo, accion) as (
    (select a.modulo, a.accion from public.auditoria a order by a.modulo, a.accion limit 1)
    union all
    select x.modulo, x.accion
    from t, lateral (
      select a.modulo, a.accion from public.auditoria a
      where (a.modulo, a.accion) > (t.modulo, t.accion)
      order by a.modulo, a.accion
      limit 1
    ) x
  )
  select modulo, accion from t;
$$;

-- ---------------------------------------------------------------------------
-- Errores inesperados del servidor (para las métricas). Sin datos personales.
-- ---------------------------------------------------------------------------
create table public.errores_app (
  id          bigint generated always as identity primary key,
  en          timestamptz not null default now(),
  usuario_id  uuid default auth.uid(),
  origen      text not null check (length(origen) between 1 and 60),
  detalle     text check (length(detalle) <= 500)
);
create index on public.errores_app (en desc);
create index on public.errores_app (usuario_id, en desc);

alter table public.errores_app enable row level security;
revoke all on public.errores_app from anon;
revoke insert, update, delete, truncate, references, trigger on public.errores_app from authenticated;
grant select on public.errores_app to authenticated;
create policy errores_app_leer on public.errores_app for select to authenticated
  using ((select seguridad.tiene_permiso('admin.metricas', 'ver')) and (select seguridad.mi_alcance()) = 'todas');

-- Cualquier usuario con sesión puede dejar un error (máximo 30 por hora, para que no se use para llenar la tabla).
create or replace function public.registrar_error(p_origen text, p_detalle text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_origen is null or length(btrim(p_origen)) = 0 then
    return;
  end if;
  if (select count(*) from public.errores_app where usuario_id = auth.uid() and en > now() - interval '1 hour') >= 30 then
    return;
  end if;
  insert into public.errores_app (origen, detalle) values (left(btrim(p_origen), 60), left(p_detalle, 500));
end;
$$;

-- ---------------------------------------------------------------------------
-- Métricas de uso de los últimos p_dias días (todo en hora de la zona configurada).
-- ---------------------------------------------------------------------------
create or replace function public.metricas_uso(p_dias int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zona   text := seguridad.zona_horaria();
  v_dias   int := least(greatest(coalesce(p_dias, 30), 7), 180);
  v_hoy    date := (now() at time zone seguridad.zona_horaria())::date;
  v_desde  date := (now() at time zone seguridad.zona_horaria())::date - (least(greatest(coalesce(p_dias, 30), 7), 180) - 1);
  v_inicio timestamptz;
begin
  if not (seguridad.tiene_permiso('admin.metricas', 'ver') and seguridad.mi_alcance() = 'todas') then
    raise exception 'No tienes permiso para ver las métricas' using errcode = '42501';
  end if;
  v_inicio := v_desde::timestamp at time zone v_zona;

  return jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hoy,
    -- Por día: usuarios distintos que hicieron algo, inicios de sesión y envíos.
    'por_dia', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'fecha', d.fecha,
               'usuarios', coalesce(a.usuarios, 0),
               'logins', coalesce(a.logins, 0),
               'envios', coalesce(e.envios, 0)) order by d.fecha), '[]'::jsonb)
      from generate_series(v_desde, v_hoy, interval '1 day') as d(fecha)
      left join (
        select (en at time zone v_zona)::date as fecha,
               count(distinct usuario_id) as usuarios,
               count(*) filter (where modulo = 'sesion' and accion = 'login') as logins
        from public.auditoria
        where en >= v_inicio and usuario_id is not null
        group by 1
      ) a on a.fecha = d.fecha::date
      left join (
        select (enviado_en at time zone v_zona)::date as fecha, count(*) as envios
        from public.envios
        where enviado_en >= v_inicio and tipo <> 'migracion'
        group by 1
      ) e on e.fecha = d.fecha::date
    ),
    -- Usuarios activos por semana (lunes a domingo), últimas 12 semanas.
    'por_semana', (
      select coalesce(jsonb_agg(jsonb_build_object('semana', s.semana, 'usuarios', coalesce(a.usuarios, 0)) order by s.semana), '[]'::jsonb)
      from generate_series(date_trunc('week', v_hoy::timestamp) - interval '11 weeks', date_trunc('week', v_hoy::timestamp), interval '1 week') as s(semana)
      left join (
        select date_trunc('week', en at time zone v_zona) as semana, count(distinct usuario_id) as usuarios
        from public.auditoria
        where en >= (date_trunc('week', v_hoy::timestamp) - interval '11 weeks') at time zone v_zona and usuario_id is not null
        group by 1
      ) a on a.semana = s.semana
    ),
    'totales', jsonb_build_object(
      'usuarios_activos', (select count(distinct usuario_id) from public.auditoria where en >= v_inicio and usuario_id is not null),
      'logins', (select count(*) from public.auditoria where en >= v_inicio and modulo = 'sesion' and accion = 'login'),
      'usuarios_registrados', (select count(*) from public.perfiles where estado = 'activo'),
      'empresas_activas', (select count(*) from public.empresas where activo)
    ),
    -- Envíos por módulo (sin la migración histórica).
    'envios_por_tipo', (
      select coalesce(jsonb_object_agg(tipo, n), '{}'::jsonb)
      from (select tipo, count(*) as n from public.envios where enviado_en >= v_inicio and tipo <> 'migracion' group by tipo) x
    ),
    -- Empresas activas sin envíos en el periodo, con la fecha de su último envío.
    'empresas_sin_actividad', (
      select coalesce(jsonb_agg(jsonb_build_object('ruc', x.ruc, 'nombre', x.nombre_corto, 'ultimo_envio', x.ultimo) order by x.ultimo nulls first, x.nombre_corto), '[]'::jsonb)
      from (
        select em.ruc, em.nombre_corto,
               (select max(e.enviado_en) from public.envios e where e.empresa_id = em.id) as ultimo
        from public.empresas em
        where em.activo
          and not exists (select 1 from public.envios e where e.empresa_id = em.id and e.enviado_en >= v_inicio and e.tipo <> 'migracion')
        limit 300
      ) x
    ),
    -- Errores recientes: del servidor y correos que no salieron.
    'errores', (
      select coalesce(jsonb_agg(jsonb_build_object('en', x.en, 'origen', x.origen, 'detalle', x.detalle) order by x.en desc), '[]'::jsonb)
      from (select en, origen, detalle from public.errores_app where en >= v_inicio order by en desc limit 50) x
    ),
    'errores_total', (select count(*) from public.errores_app where en >= v_inicio),
    'correos_fallidos', (select count(*) from public.correos_pendientes where created_at >= v_inicio and estado in ('fallido', 'parcial'))
  );
end;
$$;

revoke execute on function public.auditoria_tipos() from public, anon;
revoke execute on function public.registrar_error(text, text) from public, anon;
revoke execute on function public.metricas_uso(int) from public, anon;
grant execute on function public.auditoria_tipos() to authenticated;
grant execute on function public.registrar_error(text, text) to authenticated;
grant execute on function public.metricas_uso(int) to authenticated;
