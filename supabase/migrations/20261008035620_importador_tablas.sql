-- =============================================================================
-- Kuntur Wasi · Fase 7 · importador (1/3): tablas, bucket privado y registro de la importación.
-- =============================================================================

-- Origen de los datos migrados (para no duplicar al reimportar).
alter table public.envios
  add column origen_id text unique,
  add column usuario_origen text check (length(usuario_origen) <= 120);
alter table public.racion_movimientos add column origen_id text;
create unique index racion_movimientos_origen_uq on public.racion_movimientos (origen_id) where origen_id is not null;

-- ---------------------------------------------------------------------------
-- Registro de cada importación
-- ---------------------------------------------------------------------------
create table public.importaciones (
  id                 uuid primary key default gen_random_uuid(),
  creado_por         uuid not null default auth.uid(),
  created_at         timestamptz not null default now(),
  archivos           jsonb not null check (jsonb_typeof(archivos) = 'array'),
  estado             text not null default 'subido'
                     check (estado in ('subido', 'analizado', 'importando', 'importado', 'fallido')),
  resumen            jsonb,
  errores            int not null default 0,
  advertencias       int not null default 0,
  lotes_total        int not null default 0,
  lotes_hechos       int not null default 0,
  meses              date[] not null default '{}',
  meses_hechos       int not null default 0,
  meses_listos       date[] not null default '{}',
  catalogos_hechos   boolean not null default false,
  resultado          jsonb,
  terminado_en       timestamptz
);
create index on public.importaciones (created_at desc);

create table public.importacion_problemas (
  importacion_id  uuid not null references public.importaciones(id) on delete cascade,
  n               int not null,
  nivel           text not null check (nivel in ('error', 'advertencia')),
  archivo         text not null,
  fila            int,
  columna         text,
  motivo          text not null,
  primary key (importacion_id, n)
);

create table public.importacion_lotes (
  importacion_id  uuid not null references public.importaciones(id) on delete cascade,
  lote            int not null,
  insertados      int not null,
  existentes      int not null,
  hecho_en        timestamptz not null default now(),
  primary key (importacion_id, lote)
);

-- Solo el Superadmin (o quien tenga el permiso, con alcance "todas") importa.
create or replace function seguridad.puede_importar()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select seguridad.tiene_permiso('admin.importador', 'enviar') and seguridad.mi_alcance() = 'todas';
$$;

alter table public.importaciones enable row level security;
alter table public.importacion_problemas enable row level security;
alter table public.importacion_lotes enable row level security;
revoke all on public.importaciones, public.importacion_problemas, public.importacion_lotes from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.importaciones, public.importacion_problemas, public.importacion_lotes from authenticated;
grant select on public.importaciones, public.importacion_problemas, public.importacion_lotes to authenticated;
create policy importaciones_leer on public.importaciones for select to authenticated
  using ((select seguridad.tiene_permiso('admin.importador', 'ver')) and (select seguridad.mi_alcance()) = 'todas');
create policy importacion_problemas_leer on public.importacion_problemas for select to authenticated
  using ((select seguridad.tiene_permiso('admin.importador', 'ver')) and (select seguridad.mi_alcance()) = 'todas');
create policy importacion_lotes_leer on public.importacion_lotes for select to authenticated
  using ((select seguridad.tiene_permiso('admin.importador', 'ver')) and (select seguridad.mi_alcance()) = 'todas');

-- Bucket privado: <id de la importación>/archivo original y lotes preparados.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('importaciones', 'importaciones', false, 52428800,
   array['text/csv', 'application/vnd.ms-excel', 'application/json',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
on conflict (id) do nothing;
create policy importaciones_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'importaciones' and seguridad.puede_importar());
create policy importaciones_leer on storage.objects for select to authenticated
  using (bucket_id = 'importaciones' and seguridad.puede_importar());
create policy importaciones_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'importaciones' and seguridad.puede_importar());


-- ---------------------------------------------------------------------------
-- Crear la importación y guardar la simulación
-- ---------------------------------------------------------------------------
create or replace function public.importacion_crear(p_archivos jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not seguridad.puede_importar() then
    raise exception 'No tienes permiso para importar' using errcode = '42501';
  end if;
  if jsonb_typeof(p_archivos) is distinct from 'array' or jsonb_array_length(p_archivos) not between 1 and 10 then
    raise exception 'Sube entre 1 y 10 archivos' using errcode = '22023';
  end if;
  insert into public.importaciones (archivos) values (p_archivos) returning id into v_id;
  insert into public.auditoria (usuario_id, modulo, accion, entidad, entidad_id, detalle)
  values (auth.uid(), 'importador', 'subir_archivos', 'importaciones', v_id::text, jsonb_build_object('archivos', p_archivos));
  return v_id;
end;
$$;
revoke execute on function public.importacion_crear(jsonb) from public, anon;
grant execute on function public.importacion_crear(jsonb) to authenticated;
revoke execute on function seguridad.puede_importar() from public, anon;
grant execute on function seguridad.puede_importar() to authenticated, service_role;
