-- =============================================================================
-- Kuntur Wasi · Fase 6 (2/7): documentos con versiones y alertas post-login.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Documentos con versiones
-- ---------------------------------------------------------------------------
create table public.documentos (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('menu_1', 'menu_2', 'terminos', 'manual')),
  version         int not null check (version >= 1),
  titulo          text not null check (length(btrim(titulo)) between 1 and 120),
  nombre_archivo  text not null check (length(nombre_archivo) between 1 and 200),
  ruta            text not null unique,
  tamano          bigint not null check (tamano > 0),
  vigente         boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  unique (tipo, version)
);
create unique index documentos_vigente_uq on public.documentos (tipo) where vigente;

create or replace function seguridad.puede_ver_documento(p_tipo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select seguridad.usuario_activo() and case
    when p_tipo in ('menu_1', 'menu_2') then seguridad.tiene_permiso('menu_semanal', 'ver')
    when p_tipo in ('terminos', 'manual') then seguridad.tiene_permiso('manual_tyc', 'ver')
    else false end;
$$;

create or replace function seguridad.puede_editar_documento(p_tipo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select seguridad.usuario_activo() and case
    when p_tipo in ('menu_1', 'menu_2') then seguridad.tiene_permiso('menu_semanal', 'editar')
    when p_tipo in ('terminos', 'manual') then seguridad.tiene_permiso('manual_tyc', 'editar')
    else false end;
$$;

alter table public.documentos enable row level security;
revoke all on public.documentos from anon;
revoke insert, update, delete, truncate, references, trigger on public.documentos from authenticated;
grant select on public.documentos to authenticated;
create policy documentos_leer on public.documentos for select to authenticated
  using (vigente and seguridad.puede_ver_documento(tipo) or seguridad.puede_editar_documento(tipo));

-- Storage: la primera carpeta de la ruta es el tipo (menu_1/…). Sin modificar ni borrar: cada versión es un archivo nuevo.
create or replace function seguridad.puede_leer_archivo_documento(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select seguridad.puede_editar_documento((storage.foldername(p_nombre))[1])
      or exists (select 1 from public.documentos d
                 where d.ruta = p_nombre and d.vigente and seguridad.puede_ver_documento(d.tipo));
$$;

-- Registra como vigente un PDF ya subido al bucket por el mismo usuario.
create or replace function public.registrar_documento(p_tipo text, p_ruta text, p_nombre text, p_titulo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx       record;
  v_tamano  bigint;
  v_mime    text;
  v_limite  bigint;
  v_version int;
  v_id      uuid;
  v_nombre  text := btrim(coalesce(p_nombre, ''));
  v_titulo  text := btrim(coalesce(p_titulo, ''));
begin
  select * into ctx from seguridad.contexto() c where c.activo;
  if not found or not seguridad.puede_editar_documento(p_tipo) then
    raise exception 'No tienes permiso para publicar este documento' using errcode = '42501';
  end if;
  if exists (select 1 from public.perfiles where id = ctx.usuario_id and debe_cambiar_password) then
    raise exception 'Debes cambiar tu contraseña antes de continuar' using errcode = '42501';
  end if;
  if p_ruta is null or p_ruta !~ ('^' || p_tipo || '/[0-9a-f-]{36}\.pdf$') then
    raise exception 'Ruta de archivo no válida' using errcode = '22023';
  end if;
  if length(v_nombre) not between 1 and 200 or length(v_titulo) not between 1 and 120 then
    raise exception 'Indica el título y el nombre del archivo' using errcode = '22023';
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_tamano, v_mime
  from storage.objects o
  where o.bucket_id = 'documentos' and o.name = p_ruta and o.owner_id = ctx.usuario_id::text;
  if v_tamano is null then
    raise exception 'El archivo no se encontró. Vuelve a subirlo.' using errcode = '22023';
  end if;
  v_limite := case when p_tipo like 'menu_%'
                   then seguridad.config_entero('archivos.pdf_menu_max_bytes', 1048576)
                   else seguridad.config_entero('archivos.documento_max_bytes', 10485760) end;
  if v_tamano > v_limite or v_mime is distinct from 'application/pdf' then
    raise exception 'El archivo debe ser un PDF de hasta % KB', v_limite / 1024 using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('documentos:' || p_tipo));
  select coalesce(max(version), 0) + 1 into v_version from public.documentos where tipo = p_tipo;
  update public.documentos set vigente = false where tipo = p_tipo and vigente;
  insert into public.documentos (tipo, version, titulo, nombre_archivo, ruta, tamano, created_by)
  values (p_tipo, v_version, v_titulo, v_nombre, p_ruta, v_tamano, ctx.usuario_id)
  returning id into v_id;

  insert into public.auditoria (usuario_id, modulo, accion, entidad, entidad_id, detalle)
  values (ctx.usuario_id, 'documentos', 'publicar_documento', 'documentos', v_id::text,
          jsonb_build_object('tipo', p_tipo, 'version', v_version, 'archivo', v_nombre, 'tamano', v_tamano));
  return v_id;
end;
$$;

-- Vuelve a publicar una versión anterior.
create or replace function public.restaurar_documento(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.documentos;
begin
  select * into d from public.documentos where id = p_id;
  if not found or not seguridad.puede_editar_documento(d.tipo)
     or exists (select 1 from public.perfiles where id = auth.uid() and debe_cambiar_password) then
    raise exception 'No tienes permiso para publicar este documento' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('documentos:' || d.tipo));
  update public.documentos set vigente = false where tipo = d.tipo and vigente and id <> d.id;
  update public.documentos set vigente = true where id = d.id;
  insert into public.auditoria (usuario_id, modulo, accion, entidad, entidad_id, detalle)
  values (auth.uid(), 'documentos', 'restaurar_documento', 'documentos', d.id::text,
          jsonb_build_object('tipo', d.tipo, 'version', d.version));
end;
$$;

-- ---------------------------------------------------------------------------
-- Alertas post-login
-- ---------------------------------------------------------------------------
create table public.alertas (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null check (length(btrim(titulo)) between 1 and 120),
  contenido   text not null check (length(btrim(contenido)) between 1 and 4000),
  desde       timestamptz not null,
  hasta       timestamptz not null,
  roles       text[] not null check (cardinality(roles) between 1 and 20),
  una_vez     boolean not null default true,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  constraint alertas_rango_ck check (hasta > desde)
);
create index on public.alertas (activo, desde, hasta);

create table public.alertas_vistas (
  alerta_id   uuid not null references public.alertas(id) on delete cascade,
  usuario_id  uuid not null,
  sesion      text not null default '',
  visto_en    timestamptz not null default now(),
  primary key (alerta_id, usuario_id, sesion)
);

create or replace function seguridad.trg_alertas_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(new.roles) r where not exists (select 1 from public.roles x where x.codigo = r)) then
    raise exception 'Hay un rol que no existe' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger alertas_roles before insert or update on public.alertas
  for each row execute function seguridad.trg_alertas_roles();
create trigger alertas_updated_at before update on public.alertas
  for each row execute function seguridad.trg_updated_at();
create trigger alertas_auditoria after insert or update or delete on public.alertas
  for each row execute function seguridad.trg_auditoria('alertas');

alter table public.alertas enable row level security;
alter table public.alertas_vistas enable row level security;
revoke all on public.alertas, public.alertas_vistas from anon;
revoke delete, truncate, references, trigger on public.alertas from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.alertas_vistas from authenticated;
grant select, insert, update on public.alertas to authenticated;
grant select on public.alertas_vistas to authenticated;
create policy alertas_leer on public.alertas for select to authenticated
  using ((select seguridad.tiene_permiso('admin.alertas', 'ver')));
create policy alertas_crear on public.alertas for insert to authenticated
  with check ((select seguridad.tiene_permiso('admin.alertas', 'editar')));
create policy alertas_editar on public.alertas for update to authenticated
  using ((select seguridad.tiene_permiso('admin.alertas', 'editar')))
  with check ((select seguridad.tiene_permiso('admin.alertas', 'editar')));
create policy alertas_vistas_leer on public.alertas_vistas for select to authenticated
  using ((select seguridad.tiene_permiso('admin.alertas', 'ver')));

-- Alertas que el usuario debe ver ahora. "Cada login" se controla con el id de la sesión de Supabase Auth.
create or replace function public.mis_alertas()
returns table (id uuid, titulo text, contenido text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.titulo, a.contenido
  from public.alertas a
  cross join seguridad.contexto() c
  where c.activo
    and a.activo
    and now() >= a.desde and now() < a.hasta
    and c.rol_codigo = any (a.roles)
    and not exists (
      select 1 from public.alertas_vistas v
      where v.alerta_id = a.id and v.usuario_id = c.usuario_id
        and (a.una_vez or v.sesion = coalesce(auth.jwt() ->> 'session_id', ''))
    )
  order by a.desde, a.created_at
  limit 5;
$$;

create or replace function public.marcar_alertas_vistas(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_ids is null or cardinality(p_ids) > 20 then
    return;
  end if;
  insert into public.alertas_vistas (alerta_id, usuario_id, sesion)
  select m.id, auth.uid(), coalesce(auth.jwt() ->> 'session_id', '')
  from public.mis_alertas() m
  where m.id = any (p_ids)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.registrar_documento(text, text, text, text) from public, anon;
revoke execute on function public.restaurar_documento(uuid) from public, anon;
revoke execute on function public.mis_alertas() from public, anon;
revoke execute on function public.marcar_alertas_vistas(uuid[]) from public, anon;
grant execute on function public.registrar_documento(text, text, text, text) to authenticated;
grant execute on function public.restaurar_documento(uuid) to authenticated;
grant execute on function public.mis_alertas() to authenticated;
grant execute on function public.marcar_alertas_vistas(uuid[]) to authenticated;
revoke execute on all functions in schema seguridad from public, anon;
grant execute on all functions in schema seguridad to authenticated, service_role;
revoke execute on function seguridad.mover_saldo(uuid, date, uuid, uuid, uuid, int) from authenticated;
revoke execute on function seguridad.encolar_correo(text, jsonb, text[], uuid, uuid, boolean) from authenticated;
revoke execute on function seguridad.disparar_envio_correos() from authenticated;
