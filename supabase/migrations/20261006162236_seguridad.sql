-- =============================================================================
-- Kuntur Wasi · Migración 2: roles, menús, permisos, perfiles de usuario y
-- funciones de seguridad usadas por las políticas RLS.
-- =============================================================================

create table public.roles (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique check (codigo ~ '^[a-z][a-z0-9_]{1,40}$'),
  nombre        text not null check (length(btrim(nombre)) between 2 and 60),
  descripcion   text check (length(descripcion) <= 300),
  -- empresa: solo su empresa · todas: todas las empresas · comedor: todas las empresas, filtrado por su comedor
  alcance       text not null check (alcance in ('empresa', 'todas', 'comedor')),
  requiere_mfa  boolean not null default false,
  es_sistema    boolean not null default false,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  constraint roles_superadmin_ck check (codigo <> 'superadmin' or (alcance = 'todas' and es_sistema and activo and requiere_mfa))
);

create table public.menus (
  codigo        text primary key check (codigo ~ '^[a-z][a-z0-9_.]{1,60}$'),
  padre_codigo  text references public.menus(codigo) on update cascade,
  nombre        text not null,
  descripcion   text,
  icono         text,
  ruta          text check (ruta is null or ruta ~ '^/[a-z0-9/_-]*$'),
  orden         int not null default 0,
  -- Acciones que tienen sentido en este menú (para la pantalla de permisos).
  acciones_disponibles text[] not null default array['ver'],
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.rol_permisos (
  rol_id       uuid not null references public.roles(id) on delete cascade,
  menu_codigo  text not null references public.menus(codigo) on delete cascade on update cascade,
  acciones     text[] not null default array['ver'],
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  primary key (rol_id, menu_codigo),
  constraint rol_permisos_acciones_ck check (
    acciones <@ array['ver', 'crear', 'editar', 'enviar', 'exportar', 'aprobar']::text[]
    and cardinality(acciones) > 0
  )
);

create table public.perfiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  nombre                 text not null check (length(btrim(nombre)) between 1 and 150),
  correo                 text not null,
  rol_id                 uuid references public.roles(id),
  empresa_id             uuid references public.empresas(id),
  comedor_id             uuid references public.comedores(id),
  estado                 text not null default 'pendiente' check (estado in ('pendiente', 'activo', 'inactivo')),
  debe_cambiar_password  boolean not null default false,
  ultimo_acceso          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid default auth.uid(),
  constraint perfiles_rol_ck check (estado = 'pendiente' or rol_id is not null)
);
create index on public.perfiles (empresa_id);
create index on public.perfiles (rol_id);

create trigger roles_updated_at before update on public.roles for each row execute function seguridad.trg_updated_at();
create trigger menus_updated_at before update on public.menus for each row execute function seguridad.trg_updated_at();
create trigger rol_permisos_updated_at before update on public.rol_permisos for each row execute function seguridad.trg_updated_at();
create trigger perfiles_updated_at before update on public.perfiles for each row execute function seguridad.trg_updated_at();

-- ---------------------------------------------------------------------------
-- Funciones de seguridad (SECURITY DEFINER: leen perfiles sin pasar por RLS).
-- Todas fijan search_path vacío y usan nombres completos.
-- ---------------------------------------------------------------------------

-- Contexto del usuario actual en una sola consulta.
create or replace function seguridad.contexto()
returns table (
  usuario_id   uuid,
  rol_id       uuid,
  rol_codigo   text,
  alcance      text,
  empresa_id   uuid,
  comedor_id   uuid,
  activo       boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    r.id,
    r.codigo,
    r.alcance,
    p.empresa_id,
    p.comedor_id,
    (
      p.estado = 'activo'
      and r.activo
      -- Si el rol exige MFA, la sesión debe estar verificada con segundo factor (aal2).
      and (not r.requiere_mfa or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
    ) as activo
  from public.perfiles p
  join public.roles r on r.id = p.rol_id
  where p.id = auth.uid();
$$;

create or replace function seguridad.usuario_activo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.activo from seguridad.contexto() c), false);
$$;

create or replace function seguridad.es_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.activo and c.rol_codigo = 'superadmin' from seguridad.contexto() c), false);
$$;

create or replace function seguridad.mi_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.empresa_id from seguridad.contexto() c where c.activo;
$$;

create or replace function seguridad.mi_alcance()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.alcance from seguridad.contexto() c where c.activo;
$$;

-- ¿El usuario actual tiene la acción p_accion sobre el menú p_menu?
-- El Superadmin tiene todo.
create or replace function seguridad.tiene_permiso(p_menu text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.activo and (
      c.rol_codigo = 'superadmin'
      or exists (
        select 1
        from public.rol_permisos rp
        join public.menus m on m.codigo = rp.menu_codigo and m.activo
        where rp.rol_id = c.rol_id
          and rp.menu_codigo = p_menu
          and p_accion = any (rp.acciones)
      )
    )
    from seguridad.contexto() c
  ), false);
$$;

-- ¿Puede el usuario ver datos de esta empresa?
create or replace function seguridad.puede_ver_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.activo and (c.alcance in ('todas', 'comedor') or c.empresa_id = p_empresa_id)
    from seguridad.contexto() c
  ), false);
$$;

grant usage on schema seguridad to authenticated, service_role;
grant execute on all functions in schema seguridad to authenticated, service_role;
revoke execute on all functions in schema seguridad from anon, public;

-- ---------------------------------------------------------------------------
-- Reglas de integridad de perfiles (protegen contra escalamiento de privilegios)
-- ---------------------------------------------------------------------------
create or replace function seguridad.trg_perfiles_validar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alcance  text;
  v_codigo   text;
  v_old_cod  text;
  v_actor    uuid := auth.uid();
begin
  if new.rol_id is not null then
    select r.alcance, r.codigo into v_alcance, v_codigo from public.roles r where r.id = new.rol_id;
    if v_alcance = 'empresa' and new.empresa_id is null then
      raise exception 'Un usuario con rol de alcance "empresa" debe tener empresa asignada' using errcode = '23514';
    end if;
    if v_alcance = 'comedor' and new.comedor_id is null then
      raise exception 'Un usuario con rol de alcance "comedor" debe tener comedor asignado' using errcode = '23514';
    end if;
  end if;

  -- Solo interesan los cambios de rol, empresa, comedor o estado.
  if tg_op = 'UPDATE'
     and new.rol_id is not distinct from old.rol_id
     and new.empresa_id is not distinct from old.empresa_id
     and new.comedor_id is not distinct from old.comedor_id
     and new.estado is not distinct from old.estado then
    return new;
  end if;

  -- Cambios hechos por un usuario de la app (no por el sistema / service_role).
  if v_actor is not null and not seguridad.es_superadmin() then
    if tg_op = 'UPDATE' then
      select r.codigo into v_old_cod from public.roles r where r.id = old.rol_id;
      if new.id = v_actor then
        raise exception 'No puedes cambiar tu propio rol, empresa o estado' using errcode = '42501';
      end if;
      if v_old_cod = 'superadmin' then
        raise exception 'Solo un Superadmin puede modificar a otro Superadmin' using errcode = '42501';
      end if;
    end if;
    if v_codigo = 'superadmin' then
      raise exception 'Solo un Superadmin puede asignar el rol Superadmin' using errcode = '42501';
    end if;
    -- Un usuario de alcance "empresa" solo gestiona usuarios de su empresa y con roles de alcance "empresa".
    if seguridad.mi_alcance() is distinct from 'todas' then
      if v_alcance is distinct from 'empresa' or new.empresa_id is distinct from seguridad.mi_empresa_id() then
        raise exception 'No puedes asignar ese rol o esa empresa' using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger perfiles_validar
before insert or update on public.perfiles
for each row execute function seguridad.trg_perfiles_validar();

-- No permitir quedarse sin ningún Superadmin activo.
create or replace function seguridad.trg_perfiles_ultimo_superadmin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sa uuid;
begin
  select id into v_sa from public.roles where codigo = 'superadmin';
  if (tg_op = 'DELETE' and old.rol_id = v_sa and old.estado = 'activo')
     or (tg_op = 'UPDATE' and old.rol_id = v_sa and old.estado = 'activo'
         and (new.rol_id is distinct from v_sa or new.estado <> 'activo')) then
    if not exists (
      select 1 from public.perfiles p
      where p.rol_id = v_sa and p.estado = 'activo' and p.id <> old.id
    ) then
      raise exception 'Debe quedar al menos un Superadmin activo' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger perfiles_ultimo_superadmin
before update or delete on public.perfiles
for each row execute function seguridad.trg_perfiles_ultimo_superadmin();

-- ---------------------------------------------------------------------------
-- Alta automática de perfil cuando se crea un usuario en Supabase Auth.
-- El rol y la empresa SOLO se leen de app_metadata (que únicamente puede
-- escribir el servidor con la clave service_role), nunca de user_metadata.
-- ---------------------------------------------------------------------------
create or replace function seguridad.trg_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta     jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_rol_id   uuid;
begin
  select r.id into v_rol_id from public.roles r where r.codigo = v_meta ->> 'rol_codigo' and r.activo;

  insert into public.perfiles (id, nombre, correo, rol_id, empresa_id, comedor_id, estado, debe_cambiar_password)
  values (
    new.id,
    coalesce(nullif(btrim(v_meta ->> 'nombre'), ''), split_part(new.email, '@', 1)),
    lower(new.email),
    v_rol_id,
    nullif(v_meta ->> 'empresa_id', '')::uuid,
    nullif(v_meta ->> 'comedor_id', '')::uuid,
    case when v_rol_id is null then 'pendiente' else 'activo' end,
    coalesce((v_meta ->> 'debe_cambiar_password')::boolean, false)
  );
  return new;
end;
$$;

create trigger en_nuevo_usuario
after insert on auth.users
for each row execute function seguridad.trg_nuevo_usuario();

-- Mantener el correo del perfil sincronizado con Auth.
create or replace function seguridad.trg_usuario_correo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.perfiles set correo = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger en_cambio_correo
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function seguridad.trg_usuario_correo();
