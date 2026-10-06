-- =============================================================================
-- Kuntur Wasi · Fase 2: solicitudes de registro, aprobación/rechazo y
-- validación de la configuración de horarios.
-- =============================================================================

create table public.solicitudes_registro (
  id                uuid primary key default gen_random_uuid(),
  ruc               text not null check (ruc ~ '^\d{11}$'),
  razon_social      text not null check (length(btrim(razon_social)) between 2 and 200),
  direccion         text check (length(direccion) <= 300),
  usuario_nombre    text not null check (length(btrim(usuario_nombre)) between 2 and 150),
  usuario_correo    text not null check (usuario_correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(usuario_correo) <= 254),
  usuario_telefono  text check (length(usuario_telefono) <= 30),
  -- [{proyecto_id, area_id, frente, sponsor, desde, hasta}]
  frentes           jsonb not null check (jsonb_typeof(frentes) = 'array' and jsonb_array_length(frentes) between 1 and 30),
  -- [{tipo, nombre, telefono, correo}]
  contactos         jsonb not null check (jsonb_typeof(contactos) = 'array' and jsonb_array_length(contactos) between 1 and 10),
  acepta_tyc        boolean not null check (acepta_tyc),
  estado            text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  motivo_rechazo    text check (length(motivo_rechazo) <= 500),
  revisado_por      uuid,
  revisado_en       timestamptz,
  empresa_id        uuid references public.empresas(id),
  usuario_id        uuid,
  ip                text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.solicitudes_registro (estado, created_at desc);
-- Una sola solicitud pendiente por correo.
create unique index solicitudes_pendiente_correo_uq
  on public.solicitudes_registro (lower(usuario_correo)) where estado = 'pendiente';

create trigger solicitudes_registro_updated_at before update on public.solicitudes_registro
  for each row execute function seguridad.trg_updated_at();
create trigger solicitudes_registro_auditoria after insert or update or delete on public.solicitudes_registro
  for each row execute function seguridad.trg_auditoria('registro');

alter table public.solicitudes_registro enable row level security;
revoke all on public.solicitudes_registro from anon;
-- Las altas llegan del formulario público por el servidor (service_role);
-- los cambios de estado, solo por las funciones de aprobación.
revoke insert, update, delete, truncate on public.solicitudes_registro from authenticated;
grant select on public.solicitudes_registro to authenticated;

create policy solicitudes_leer on public.solicitudes_registro for select to authenticated
  using ((select seguridad.tiene_permiso('maestras.solicitudes', 'ver')) and (select seguridad.mi_alcance()) = 'todas');

-- ---------------------------------------------------------------------------
-- Aprobar: crea o actualiza la empresa, sus contactos y frentes, y marca la
-- solicitud. El usuario de Auth lo crea después el servidor (necesita la clave
-- secreta) y lo vincula con vincular_usuario_solicitud().
-- ---------------------------------------------------------------------------
create or replace function public.aprobar_solicitud(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s          public.solicitudes_registro;
  v_empresa  uuid;
  v_frente   uuid;
  f          jsonb;
  c          jsonb;
  n          int := 0;
begin
  if not (seguridad.tiene_permiso('maestras.solicitudes', 'aprobar') and seguridad.mi_alcance() = 'todas') then
    raise exception 'No tienes permiso para aprobar solicitudes' using errcode = '42501';
  end if;

  select * into s from public.solicitudes_registro where id = p_id for update;
  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if s.estado <> 'pendiente' then
    raise exception 'La solicitud ya fue revisada' using errcode = '22023';
  end if;

  -- Empresa: si el RUC ya existe se reutiliza (no se sobrescriben sus datos).
  select id into v_empresa from public.empresas where ruc = s.ruc;
  if v_empresa is null then
    insert into public.empresas (ruc, razon_social, nombre_corto, direccion)
    values (s.ruc, btrim(s.razon_social), left(btrim(s.razon_social), 120), s.direccion)
    returning id into v_empresa;
  end if;

  -- Contactos
  for c in select * from jsonb_array_elements(s.contactos) loop
    n := n + 1;
    insert into public.empresa_contactos (empresa_id, tipo, nombre, telefono, correo, recibe_notificaciones, origen_id)
    values (v_empresa, c ->> 'tipo', btrim(c ->> 'nombre'), nullif(btrim(c ->> 'telefono'), ''), lower(btrim(c ->> 'correo')),
            (c ->> 'tipo') = 'gestion_raciones', 'solicitud:' || s.id || ':' || n)
    on conflict (origen_id) do nothing;
  end loop;

  -- Frentes: se reutiliza el frente si ya existe (mismo proyecto, área y nombre).
  for f in select * from jsonb_array_elements(s.frentes) loop
    select id into v_frente
    from public.frentes_trabajo
    where proyecto_id = (f ->> 'proyecto_id')::uuid
      and area_id = (f ->> 'area_id')::uuid
      and seguridad.normalizar_nombre(nombre) = seguridad.normalizar_nombre(f ->> 'frente');
    if v_frente is null then
      insert into public.frentes_trabajo (proyecto_id, area_id, nombre, sponsor, contrato_desde, contrato_hasta)
      values ((f ->> 'proyecto_id')::uuid, (f ->> 'area_id')::uuid, seguridad.normalizar_nombre(f ->> 'frente'),
              nullif(btrim(f ->> 'sponsor'), ''), (f ->> 'desde')::date, (f ->> 'hasta')::date)
      returning id into v_frente;
    end if;
    insert into public.empresa_frentes (empresa_id, frente_id, contrato_desde, contrato_hasta)
    values (v_empresa, v_frente, (f ->> 'desde')::date, (f ->> 'hasta')::date)
    on conflict (empresa_id, frente_id) do update
      set contrato_desde = excluded.contrato_desde, contrato_hasta = excluded.contrato_hasta, activo = true;
  end loop;

  update public.solicitudes_registro
  set estado = 'aprobada', revisado_por = auth.uid(), revisado_en = now(), empresa_id = v_empresa
  where id = p_id;

  return v_empresa;
end;
$$;

create or replace function public.vincular_usuario_solicitud(p_id uuid, p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (seguridad.tiene_permiso('maestras.solicitudes', 'aprobar') and seguridad.mi_alcance() = 'todas') then
    raise exception 'No tienes permiso' using errcode = '42501';
  end if;
  update public.solicitudes_registro
  set usuario_id = p_usuario_id
  where id = p_id and estado = 'aprobada' and usuario_id is null;
  if not found then
    raise exception 'Solicitud no válida para vincular' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.rechazar_solicitud(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (seguridad.tiene_permiso('maestras.solicitudes', 'aprobar') and seguridad.mi_alcance() = 'todas') then
    raise exception 'No tienes permiso para rechazar solicitudes' using errcode = '42501';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) not between 5 and 500 then
    raise exception 'Indica un motivo (5 a 500 caracteres)' using errcode = '22023';
  end if;
  update public.solicitudes_registro
  set estado = 'rechazada', motivo_rechazo = btrim(p_motivo), revisado_por = auth.uid(), revisado_en = now()
  where id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'La solicitud no existe o ya fue revisada' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.aprobar_solicitud(uuid) from anon, public;
revoke execute on function public.vincular_usuario_solicitud(uuid, uuid) from anon, public;
revoke execute on function public.rechazar_solicitud(uuid, text) from anon, public;
grant execute on function public.aprobar_solicitud(uuid) to authenticated;
grant execute on function public.vincular_usuario_solicitud(uuid, uuid) to authenticated;
grant execute on function public.rechazar_solicitud(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Configuración de horarios: el valor nuevo debe ser del mismo tipo que el
-- anterior (número, texto, objeto…) para que la app no se rompa.
-- ---------------------------------------------------------------------------
create or replace function seguridad.trg_config_horarios_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(new.valor) <> jsonb_typeof(old.valor) then
    raise exception 'El valor de % / % debe ser de tipo %', new.modulo, new.regla, jsonb_typeof(old.valor)
      using errcode = '22023';
  end if;
  if jsonb_typeof(new.valor) = 'string' and (new.valor #>> '{}') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'La hora debe tener formato HH:MM (24 h)' using errcode = '22023';
  end if;
  if jsonb_typeof(new.valor) = 'number' and ((new.valor)::text::numeric < 0 or (new.valor)::text::numeric > 1000) then
    raise exception 'Número fuera de rango' using errcode = '22023';
  end if;
  if jsonb_typeof(new.valor) = 'object' then
    -- Mismas claves que antes ({dia_semana, hora}); día ISO: 1 (lunes) a 7 (domingo).
    if (select array_agg(k order by k) from jsonb_object_keys(new.valor) k)
       is distinct from (select array_agg(k order by k) from jsonb_object_keys(old.valor) k) then
      raise exception 'El valor de % / % debe conservar sus campos', new.modulo, new.regla using errcode = '22023';
    end if;
    if new.valor ? 'dia_semana' and (jsonb_typeof(new.valor -> 'dia_semana') <> 'number'
        or (new.valor ->> 'dia_semana') !~ '^[1-7]$') then
      raise exception 'El día de la semana debe ser un número de 1 (lunes) a 7 (domingo)' using errcode = '22023';
    end if;
    if new.valor ? 'hora' and (jsonb_typeof(new.valor -> 'hora') <> 'string'
        or (new.valor ->> 'hora') !~ '^([01]\d|2[0-3]):[0-5]\d$') then
      raise exception 'La hora debe tener formato HH:MM (24 h)' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger config_horarios_validar before update on public.config_horarios
  for each row execute function seguridad.trg_config_horarios_validar();

revoke execute on all functions in schema seguridad from public, anon;
grant execute on all functions in schema seguridad to authenticated, service_role;
