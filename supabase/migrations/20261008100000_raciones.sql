-- =============================================================================
-- Kuntur Wasi · Fase 4: raciones.
--
-- Modelo: cada clic en "Enviar" crea un ENVÍO y sus MOVIMIENTOS (inmutables:
-- programación, adición, reducción, traslado salida / entrada). Los SALDOS por
-- (empresa, fecha, frente, comedor, servicio) se actualizan en la misma
-- transacción y nunca bajan de 0. Todo pasa por public.enviar_raciones(), que
-- valida permisos, plazos, catálogos y saldos, y deja auditoría y correo.
-- =============================================================================

create table public.envios (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresas(id),
  usuario_id          uuid not null default auth.uid(),
  tipo                text not null check (tipo in ('programacion', 'adicion_reduccion', 'traslado', 'refrigerio', 'migracion')),
  clave_idempotencia  uuid not null unique,
  enviado_en          timestamptz not null default now(),
  total_filas         int not null default 0,
  total_raciones      int not null default 0,
  fuera_de_plazo      boolean not null default false,
  motivo_excepcion    text check (length(motivo_excepcion) <= 500)
);
create index on public.envios (empresa_id, enviado_en desc);

create table public.racion_movimientos (
  id               bigint generated always as identity primary key,
  envio_id         uuid not null references public.envios(id),
  empresa_id       uuid not null references public.empresas(id),
  fecha            date not null,
  frente_id        uuid not null references public.frentes_trabajo(id),
  comedor_id       uuid not null references public.comedores(id),
  servicio_id      uuid not null references public.servicios(id),
  tipo_movimiento  text not null check (tipo_movimiento in ('programacion', 'adicion', 'reduccion', 'traslado_salida', 'traslado_entrada', 'migracion')),
  cantidad         int not null check (cantidad <> 0),
  traslado_par     bigint references public.racion_movimientos(id),
  created_at       timestamptz not null default now(),
  constraint movimientos_signo_ck check (
    (tipo_movimiento in ('programacion', 'adicion', 'traslado_entrada') and cantidad > 0)
    or (tipo_movimiento in ('reduccion', 'traslado_salida') and cantidad < 0)
    or tipo_movimiento = 'migracion'
  )
);
create index on public.racion_movimientos (empresa_id, fecha);
create index on public.racion_movimientos (fecha, comedor_id, servicio_id);
create index on public.racion_movimientos (envio_id);

create table public.racion_saldos (
  empresa_id   uuid not null references public.empresas(id),
  fecha        date not null,
  frente_id    uuid not null references public.frentes_trabajo(id),
  comedor_id   uuid not null references public.comedores(id),
  servicio_id  uuid not null references public.servicios(id),
  cantidad     int not null default 0 check (cantidad >= 0),
  updated_at   timestamptz not null default now(),
  primary key (empresa_id, fecha, frente_id, comedor_id, servicio_id)
);
create index on public.racion_saldos (fecha, comedor_id, servicio_id);

-- Grilla de previsualización (borrador) por usuario, empresa y pantalla.
create table public.borradores (
  usuario_id  uuid not null default auth.uid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  modulo      text not null check (modulo in ('programar', 'adicionar_reducir', 'trasladar')),
  filas       jsonb not null default '[]' check (jsonb_typeof(filas) = 'array' and jsonb_array_length(filas) <= 500),
  updated_at  timestamptz not null default now(),
  primary key (usuario_id, empresa_id, modulo)
);

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------

-- ¿El usuario puede ver raciones de esta empresa / comedor?
--   alcance "todas": todo · "empresa": su empresa · "comedor": su comedor.
create or replace function seguridad.puede_ver_raciones(p_empresa_id uuid, p_comedor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.activo
       and seguridad.tiene_permiso('raciones', 'ver')
       and case c.alcance
             when 'todas' then true
             when 'empresa' then c.empresa_id = p_empresa_id
             when 'comedor' then p_comedor_id is not null and c.comedor_id = p_comedor_id
             else false
           end
    from seguridad.contexto() c
  ), false);
$$;

alter table public.envios enable row level security;
alter table public.racion_movimientos enable row level security;
alter table public.racion_saldos enable row level security;
alter table public.borradores enable row level security;

revoke all on public.envios, public.racion_movimientos, public.racion_saldos, public.borradores from anon;
revoke insert, update, delete, truncate on public.envios, public.racion_movimientos, public.racion_saldos from authenticated;
grant select on public.envios, public.racion_movimientos, public.racion_saldos to authenticated;
grant select, insert, update, delete on public.borradores to authenticated;
revoke truncate on public.borradores from authenticated;

create policy envios_leer on public.envios for select to authenticated
  using (
    (select seguridad.tiene_permiso('raciones', 'ver'))
    and ((select seguridad.mi_alcance()) = 'todas' or empresa_id = (select seguridad.mi_empresa_id()))
  );
create policy movimientos_leer on public.racion_movimientos for select to authenticated
  using (seguridad.puede_ver_raciones(empresa_id, comedor_id));
create policy saldos_leer on public.racion_saldos for select to authenticated
  using (seguridad.puede_ver_raciones(empresa_id, comedor_id));

create policy borradores_propios on public.borradores for all to authenticated
  using (usuario_id = (select auth.uid()) and (select seguridad.usuario_activo()))
  with check (usuario_id = (select auth.uid()) and (select seguridad.usuario_activo()) and seguridad.puede_ver_empresa(empresa_id));

create trigger borradores_updated_at before update on public.borradores
  for each row execute function seguridad.trg_updated_at();
create trigger racion_saldos_updated_at before update on public.racion_saldos
  for each row execute function seguridad.trg_updated_at();

-- ---------------------------------------------------------------------------
-- Plazos (espejo exacto de src/lib/raciones/plazos.ts). Devuelve NULL si se
-- puede, o el motivo si no. Los plazos son exclusivos.
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
  v_hora_adic  text;
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
  select coalesce((select valor #>> '{}' from public.config_horarios where modulo = 'adicion' and regla = 'hora_limite_dia_anterior'), '17:00')
    into v_hora_adic;
  v_dia := coalesce((v_cierre ->> 'dia_semana')::int, 3);
  v_hora := coalesce(v_cierre ->> 'hora', '23:59');

  if p_tipo = 'adicion' or (p_tipo = 'programacion' and v_lunes_d = v_lunes_hoy and v_permite and p_fecha >= v_hoy) then
    v_limite := (p_fecha - 1) + v_hora_adic::time;
    if v_ahora < v_limite then
      return null;
    end if;
    return format('El plazo para adicionales del %s venció el %s a las %s',
                  to_char(p_fecha, 'DD/MM'), to_char(v_limite, 'DD/MM'), to_char(v_limite, 'HH24:MI'));
  end if;

  if p_tipo in ('reduccion', 'traslado') then
    select coalesce((select (valor #>> '{}')::int from public.config_horarios where modulo = p_tipo and regla = 'horas_anticipacion'), 48)
      into v_horas;
    v_limite := p_fecha::timestamp - make_interval(hours => v_horas);
    if v_ahora < v_limite then
      return null;
    end if;
    return format('El plazo para %s el %s venció el %s a las %s',
                  case p_tipo when 'reduccion' then 'reducir' else 'trasladar' end,
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

-- Catálogo de una fila con raciones nuevas: frente asignado y vigente, comedor y servicio activos.
create or replace function seguridad.validar_destino_racion(p_empresa uuid, p_fecha date, p_frente uuid, p_comedor uuid, p_servicio uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.empresa_frentes ef
    join public.frentes_trabajo f on f.id = ef.frente_id
    where ef.empresa_id = p_empresa and ef.frente_id = p_frente and ef.activo and f.activo
      and (ef.contrato_desde is null or p_fecha >= ef.contrato_desde)
      and (ef.contrato_hasta is null or p_fecha <= ef.contrato_hasta)
  ) then
    return format('El frente de trabajo no está asignado a la empresa o su contrato no cubre el %s', to_char(p_fecha, 'DD/MM'));
  end if;
  if not exists (select 1 from public.comedores where id = p_comedor and activo and habilitado_raciones) then
    return 'El comedor no está habilitado para raciones';
  end if;
  if not exists (
    select 1 from public.comedor_servicios cs join public.servicios s on s.id = cs.servicio_id
    where cs.comedor_id = p_comedor and cs.servicio_id = p_servicio and cs.activo and s.activo
  ) then
    return 'El comedor no ofrece ese servicio';
  end if;
  return null;
end;
$$;

-- Traslados: mismo sector (según la matriz) y servicio compatible.
create or replace function seguridad.validar_traslado(p_comedor_o uuid, p_servicio_o uuid, p_comedor_d uuid, p_servicio_d uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_permitido  boolean;
  v_sector_o   uuid;
  v_sector_d   uuid;
begin
  if p_comedor_o = p_comedor_d and p_servicio_o = p_servicio_d then
    return 'El destino debe tener otro comedor u otro servicio';
  end if;
  select sector_id into v_sector_o from public.comedores where id = p_comedor_o;
  select sector_id into v_sector_d from public.comedores where id = p_comedor_d;
  if p_comedor_o <> p_comedor_d and not exists (
    select 1 from public.traslado_reglas_sector
    where sector_origen_id = v_sector_o and sector_destino_id = v_sector_d
  ) then
    return 'No se permite trasladar raciones a un comedor de otro sector';
  end if;
  select permitido into v_permitido
  from public.traslado_reglas_servicio
  where servicio_origen_id = p_servicio_o and servicio_destino_id = p_servicio_d;
  if v_permitido is null then
    v_permitido := (select tipo_servicio_id from public.servicios where id = p_servicio_o)
                 = (select tipo_servicio_id from public.servicios where id = p_servicio_d);
  end if;
  if not v_permitido then
    return 'Ese servicio no es compatible para el traslado';
  end if;
  return null;
end;
$$;

-- Suma (o resta) a un saldo con bloqueo de fila. Nunca deja un saldo negativo.
create or replace function seguridad.mover_saldo(p_empresa uuid, p_fecha date, p_frente uuid, p_comedor uuid, p_servicio uuid, p_cantidad int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual int;
begin
  if p_cantidad > 0 then
    insert into public.racion_saldos (empresa_id, fecha, frente_id, comedor_id, servicio_id, cantidad)
    values (p_empresa, p_fecha, p_frente, p_comedor, p_servicio, p_cantidad)
    on conflict (empresa_id, fecha, frente_id, comedor_id, servicio_id)
    do update set cantidad = public.racion_saldos.cantidad + excluded.cantidad;
    return;
  end if;
  select cantidad into v_actual
  from public.racion_saldos
  where empresa_id = p_empresa and fecha = p_fecha and frente_id = p_frente and comedor_id = p_comedor and servicio_id = p_servicio
  for update;
  if coalesce(v_actual, 0) + p_cantidad < 0 then
    raise exception 'El % solo hay % raciones registradas; no puedes quitar %',
      to_char(p_fecha, 'DD/MM'), coalesce(v_actual, 0), -p_cantidad
      using errcode = '22023';
  end if;
  update public.racion_saldos set cantidad = cantidad + p_cantidad
  where empresa_id = p_empresa and fecha = p_fecha and frente_id = p_frente and comedor_id = p_comedor and servicio_id = p_servicio;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enviar raciones (programación, adición/reducción o traslado).
--
-- p_filas:
--   programacion / adicion_reduccion: [{fecha, frente_id, comedor_id, servicio_id, cantidad}]
--     (en adicion_reduccion, cantidad > 0 es adición y < 0 es reducción)
--   traslado: [{fecha, frente_id, comedor_id, servicio_id, comedor_destino_id, servicio_destino_id, cantidad}]
-- p_clave:  clave de idempotencia (un doble clic no duplica el envío)
-- p_motivo: solo Superadmin, para registrar fuera de plazo
-- ---------------------------------------------------------------------------
create or replace function public.enviar_raciones(
  p_tipo        text,
  p_empresa_id  uuid,
  p_filas       jsonb,
  p_clave       uuid,
  p_motivo      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx          record;
  v_menu       text;
  v_super      boolean;
  v_motivo     text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_envio      uuid;
  v_dueno      uuid;
  v_fuera      boolean := false;
  v_filas      int := 0;
  v_total      int := 0;
  f            jsonb;
  v_fecha      date;
  v_frente     uuid;
  v_comedor    uuid;
  v_servicio   uuid;
  v_comedor_d  uuid;
  v_servicio_d uuid;
  v_cant       int;
  v_tipo_mov   text;
  v_plazo      text;
  v_msg        text;
  v_salida     bigint;
  v_correo     text;
  v_plantilla  text;
  v_registros  jsonb := '[]'::jsonb;
begin
  select * into ctx from seguridad.contexto() c where c.activo;
  if not found then
    raise exception 'Sesión no válida' using errcode = '42501';
  end if;

  v_menu := case p_tipo
              when 'programacion' then 'raciones.programar'
              when 'adicion_reduccion' then 'raciones.adicionar_reducir'
              when 'traslado' then 'raciones.trasladar'
            end;
  if v_menu is null then
    raise exception 'Tipo de envío no válido' using errcode = '22023';
  end if;
  if not seguridad.tiene_permiso(v_menu, 'enviar') then
    raise exception 'No tienes permiso para enviar raciones' using errcode = '42501';
  end if;
  if ctx.alcance = 'comedor' or (ctx.alcance = 'empresa' and ctx.empresa_id is distinct from p_empresa_id) then
    raise exception 'No puedes registrar raciones para esa empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from public.empresas where id = p_empresa_id and activo) then
    raise exception 'La empresa no existe o está inactiva' using errcode = '22023';
  end if;
  if p_clave is null then
    raise exception 'Falta la clave del envío' using errcode = '22023';
  end if;

  -- Idempotencia: el mismo envío repetido devuelve el original.
  select id, usuario_id into v_envio, v_dueno from public.envios where clave_idempotencia = p_clave;
  if found then
    if v_dueno is distinct from ctx.usuario_id then
      raise exception 'Clave de envío no válida' using errcode = '22023';
    end if;
    return v_envio;
  end if;

  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) not between 1 and 500 then
    raise exception 'El envío debe tener entre 1 y 500 filas' using errcode = '22023';
  end if;

  v_super := seguridad.es_superadmin();
  if v_motivo is not null and not v_super then
    raise exception 'Solo el Superadmin puede registrar fuera de plazo' using errcode = '42501';
  end if;
  if v_motivo is not null and length(v_motivo) not between 5 and 500 then
    raise exception 'El motivo debe tener entre 5 y 500 caracteres' using errcode = '22023';
  end if;

  insert into public.envios (empresa_id, usuario_id, tipo, clave_idempotencia, motivo_excepcion)
  values (p_empresa_id, ctx.usuario_id, p_tipo, p_clave, v_motivo)
  returning id into v_envio;

  -- Orden fijo de las filas: evita bloqueos cruzados entre envíos simultáneos.
  for f in
    select value from jsonb_array_elements(p_filas)
    order by value ->> 'fecha', value ->> 'frente_id', value ->> 'comedor_id', value ->> 'servicio_id'
  loop
    v_filas := v_filas + 1;
    begin
      v_fecha := (f ->> 'fecha')::date;
      v_frente := (f ->> 'frente_id')::uuid;
      v_comedor := (f ->> 'comedor_id')::uuid;
      v_servicio := (f ->> 'servicio_id')::uuid;
      v_cant := (f ->> 'cantidad')::int;
      v_comedor_d := nullif(f ->> 'comedor_destino_id', '')::uuid;
      v_servicio_d := nullif(f ->> 'servicio_destino_id', '')::uuid;
    exception when others then
      raise exception 'La fila % tiene datos no válidos', v_filas using errcode = '22023';
    end;
    if v_fecha is null or v_frente is null or v_comedor is null or v_servicio is null
       or v_cant is null or v_cant = 0 or abs(v_cant) > 10000 then
      raise exception 'La fila % tiene datos incompletos o una cantidad no válida', v_filas using errcode = '22023';
    end if;

    v_tipo_mov := case
                    when p_tipo = 'programacion' and v_cant > 0 then 'programacion'
                    when p_tipo = 'adicion_reduccion' and v_cant > 0 then 'adicion'
                    when p_tipo = 'adicion_reduccion' and v_cant < 0 then 'reduccion'
                    when p_tipo = 'traslado' and v_cant > 0 then 'traslado'
                  end;
    if v_tipo_mov is null then
      raise exception 'La fila % tiene una cantidad no válida para este tipo de envío', v_filas using errcode = '22023';
    end if;

    -- Plazo (el Superadmin puede saltarlo indicando un motivo).
    v_plazo := seguridad.validar_plazo(v_tipo_mov, v_fecha);
    if v_plazo is not null then
      if v_super and v_motivo is not null then
        v_fuera := true;
      else
        raise exception '%', v_plazo using errcode = '22023';
      end if;
    end if;

    if v_tipo_mov in ('programacion', 'adicion') then
      v_msg := seguridad.validar_destino_racion(p_empresa_id, v_fecha, v_frente, v_comedor, v_servicio);
      if v_msg is not null then
        raise exception '% (fila %)', v_msg, v_filas using errcode = '22023';
      end if;
      perform seguridad.mover_saldo(p_empresa_id, v_fecha, v_frente, v_comedor, v_servicio, v_cant);
      insert into public.racion_movimientos (envio_id, empresa_id, fecha, frente_id, comedor_id, servicio_id, tipo_movimiento, cantidad)
      values (v_envio, p_empresa_id, v_fecha, v_frente, v_comedor, v_servicio, v_tipo_mov, v_cant);
      v_registros := v_registros || jsonb_build_object('orden', v_filas * 2, 'fecha', v_fecha, 'frente_id', v_frente,
                                                       'comedor_id', v_comedor, 'servicio_id', v_servicio, 'cantidad', v_cant);
      v_total := v_total + v_cant;

    elsif v_tipo_mov = 'reduccion' then
      perform seguridad.mover_saldo(p_empresa_id, v_fecha, v_frente, v_comedor, v_servicio, v_cant);
      insert into public.racion_movimientos (envio_id, empresa_id, fecha, frente_id, comedor_id, servicio_id, tipo_movimiento, cantidad)
      values (v_envio, p_empresa_id, v_fecha, v_frente, v_comedor, v_servicio, 'reduccion', v_cant);
      v_registros := v_registros || jsonb_build_object('orden', v_filas * 2, 'fecha', v_fecha, 'frente_id', v_frente,
                                                       'comedor_id', v_comedor, 'servicio_id', v_servicio, 'cantidad', v_cant);
      v_total := v_total + v_cant;

    else -- traslado
      if v_comedor_d is null or v_servicio_d is null then
        raise exception 'La fila % no indica el comedor y el servicio de destino', v_filas using errcode = '22023';
      end if;
      v_msg := coalesce(
        seguridad.validar_traslado(v_comedor, v_servicio, v_comedor_d, v_servicio_d),
        seguridad.validar_destino_racion(p_empresa_id, v_fecha, v_frente, v_comedor_d, v_servicio_d)
      );
      if v_msg is not null then
        raise exception '% (fila %)', v_msg, v_filas using errcode = '22023';
      end if;
      perform seguridad.mover_saldo(p_empresa_id, v_fecha, v_frente, v_comedor, v_servicio, -v_cant);
      insert into public.racion_movimientos (envio_id, empresa_id, fecha, frente_id, comedor_id, servicio_id, tipo_movimiento, cantidad)
      values (v_envio, p_empresa_id, v_fecha, v_frente, v_comedor, v_servicio, 'traslado_salida', -v_cant)
      returning id into v_salida;
      perform seguridad.mover_saldo(p_empresa_id, v_fecha, v_frente, v_comedor_d, v_servicio_d, v_cant);
      insert into public.racion_movimientos (envio_id, empresa_id, fecha, frente_id, comedor_id, servicio_id, tipo_movimiento, cantidad, traslado_par)
      values (v_envio, p_empresa_id, v_fecha, v_frente, v_comedor_d, v_servicio_d, 'traslado_entrada', v_cant, v_salida);
      v_registros := v_registros
        || jsonb_build_object('orden', v_filas * 2 - 1, 'fecha', v_fecha, 'frente_id', v_frente,
                              'comedor_id', v_comedor, 'servicio_id', v_servicio, 'cantidad', -v_cant)
        || jsonb_build_object('orden', v_filas * 2, 'fecha', v_fecha, 'frente_id', v_frente,
                              'comedor_id', v_comedor_d, 'servicio_id', v_servicio_d, 'cantidad', v_cant);
      v_total := v_total + v_cant;
    end if;
  end loop;

  update public.envios
  set total_filas = v_filas, total_raciones = v_total, fuera_de_plazo = v_fuera
  where id = v_envio;

  insert into public.auditoria (usuario_id, empresa_id, modulo, accion, entidad, entidad_id, detalle)
  values (ctx.usuario_id, p_empresa_id, 'raciones', 'enviar_' || p_tipo, 'envios', v_envio::text,
          jsonb_build_object('filas', v_filas, 'total', v_total, 'fuera_de_plazo', v_fuera, 'motivo', v_motivo));

  -- Correo con la tabla de registros (al usuario + contactos de la empresa).
  v_plantilla := case p_tipo
                   when 'programacion' then 'programacion_raciones'
                   when 'adicion_reduccion' then 'adicion_reduccion_raciones'
                   else 'traslado_raciones'
                 end;
  select p.correo into v_correo from public.perfiles p where p.id = ctx.usuario_id;
  perform seguridad.encolar_correo(
    v_plantilla,
    jsonb_build_object(
      'usuario', (select nombre from public.perfiles where id = ctx.usuario_id),
      'registros', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'fecha', r.fecha, 'proyecto', pr.nombre, 'area', a.nombre, 'frente', fr.nombre,
                 'comedor', co.nombre, 'servicio', s.nombre, 'cantidad', r.cantidad)
               order by r.fecha, r.orden)
        from jsonb_to_recordset(v_registros)
               as r(orden int, fecha date, frente_id uuid, comedor_id uuid, servicio_id uuid, cantidad int)
        join public.frentes_trabajo fr on fr.id = r.frente_id
        join public.proyectos pr on pr.id = fr.proyecto_id
        join public.areas a on a.id = fr.area_id
        join public.comedores co on co.id = r.comedor_id
        join public.servicios s on s.id = r.servicio_id
      ), '[]'::jsonb)
    ),
    array[v_correo],
    p_empresa_id,
    v_envio,
    true
  );

  return v_envio;
end;
$$;

revoke execute on function public.enviar_raciones(text, uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.enviar_raciones(text, uuid, jsonb, uuid, text) to authenticated;

-- Plazo de una lista de fechas, para la interfaz (misma regla que al enviar).
create or replace function public.plazos_raciones(p_tipo text, p_fechas date[])
returns table (fecha date, motivo text)
language sql
stable
security definer
set search_path = ''
as $$
  select f, seguridad.validar_plazo(p_tipo, f)
  from unnest(p_fechas[1:200]) as f
  where seguridad.usuario_activo();
$$;
revoke execute on function public.plazos_raciones(text, date[]) from public, anon;
grant execute on function public.plazos_raciones(text, date[]) to authenticated;

-- Resumen agregado para el dashboard. SECURITY INVOKER: respeta RLS (cada uno ve lo suyo).
create or replace function public.resumen_raciones(p_desde date, p_hasta date, p_empresa uuid default null)
returns table (fecha date, comedor_id uuid, servicio_id uuid, cantidad bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.fecha, s.comedor_id, s.servicio_id, sum(s.cantidad)::bigint
  from public.racion_saldos s
  where s.fecha between p_desde and p_hasta
    and p_hasta - p_desde <= 92
    and (p_empresa is null or s.empresa_id = p_empresa)
    and s.cantidad > 0
  group by s.fecha, s.comedor_id, s.servicio_id;
$$;
revoke execute on function public.resumen_raciones(date, date, uuid) from public, anon;
grant execute on function public.resumen_raciones(date, date, uuid) to authenticated;

revoke execute on all functions in schema seguridad from public, anon;
grant execute on all functions in schema seguridad to authenticated, service_role;
-- Estas solo se usan dentro de enviar_raciones().
revoke execute on function seguridad.mover_saldo(uuid, date, uuid, uuid, uuid, int) from authenticated;
revoke execute on function seguridad.encolar_correo(text, jsonb, text[], uuid, uuid, boolean) from authenticated;
revoke execute on function seguridad.disparar_envio_correos() from authenticated;
