-- =============================================================================
-- Kuntur Wasi · Migración 3: auditoría, configuración general y de horarios,
-- hora oficial del servidor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Auditoría (solo inserción)
-- ---------------------------------------------------------------------------
create table public.auditoria (
  id          bigint generated always as identity primary key,
  en          timestamptz not null default now(),
  usuario_id  uuid,
  empresa_id  uuid,
  modulo      text not null,
  accion      text not null,
  entidad     text,
  entidad_id  text,
  antes       jsonb,
  despues     jsonb,
  detalle     jsonb,
  ip          text
);
create index on public.auditoria (en desc);
create index on public.auditoria (usuario_id, en desc);
create index on public.auditoria (empresa_id, en desc);
create index on public.auditoria (modulo, accion, en desc);

-- IP del cliente según las cabeceras que PostgREST deja en la sesión.
create or replace function seguridad.ip_cliente()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(split_part(coalesce(
    (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for', ''
  ), ',', 1), '');
$$;

-- Trigger genérico: registra INSERT / UPDATE / DELETE con valores antes y después.
create or replace function seguridad.trg_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes    jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_despues  jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_fila     jsonb := coalesce(v_despues, v_antes);
  v_id       text;
begin
  -- No guardar actualizaciones que no cambian nada relevante.
  if tg_op = 'UPDATE'
     and (v_antes - 'updated_at' - 'ultimo_acceso') = (v_despues - 'updated_at' - 'ultimo_acceso') then
    return new;
  end if;

  v_id := coalesce(
    v_fila ->> 'id',
    v_fila ->> 'codigo',
    v_fila ->> 'clave',
    concat_ws('|', v_fila ->> 'rol_id', v_fila ->> 'menu_codigo',
                   v_fila ->> 'empresa_id', v_fila ->> 'frente_id',
                   v_fila ->> 'comedor_id', v_fila ->> 'servicio_id',
                   v_fila ->> 'modulo', v_fila ->> 'regla')
  );

  insert into public.auditoria (usuario_id, empresa_id, modulo, accion, entidad, entidad_id, antes, despues, ip)
  values (
    auth.uid(),
    case
      when tg_table_name = 'empresas' then (v_fila ->> 'id')::uuid
      else nullif(v_fila ->> 'empresa_id', '')::uuid
    end,
    coalesce(tg_argv[0], 'datos'),
    lower(tg_op),
    tg_table_name,
    v_id,
    v_antes,
    v_despues,
    seguridad.ip_cliente()
  );
  return coalesce(new, old);
end;
$$;

-- Evento de aplicación registrado por el propio usuario (login, cambio de contraseña…).
-- Solo acepta una lista cerrada de acciones y siempre usa el usuario de la sesión.
create or replace function public.registrar_evento(p_accion text, p_detalle jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx record;
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;
  if p_accion not in ('login', 'logout', 'mfa_activado', 'mfa_verificado') then
    raise exception 'Acción no permitida' using errcode = '22023';
  end if;
  if p_detalle is not null and length(p_detalle::text) > 300 then
    raise exception 'Detalle demasiado largo' using errcode = '22023';
  end if;

  select p.empresa_id into v_ctx from public.perfiles p where p.id = auth.uid();

  insert into public.auditoria (usuario_id, empresa_id, modulo, accion, detalle, ip)
  values (auth.uid(), v_ctx.empresa_id, 'sesion', p_accion, p_detalle, seguridad.ip_cliente());

  if p_accion = 'login' then
    update public.perfiles set ultimo_acceso = now() where id = auth.uid();
  end if;
end;
$$;

-- Cuando Supabase Auth guarda una contraseña nueva: se levanta la obligación de
-- cambiarla y queda en la auditoría. Lo hace la base de datos, no el navegador,
-- para que nadie pueda "saltarse" el cambio obligatorio.
create or replace function seguridad.trg_password_cambiada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.perfiles set debe_cambiar_password = false
  where id = new.id and debe_cambiar_password;
  insert into public.auditoria (usuario_id, empresa_id, modulo, accion, entidad, entidad_id)
  select new.id, p.empresa_id, 'sesion', 'cambio_password', 'perfiles', new.id::text
  from public.perfiles p where p.id = new.id;
  return new;
end;
$$;

create trigger en_cambio_password
after update of encrypted_password on auth.users
for each row when (old.encrypted_password is distinct from new.encrypted_password)
execute function seguridad.trg_password_cambiada();

revoke execute on function public.registrar_evento(text, jsonb) from anon, public;
grant execute on function public.registrar_evento(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------------
create table public.configuracion (
  clave        text primary key check (clave ~ '^[a-z][a-z0-9_.]{1,60}$'),
  valor        jsonb not null,
  descripcion  text,
  publica      boolean not null default false, -- true: cualquier usuario activo la puede leer
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid()
);

create table public.config_horarios (
  modulo       text not null check (modulo in ('programacion', 'adicion', 'reduccion', 'traslado', 'refrigerio')),
  regla        text not null check (regla ~ '^[a-z][a-z0-9_]{1,60}$'),
  valor        jsonb not null,
  descripcion  text not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid(),
  primary key (modulo, regla)
);

create trigger configuracion_updated_at before update on public.configuracion for each row execute function seguridad.trg_updated_at();
create trigger config_horarios_updated_at before update on public.config_horarios for each row execute function seguridad.trg_updated_at();

-- Zona horaria oficial (configurable). Valida que exista en Postgres.
create or replace function seguridad.zona_horaria()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.valor #>> '{}' from public.configuracion c where c.clave = 'zona_horaria'), 'America/Lima');
$$;

create or replace function seguridad.trg_config_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.clave = 'zona_horaria' and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.valor #>> '{}'
  ) then
    raise exception 'Zona horaria no válida: %', new.valor #>> '{}' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger configuracion_validar before insert or update on public.configuracion
for each row execute function seguridad.trg_config_validar();

-- Hora oficial: la de la base de datos, en la zona configurada.
-- La interfaz la usa para mostrar plazos; nunca se confía en el reloj del navegador.
create or replace function public.hora_servidor()
returns table (ahora timestamptz, ahora_local timestamp, zona text)
language sql
stable
security definer
set search_path = ''
as $$
  select now(), now() at time zone seguridad.zona_horaria(), seguridad.zona_horaria();
$$;

revoke execute on function public.hora_servidor() from anon, public;
grant execute on function public.hora_servidor() to authenticated;

-- ---------------------------------------------------------------------------
-- Activar auditoría en tablas maestras, seguridad y configuración
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('empresas', 'maestras'), ('empresa_contactos', 'maestras'), ('proyectos', 'maestras'),
      ('areas', 'maestras'), ('frentes_trabajo', 'maestras'), ('empresa_frentes', 'maestras'),
      ('sectores', 'maestras'), ('comedores', 'maestras'), ('tipos_servicio', 'maestras'),
      ('servicios', 'maestras'), ('servicio_tarifas', 'maestras'), ('comedor_servicios', 'maestras'),
      ('traslado_reglas_sector', 'maestras'), ('traslado_reglas_servicio', 'maestras'),
      ('roles', 'seguridad'), ('menus', 'seguridad'), ('rol_permisos', 'seguridad'), ('perfiles', 'seguridad'),
      ('configuracion', 'configuracion'), ('config_horarios', 'configuracion')
    ) as v(tabla, modulo)
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function seguridad.trg_auditoria(%L)',
      t.tabla || '_auditoria', t.tabla, t.modulo
    );
  end loop;
end $$;
