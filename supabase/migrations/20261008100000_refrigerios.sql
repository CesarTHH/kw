-- =============================================================================
-- Kuntur Wasi · Fase 5: refrigerios.
--
-- Catálogos (productos con precio vigente, composición y precio del estándar,
-- turnos de entrega), pedidos con su composición y precio CONGELADOS al enviar,
-- y reducciones posteriores. Todo pasa por funciones que validan permisos,
-- plazos y catálogos, y dejan auditoría y correo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------------
create table public.refrigerio_productos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  orden       int not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create unique index refrigerio_productos_nombre_uq on public.refrigerio_productos (seguridad.normalizar_nombre(nombre));

create table public.refrigerio_producto_precios (
  id             uuid primary key default gen_random_uuid(),
  producto_id    uuid not null references public.refrigerio_productos(id) on delete cascade,
  precio         numeric(10, 2) not null check (precio >= 0),
  vigente_desde  date not null,
  vigente_hasta  date not null default '2099-12-31',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  constraint refrigerio_precios_rango_ck check (vigente_hasta >= vigente_desde),
  constraint refrigerio_precios_sin_solape exclude using gist (
    producto_id with =, daterange(vigente_desde, vigente_hasta, '[]') with &&
  )
);

-- Composición del refrigerio estándar (una sola, editable).
create table public.refrigerio_estandar_items (
  producto_id  uuid primary key references public.refrigerio_productos(id) on delete cascade,
  cantidad     int not null check (cantidad between 1 and 100),
  updated_at   timestamptz not null default now()
);

-- Precio del refrigerio estándar (con vigencia).
create table public.refrigerio_estandar_precios (
  id             uuid primary key default gen_random_uuid(),
  precio         numeric(10, 2) not null check (precio >= 0),
  vigente_desde  date not null,
  vigente_hasta  date not null default '2099-12-31',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint estandar_precios_rango_ck check (vigente_hasta >= vigente_desde),
  constraint estandar_precios_sin_solape exclude using gist (
    daterange(vigente_desde, vigente_hasta, '[]') with &&
  )
);

create table public.refrigerio_turnos (
  id          uuid primary key default gen_random_uuid(),
  hora        time not null unique,
  etiqueta    text not null check (length(btrim(etiqueta)) between 1 and 40),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
create table public.refrigerio_pedidos (
  id                uuid primary key default gen_random_uuid(),
  envio_id          uuid not null references public.envios(id),
  empresa_id        uuid not null references public.empresas(id),
  fecha             date not null,
  comedor_id        uuid not null references public.comedores(id),
  turno_id          uuid not null references public.refrigerio_turnos(id),
  hora_entrega      time not null,
  tipo              text not null check (tipo in ('estandar', 'especial', 'estandar_mas_especial')),
  cantidad          int not null check (cantidad between 1 and 10000),
  cantidad_vigente  int not null check (cantidad_vigente >= 0),
  encargado         text not null check (length(btrim(encargado)) between 3 and 150),
  precio_unitario   numeric(10, 2) not null check (precio_unitario >= 0),
  composicion       text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint pedidos_vigente_ck check (cantidad_vigente <= cantidad)
);
create index on public.refrigerio_pedidos (empresa_id, fecha);
create index on public.refrigerio_pedidos (fecha, comedor_id);
create index on public.refrigerio_pedidos (envio_id);

create table public.refrigerio_pedido_items (
  pedido_id                uuid not null references public.refrigerio_pedidos(id) on delete cascade,
  producto_id              uuid not null references public.refrigerio_productos(id),
  origen                   text not null check (origen in ('estandar', 'especial')),
  cantidad_por_refrigerio  int not null check (cantidad_por_refrigerio between 1 and 100),
  precio_unitario          numeric(10, 2) not null check (precio_unitario >= 0),
  primary key (pedido_id, producto_id, origen)
);

create table public.refrigerio_movimientos (
  id          bigint generated always as identity primary key,
  pedido_id   uuid not null references public.refrigerio_pedidos(id),
  envio_id    uuid not null references public.envios(id),
  tipo        text not null check (tipo in ('solicitud', 'reduccion')),
  cantidad    int not null check (cantidad <> 0),
  created_at  timestamptz not null default now(),
  constraint refrigerio_mov_signo_ck check ((tipo = 'solicitud' and cantidad > 0) or (tipo = 'reduccion' and cantidad < 0))
);
create index on public.refrigerio_movimientos (pedido_id);

do $$
declare t text;
begin
  foreach t in array array['refrigerio_productos', 'refrigerio_producto_precios', 'refrigerio_estandar_items',
                           'refrigerio_estandar_precios', 'refrigerio_turnos', 'refrigerio_pedidos'] loop
    execute format('create trigger %I before update on public.%I for each row execute function seguridad.trg_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['refrigerio_productos', 'refrigerio_producto_precios', 'refrigerio_estandar_items',
                           'refrigerio_estandar_precios', 'refrigerio_turnos'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function seguridad.trg_auditoria(%L)',
                   t || '_auditoria', t, 'catalogos');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------
create or replace function seguridad.puede_ver_refrigerios(p_empresa_id uuid, p_comedor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.activo
       and seguridad.tiene_permiso('refrigerios', 'ver')
       and case c.alcance
             when 'todas' then true
             when 'empresa' then c.empresa_id = p_empresa_id
             when 'comedor' then p_comedor_id is not null and c.comedor_id = p_comedor_id
             else false
           end
    from seguridad.contexto() c
  ), false);
$$;

do $$
declare t text;
begin
  foreach t in array array['refrigerio_productos', 'refrigerio_producto_precios', 'refrigerio_estandar_items',
                           'refrigerio_estandar_precios', 'refrigerio_turnos', 'refrigerio_pedidos',
                           'refrigerio_pedido_items', 'refrigerio_movimientos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
  end loop;
  -- Catálogos: lectura para usuarios activos; escritura con permiso de catálogos.
  foreach t in array array['refrigerio_productos', 'refrigerio_producto_precios', 'refrigerio_estandar_items',
                           'refrigerio_estandar_precios', 'refrigerio_turnos'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($f$create policy %I on public.%I for select to authenticated using ((select seguridad.usuario_activo()))$f$, t || '_leer', t);
    execute format($f$create policy %I on public.%I for insert to authenticated with check ((select seguridad.tiene_permiso('maestras.catalogos', 'editar')))$f$, t || '_crear', t);
    execute format($f$create policy %I on public.%I for update to authenticated using ((select seguridad.tiene_permiso('maestras.catalogos', 'editar'))) with check ((select seguridad.tiene_permiso('maestras.catalogos', 'editar')))$f$, t || '_editar', t);
    execute format($f$create policy %I on public.%I for delete to authenticated using ((select seguridad.tiene_permiso('maestras.catalogos', 'editar')))$f$, t || '_borrar', t);
  end loop;
end $$;

-- Pedidos: solo lectura (las escrituras van por las funciones).
grant select on public.refrigerio_pedidos, public.refrigerio_pedido_items, public.refrigerio_movimientos to authenticated;
revoke insert, update, delete on public.refrigerio_pedidos, public.refrigerio_pedido_items, public.refrigerio_movimientos from authenticated;
create policy refrigerio_pedidos_leer on public.refrigerio_pedidos for select to authenticated
  using (seguridad.puede_ver_refrigerios(empresa_id, comedor_id));
create policy refrigerio_items_leer on public.refrigerio_pedido_items for select to authenticated
  using (exists (select 1 from public.refrigerio_pedidos p where p.id = pedido_id and seguridad.puede_ver_refrigerios(p.empresa_id, p.comedor_id)));
create policy refrigerio_movimientos_leer on public.refrigerio_movimientos for select to authenticated
  using (exists (select 1 from public.refrigerio_pedidos p where p.id = pedido_id and seguridad.puede_ver_refrigerios(p.empresa_id, p.comedor_id)));

-- Cada módulo ve solo sus envíos: los de refrigerios con el permiso de refrigerios.
drop policy envios_leer on public.envios;
create policy envios_leer on public.envios for select to authenticated
  using (
    case when tipo = 'refrigerio' then (select seguridad.tiene_permiso('refrigerios', 'ver'))
         else (select seguridad.tiene_permiso('raciones', 'ver')) end
    and ((select seguridad.mi_alcance()) = 'todas' or empresa_id = (select seguridad.mi_empresa_id()))
  );

-- Borradores: se agrega la pantalla de refrigerios.
alter table public.borradores drop constraint borradores_modulo_check;
alter table public.borradores add constraint borradores_modulo_check
  check (modulo in ('programar', 'adicionar_reducir', 'trasladar', 'refrigerios'));
drop policy borradores_propios on public.borradores;
create policy borradores_propios on public.borradores for all to authenticated
  using (usuario_id = (select auth.uid()) and (select seguridad.usuario_activo()))
  with check (
    usuario_id = (select auth.uid())
    and (select seguridad.usuario_activo())
    and seguridad.puede_ver_empresa(empresa_id)
    and (select seguridad.mi_alcance()) in ('empresa', 'todas')
    and seguridad.tiene_permiso(
          case modulo when 'programar' then 'raciones.programar'
                      when 'adicionar_reducir' then 'raciones.adicionar_reducir'
                      when 'trasladar' then 'raciones.trasladar'
                      else 'refrigerios' end, 'enviar')
    and pg_column_size(filas) < 300000
  );

-- ---------------------------------------------------------------------------
-- Plazos: se agregan los de refrigerios (espejo de src/lib/raciones/plazos.ts).
-- ---------------------------------------------------------------------------
create or replace function seguridad.validar_plazo(p_tipo text, p_fecha date, p_ahora timestamp default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ahora      timestamp := coalesce(p_ahora, now() at time zone seguridad.zona_horaria());
  v_hoy        date := v_ahora::date;
  v_semanas    int;
  v_cierre     jsonb;
  v_dia        int;
  v_hora       text;
  v_permite    boolean;
  v_hora_lim   text;
  v_horas      int;
  v_lunes_hoy  date := v_hoy - (extract(isodow from v_hoy)::int - 1);
  v_lunes_d    date := p_fecha - (extract(isodow from p_fecha)::int - 1);
  v_maximo     date;
  v_limite     timestamp;
  v_dias       text[] := array['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
begin
  select coalesce((select (valor #>> '{}')::int from public.config_horarios where modulo = 'programacion' and regla = 'semanas_maximas'), 6)
    into v_semanas;
  select coalesce((select valor from public.config_horarios where modulo = 'programacion' and regla = 'cierre_semana_siguiente'),
                  '{"dia_semana": 3, "hora": "23:59"}'::jsonb)
    into v_cierre;
  select coalesce((select (valor #>> '{}')::boolean from public.config_horarios where modulo = 'programacion' and regla = 'permite_semana_en_curso'), false)
    into v_permite;
  v_dia := coalesce((v_cierre ->> 'dia_semana')::int, 3);
  v_hora := coalesce(v_cierre ->> 'hora', '23:59');

  -- Plazos "hasta HH:MM del día anterior": adiciones y refrigerios.
  if p_tipo in ('adicion', 'refrigerio') or (p_tipo = 'programacion' and v_lunes_d = v_lunes_hoy and v_permite and p_fecha >= v_hoy) then
    select coalesce((select valor #>> '{}' from public.config_horarios
                     where modulo = case when p_tipo = 'refrigerio' then 'refrigerio' else 'adicion' end
                       and regla = 'hora_limite_dia_anterior'), '17:00')
      into v_hora_lim;
    v_limite := (p_fecha - 1) + v_hora_lim::time;
    if v_ahora < v_limite then
      return null;
    end if;
    return format('El plazo para %s del %s venció el %s a las %s',
                  case when p_tipo = 'refrigerio' then 'refrigerios' else 'adicionales' end,
                  to_char(p_fecha, 'DD/MM'), to_char(v_limite, 'DD/MM'), to_char(v_limite, 'HH24:MI'));
  end if;

  -- Plazos "N horas antes del inicio del día": reducciones, traslados y reducción de refrigerios.
  if p_tipo in ('reduccion', 'traslado', 'refrigerio_reduccion') then
    select coalesce((select (valor #>> '{}')::int from public.config_horarios
                     where (p_tipo = 'refrigerio_reduccion' and modulo = 'refrigerio' and regla = 'horas_anticipacion_reduccion')
                        or (p_tipo <> 'refrigerio_reduccion' and modulo = p_tipo and regla = 'horas_anticipacion')), 48)
      into v_horas;
    v_limite := p_fecha::timestamp - make_interval(hours => v_horas);
    if v_ahora < v_limite then
      return null;
    end if;
    return format('El plazo para %s el %s venció el %s a las %s',
                  case p_tipo when 'reduccion' then 'reducir' when 'traslado' then 'trasladar' else 'reducir refrigerios' end,
                  to_char(p_fecha, 'DD/MM'),
                  to_char(v_limite - interval '1 minute', 'DD/MM'), to_char(v_limite - interval '1 minute', 'HH24:MI'));
  end if;

  if p_tipo = 'programacion' then
    if p_fecha < v_hoy then
      return format('El %s ya pasó', to_char(p_fecha, 'DD/MM'));
    end if;
    v_maximo := v_lunes_hoy + 7 * v_semanas + 6;
    if p_fecha > v_maximo then
      return format('Solo se puede programar hasta el %s (%s semanas)', to_char(v_maximo, 'DD/MM'), v_semanas);
    end if;
    if v_lunes_d = v_lunes_hoy then
      return format('La semana en curso no se programa: para el %s usa Adiciona / Reduce', to_char(p_fecha, 'DD/MM'));
    end if;
    if v_lunes_d = v_lunes_hoy + 7 then
      v_limite := (v_lunes_hoy + v_dia - 1) + v_hora::time + interval '1 minute';
      if v_ahora >= v_limite then
        return format('La programación de la semana del %s cerró el %s %s a las %s: usa Adiciona / Reduce',
                      to_char(v_lunes_d, 'DD/MM'), v_dias[v_dia], to_char(v_lunes_hoy + v_dia - 1, 'DD/MM'), v_hora);
      end if;
    end if;
    return null;
  end if;

  return 'Tipo de plazo no válido';
end;
$$;

-- ---------------------------------------------------------------------------
-- Precios vigentes
-- ---------------------------------------------------------------------------
create or replace function seguridad.precio_producto(p_producto uuid, p_fecha date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select precio from public.refrigerio_producto_precios
  where producto_id = p_producto and p_fecha between vigente_desde and vigente_hasta;
$$;

create or replace function seguridad.precio_estandar(p_fecha date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select precio from public.refrigerio_estandar_precios where p_fecha between vigente_desde and vigente_hasta;
$$;

-- Precios y composición vigentes HOY (para la pantalla; el envío usa los mismos).
create or replace function public.precios_refrigerio()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when seguridad.usuario_activo() then jsonb_build_object(
    'estandar_precio', seguridad.precio_estandar((now() at time zone seguridad.zona_horaria())::date),
    'estandar_items', coalesce((
      select jsonb_agg(jsonb_build_object('producto_id', e.producto_id, 'cantidad', e.cantidad) order by p.orden, p.nombre)
      from public.refrigerio_estandar_items e join public.refrigerio_productos p on p.id = e.producto_id
      where p.activo
    ), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre,
                                          'precio', seguridad.precio_producto(p.id, (now() at time zone seguridad.zona_horaria())::date))
                       order by p.orden, p.nombre)
      from public.refrigerio_productos p where p.activo
    ), '[]'::jsonb)
  ) end;
$$;
revoke execute on function public.precios_refrigerio() from public, anon;
grant execute on function public.precios_refrigerio() to authenticated;

-- ---------------------------------------------------------------------------
-- Enviar refrigerios.
-- p_pedidos: [{fecha, comedor_id, turno_id, tipo, cantidad, encargado,
--              items: [{producto_id, cantidad}]}]   (items = productos especiales, por refrigerio)
-- ---------------------------------------------------------------------------
create or replace function public.enviar_refrigerios(p_empresa_id uuid, p_pedidos jsonb, p_clave uuid, p_motivo text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx           record;
  v_super       boolean;
  v_motivo      text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_envio       uuid;
  v_dueno       uuid;
  v_huella      text;
  v_huella_ant  text;
  v_hoy         date := (now() at time zone seguridad.zona_horaria())::date;
  v_desde       time;
  v_hasta       time;
  v_fuera       boolean := false;
  v_n           int := 0;
  v_total       int := 0;
  p             jsonb;
  it            jsonb;
  v_fecha       date;
  v_comedor     uuid;
  v_turno       uuid;
  v_hora        time;
  v_tipo        text;
  v_cant        int;
  v_encargado   text;
  v_precio_est  numeric;
  v_precio_u    numeric;
  v_precio_p    numeric;
  v_pedido      uuid;
  v_plazo       text;
  v_composicion text;
  v_registros   jsonb := '[]'::jsonb;
  v_correo      text;
begin
  select * into ctx from seguridad.contexto() c where c.activo;
  if not found then
    raise exception 'Sesión no válida' using errcode = '42501';
  end if;
  if not seguridad.tiene_permiso('refrigerios', 'enviar') then
    raise exception 'No tienes permiso para registrar refrigerios' using errcode = '42501';
  end if;
  if ctx.alcance = 'comedor' or (ctx.alcance = 'empresa' and ctx.empresa_id is distinct from p_empresa_id) then
    raise exception 'No puedes registrar refrigerios para esa empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from public.empresas where id = p_empresa_id and activo) then
    raise exception 'La empresa no existe o está inactiva' using errcode = '22023';
  end if;
  if p_clave is null then
    raise exception 'Falta la clave del envío' using errcode = '22023';
  end if;
  if exists (select 1 from public.perfiles where id = ctx.usuario_id and debe_cambiar_password) then
    raise exception 'Debes cambiar tu contraseña antes de continuar' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('refrigerios:' || p_empresa_id::text));
  -- La composición estándar no cambia mientras se envía (ver guardar_estandar_refrigerio).
  perform pg_advisory_xact_lock_shared(hashtext('refrigerio_estandar'));
  v_huella := md5('refrigerio|' || p_empresa_id::text || '|' || coalesce(p_pedidos::text, '') || '|' || coalesce(v_motivo, ''));
  select id, usuario_id, huella into v_envio, v_dueno, v_huella_ant from public.envios where clave_idempotencia = p_clave;
  if found then
    if v_dueno is distinct from ctx.usuario_id or v_huella_ant is distinct from v_huella then
      raise exception 'Este envío ya se registró con otro contenido. Revisa los pedidos registrados y vuelve a enviar.' using errcode = '22023';
    end if;
    return v_envio;
  end if;

  if jsonb_typeof(p_pedidos) is distinct from 'array' or jsonb_array_length(p_pedidos) not between 1 and 300 then
    raise exception 'El envío debe tener entre 1 y 300 pedidos' using errcode = '22023';
  end if;
  v_super := seguridad.es_superadmin();
  if v_motivo is not null and not v_super then
    raise exception 'Solo el Superadmin puede registrar fuera de plazo' using errcode = '42501';
  end if;
  if v_motivo is not null and length(v_motivo) not between 5 and 500 then
    raise exception 'El motivo debe tener entre 5 y 500 caracteres' using errcode = '22023';
  end if;

  select coalesce((select (valor #>> '{}')::time from public.config_horarios where modulo = 'refrigerio' and regla = 'entrega_desde'), '06:00'),
         coalesce((select (valor #>> '{}')::time from public.config_horarios where modulo = 'refrigerio' and regla = 'entrega_hasta'), '21:30')
    into v_desde, v_hasta;
  v_precio_est := seguridad.precio_estandar(v_hoy);

  insert into public.envios (empresa_id, usuario_id, tipo, clave_idempotencia, motivo_excepcion, huella)
  values (p_empresa_id, ctx.usuario_id, 'refrigerio', p_clave, v_motivo, v_huella)
  returning id into v_envio;

  for p in select value from jsonb_array_elements(p_pedidos) loop
    v_n := v_n + 1;
    begin
      v_fecha := (p ->> 'fecha')::date;
      v_comedor := (p ->> 'comedor_id')::uuid;
      v_turno := (p ->> 'turno_id')::uuid;
      v_tipo := p ->> 'tipo';
      v_cant := (p ->> 'cantidad')::int;
      v_encargado := btrim(coalesce(p ->> 'encargado', ''));
    exception when others then
      raise exception 'El pedido % tiene datos no válidos', v_n using errcode = '22023';
    end;
    if v_fecha is null or v_comedor is null or v_turno is null or v_cant is null or v_cant not between 1 and 10000 then
      raise exception 'El pedido % tiene datos incompletos o una cantidad no válida', v_n using errcode = '22023';
    end if;
    if v_tipo not in ('estandar', 'especial', 'estandar_mas_especial') then
      raise exception 'El pedido % tiene un tipo no válido', v_n using errcode = '22023';
    end if;
    if length(v_encargado) not between 3 and 150 then
      raise exception 'Indica el encargado de recojo (pedido %)', v_n using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(p -> 'items', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) > 30 then
      raise exception 'El pedido % tiene productos no válidos', v_n using errcode = '22023';
    end if;
    if (v_tipo = 'estandar') <> (jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0) then
      raise exception 'El pedido % no coincide con su tipo (estándar sin productos adicionales; especial con productos)', v_n using errcode = '22023';
    end if;
    if (select count(*) <> count(distinct x ->> 'producto_id') from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) x) then
      raise exception 'El pedido % repite un producto', v_n using errcode = '22023';
    end if;

    v_plazo := seguridad.validar_plazo('refrigerio', v_fecha);
    if v_plazo is not null then
      if v_super and v_motivo is not null then
        v_fuera := true;
      else
        raise exception '%', v_plazo using errcode = '22023';
      end if;
    end if;
    if not exists (select 1 from public.comedores where id = v_comedor and activo and habilitado_refrigerios) then
      raise exception 'El comedor no está habilitado para refrigerios (pedido %)', v_n using errcode = '22023';
    end if;
    select hora into v_hora from public.refrigerio_turnos where id = v_turno and activo;
    if v_hora is null or v_hora < v_desde or v_hora > v_hasta then
      raise exception 'La hora de entrega no está disponible (pedido %)', v_n using errcode = '22023';
    end if;

    v_precio_u := 0;
    if v_tipo in ('estandar', 'estandar_mas_especial') then
      if v_precio_est is null or not exists (select 1 from public.refrigerio_estandar_items e
                                             join public.refrigerio_productos pr on pr.id = e.producto_id where pr.activo) then
        raise exception 'El refrigerio estándar no tiene precio o composición vigente' using errcode = '22023';
      end if;
      v_precio_u := v_precio_est;
    end if;

    insert into public.refrigerio_pedidos (envio_id, empresa_id, fecha, comedor_id, turno_id, hora_entrega, tipo, cantidad,
                                           cantidad_vigente, encargado, precio_unitario, composicion)
    values (v_envio, p_empresa_id, v_fecha, v_comedor, v_turno, v_hora, v_tipo, v_cant, v_cant, v_encargado, 0, '')
    returning id into v_pedido;

    if v_tipo in ('estandar', 'estandar_mas_especial') then
      insert into public.refrigerio_pedido_items (pedido_id, producto_id, origen, cantidad_por_refrigerio, precio_unitario)
      select v_pedido, e.producto_id, 'estandar', e.cantidad, 0
      from public.refrigerio_estandar_items e join public.refrigerio_productos pr on pr.id = e.producto_id
      where pr.activo;
    end if;

    for it in select value from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
      begin
        if (it ->> 'cantidad')::int not between 1 and 100 then
          raise exception 'x';
        end if;
        v_precio_p := seguridad.precio_producto((it ->> 'producto_id')::uuid, v_hoy);
      exception when others then
        raise exception 'Un producto del pedido % no es válido', v_n using errcode = '22023';
      end;
      if v_precio_p is null or not exists (select 1 from public.refrigerio_productos where id = (it ->> 'producto_id')::uuid and activo) then
        raise exception 'Un producto del pedido % no está disponible o no tiene precio vigente', v_n using errcode = '22023';
      end if;
      insert into public.refrigerio_pedido_items (pedido_id, producto_id, origen, cantidad_por_refrigerio, precio_unitario)
      values (v_pedido, (it ->> 'producto_id')::uuid, 'especial', (it ->> 'cantidad')::int, v_precio_p);
      v_precio_u := v_precio_u + v_precio_p * (it ->> 'cantidad')::int;
    end loop;

    -- Composición congelada (texto, como en el correo) y precio por refrigerio.
    select string_agg(x.cantidad || ' ' || x.nombre, E'\n' order by x.orden, x.nombre)
      into v_composicion
    from (
      select pr.nombre, pr.orden, sum(i.cantidad_por_refrigerio) as cantidad
      from public.refrigerio_pedido_items i join public.refrigerio_productos pr on pr.id = i.producto_id
      where i.pedido_id = v_pedido
      group by pr.id, pr.nombre, pr.orden
    ) x;
    update public.refrigerio_pedidos set precio_unitario = round(v_precio_u, 2), composicion = coalesce(v_composicion, '')
    where id = v_pedido;

    insert into public.refrigerio_movimientos (pedido_id, envio_id, tipo, cantidad) values (v_pedido, v_envio, 'solicitud', v_cant);
    v_total := v_total + v_cant;
    v_registros := v_registros || jsonb_build_object(
      'fecha', v_fecha,
      'comedor', (select nombre from public.comedores where id = v_comedor),
      'turno', (select etiqueta from public.refrigerio_turnos where id = v_turno),
      'composicion', coalesce(v_composicion, ''),
      'cantidad', v_cant,
      'precio', 'S/ ' || replace(to_char(round(v_precio_u, 2) * v_cant, 'FM999999990.00'), '.', ','),
      'tipo', case v_tipo when 'estandar' then 'Estándar' when 'especial' then 'Especial' else 'Estándar + especial' end,
      'encargado', upper(v_encargado)
    );
  end loop;

  update public.envios set total_filas = v_n, total_raciones = v_total, fuera_de_plazo = v_fuera where id = v_envio;

  insert into public.auditoria (usuario_id, empresa_id, modulo, accion, entidad, entidad_id, detalle)
  values (ctx.usuario_id, p_empresa_id, 'refrigerios', 'enviar_refrigerios', 'envios', v_envio::text,
          jsonb_build_object('pedidos', v_n, 'total', v_total, 'fuera_de_plazo', v_fuera, 'motivo', v_motivo));

  select correo into v_correo from public.perfiles where id = ctx.usuario_id;
  perform seguridad.encolar_correo(
    'solicitud_refrigerios',
    jsonb_build_object('usuario', (select nombre from public.perfiles where id = ctx.usuario_id), 'registros', v_registros),
    array[v_correo], p_empresa_id, v_envio, true
  );
  return v_envio;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reducir (o anular) un pedido ya enviado.
-- ---------------------------------------------------------------------------
create or replace function public.reducir_refrigerio(p_pedido_id uuid, p_cantidad int, p_clave uuid, p_motivo text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx        record;
  ped        public.refrigerio_pedidos;
  v_super    boolean;
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_envio    uuid;
  v_dueno    uuid;
  v_huella   text;
  v_huella_ant text;
  v_plazo    text;
  v_fuera    boolean := false;
  v_correo   text;
begin
  select * into ctx from seguridad.contexto() c where c.activo;
  if not found or not seguridad.tiene_permiso('refrigerios', 'enviar') then
    raise exception 'No tienes permiso para modificar refrigerios' using errcode = '42501';
  end if;
  if exists (select 1 from public.perfiles where id = ctx.usuario_id and debe_cambiar_password) then
    raise exception 'Debes cambiar tu contraseña antes de continuar' using errcode = '42501';
  end if;
  if p_clave is null or p_cantidad is null or p_cantidad < 1 then
    raise exception 'Indica una cantidad mayor que 0' using errcode = '22023';
  end if;

  select * into ped from public.refrigerio_pedidos where id = p_pedido_id;
  if not found or ctx.alcance = 'comedor' or (ctx.alcance = 'empresa' and ctx.empresa_id is distinct from ped.empresa_id) then
    raise exception 'Pedido no encontrado' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('refrigerios:' || ped.empresa_id::text));
  select * into ped from public.refrigerio_pedidos where id = p_pedido_id for update;

  v_huella := md5('reduccion|' || p_pedido_id::text || '|' || p_cantidad || '|' || coalesce(v_motivo, ''));
  select id, usuario_id, huella into v_envio, v_dueno, v_huella_ant from public.envios where clave_idempotencia = p_clave;
  if found then
    if v_dueno is distinct from ctx.usuario_id or v_huella_ant is distinct from v_huella then
      raise exception 'Este envío ya se registró con otro contenido' using errcode = '22023';
    end if;
    return v_envio;
  end if;

  v_super := seguridad.es_superadmin();
  if v_motivo is not null and (not v_super or length(v_motivo) not between 5 and 500) then
    raise exception 'Solo el Superadmin puede registrar fuera de plazo, con un motivo de 5 a 500 caracteres' using errcode = '42501';
  end if;
  v_plazo := seguridad.validar_plazo('refrigerio_reduccion', ped.fecha);
  if v_plazo is not null then
    if v_super and v_motivo is not null then
      v_fuera := true;
    else
      raise exception '%', v_plazo using errcode = '22023';
    end if;
  end if;
  if p_cantidad > ped.cantidad_vigente then
    raise exception 'El pedido solo tiene % refrigerios vigentes', ped.cantidad_vigente using errcode = '22023';
  end if;

  insert into public.envios (empresa_id, usuario_id, tipo, clave_idempotencia, total_filas, total_raciones, fuera_de_plazo, motivo_excepcion, huella)
  values (ped.empresa_id, ctx.usuario_id, 'refrigerio', p_clave, 1, -p_cantidad, v_fuera, v_motivo, v_huella)
  returning id into v_envio;
  update public.refrigerio_pedidos set cantidad_vigente = cantidad_vigente - p_cantidad where id = ped.id;
  insert into public.refrigerio_movimientos (pedido_id, envio_id, tipo, cantidad) values (ped.id, v_envio, 'reduccion', -p_cantidad);

  insert into public.auditoria (usuario_id, empresa_id, modulo, accion, entidad, entidad_id, detalle)
  values (ctx.usuario_id, ped.empresa_id, 'refrigerios', 'reducir_refrigerio', 'refrigerio_pedidos', ped.id::text,
          jsonb_build_object('cantidad', p_cantidad, 'vigente', ped.cantidad_vigente - p_cantidad, 'fuera_de_plazo', v_fuera, 'motivo', v_motivo));

  select correo into v_correo from public.perfiles where id = ctx.usuario_id;
  perform seguridad.encolar_correo(
    'solicitud_refrigerios',
    jsonb_build_object(
      'usuario', (select nombre from public.perfiles where id = ctx.usuario_id),
      'registros', jsonb_build_array(jsonb_build_object(
        'fecha', ped.fecha,
        'comedor', (select nombre from public.comedores where id = ped.comedor_id),
        'turno', (select etiqueta from public.refrigerio_turnos where id = ped.turno_id),
        'composicion', ped.composicion,
        'cantidad', -p_cantidad,
        'precio', 'S/ -' || replace(to_char(ped.precio_unitario * p_cantidad, 'FM999999990.00'), '.', ','),
        'tipo', 'Reducción',
        'encargado', upper(ped.encargado)
      ))
    ),
    array[v_correo], ped.empresa_id, v_envio, true
  );
  return v_envio;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guardar la composición estándar en una sola transacción (Catálogos).
-- p_items: [{producto_id, cantidad}]
-- ---------------------------------------------------------------------------
create or replace function public.guardar_estandar_refrigerio(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not seguridad.tiene_permiso('maestras.catalogos', 'editar') then
    raise exception 'No tienes permiso para editar catálogos' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'El refrigerio estándar debe tener al menos un producto' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('refrigerio_estandar'));
  delete from public.refrigerio_estandar_items where true;
  insert into public.refrigerio_estandar_items (producto_id, cantidad)
  select (x ->> 'producto_id')::uuid, (x ->> 'cantidad')::int from jsonb_array_elements(p_items) x;
end;
$$;
revoke execute on function public.guardar_estandar_refrigerio(jsonb) from public, anon;
grant execute on function public.guardar_estandar_refrigerio(jsonb) to authenticated;

revoke execute on function public.enviar_refrigerios(uuid, jsonb, uuid, text) from public, anon;
revoke execute on function public.reducir_refrigerio(uuid, int, uuid, text) from public, anon;
grant execute on function public.enviar_refrigerios(uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.reducir_refrigerio(uuid, int, uuid, text) to authenticated;

-- Turnos de entrega por defecto (configurables desde Catálogos).
insert into public.refrigerio_turnos (hora, etiqueta) values
  ('09:30', '9:30 am'), ('11:30', '11:30 am'), ('18:00', '6:00 pm')
on conflict (hora) do nothing;

revoke execute on all functions in schema seguridad from public, anon;
grant execute on all functions in schema seguridad to authenticated, service_role;
revoke execute on function seguridad.mover_saldo(uuid, date, uuid, uuid, uuid, int) from authenticated;
revoke execute on function seguridad.encolar_correo(text, jsonb, text[], uuid, uuid, boolean) from authenticated;
revoke execute on function seguridad.disparar_envio_correos() from authenticated;
