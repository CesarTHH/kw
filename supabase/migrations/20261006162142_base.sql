-- =============================================================================
-- Kuntur Wasi · Migración 1: extensiones, utilidades y tablas de organización
-- y catálogos (empresas, proyectos, áreas, frentes, comedores, servicios).
-- =============================================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- Esquema privado para funciones de seguridad. NO se expone en la API REST.
create schema if not exists seguridad;
revoke all on schema seguridad from public;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

-- Mantiene updated_at al día.
create or replace function seguridad.trg_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Normaliza nombres de catálogo: sin espacios extremos, espacios simples, MAYÚSCULAS.
create or replace function seguridad.normalizar_nombre(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(btrim(p), '\s+', ' ', 'g'));
$$;

-- Valida el dígito verificador de un RUC peruano (11 dígitos).
create or replace function seguridad.ruc_valido(p_ruc text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  pesos int[] := array[5,4,3,2,7,6,5,4,3,2];
  suma int := 0;
  resto int;
  dv int;
begin
  if p_ruc !~ '^\d{11}$' then
    return false;
  end if;
  for i in 1..10 loop
    suma := suma + substr(p_ruc, i, 1)::int * pesos[i];
  end loop;
  resto := 11 - (suma % 11);
  dv := case when resto = 10 then 0 when resto = 11 then 1 else resto end;
  return dv = substr(p_ruc, 11, 1)::int;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organización
-- ---------------------------------------------------------------------------

create table public.empresas (
  id            uuid primary key default gen_random_uuid(),
  ruc           text not null unique check (ruc ~ '^\d{11}$'),
  razon_social  text not null check (length(btrim(razon_social)) between 2 and 200),
  nombre_corto  text not null check (length(btrim(nombre_corto)) between 1 and 120),
  direccion     text check (length(direccion) <= 300),
  tipo          text not null default 'empresa' check (tipo in ('empresa', 'persona')),
  telefonos     text check (length(telefonos) <= 200),
  activo        boolean not null default true,
  origen_id     text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);
comment on table public.empresas is 'Empresas contratistas (clientes). Origen: MAESTRO DE CLIENTES.';

create table public.empresa_contactos (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null references public.empresas(id) on delete cascade,
  tipo                   text not null check (tipo in ('gestion_raciones', 'facturacion', 'cobranzas')),
  nombre                 text not null check (length(btrim(nombre)) between 2 and 150),
  telefono               text check (length(telefono) <= 60),
  correo                 text not null check (correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(correo) <= 254),
  recibe_notificaciones  boolean not null default false,
  activo                 boolean not null default true,
  origen_id              text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid default auth.uid()
);
create index on public.empresa_contactos (empresa_id);

create table public.proyectos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create unique index proyectos_nombre_uq on public.proyectos (seguridad.normalizar_nombre(nombre));

create table public.areas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create unique index areas_nombre_uq on public.areas (seguridad.normalizar_nombre(nombre));

create table public.frentes_trabajo (
  id                    uuid primary key default gen_random_uuid(),
  proyecto_id           uuid not null references public.proyectos(id),
  area_id               uuid not null references public.areas(id),
  nombre                text not null,
  sponsor               text check (length(sponsor) <= 150),
  contrato_desde        date,
  contrato_hasta        date,
  activo                boolean not null default true,
  creado_por_migracion  boolean not null default false,
  origen_id             text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid default auth.uid(),
  constraint frentes_contrato_ck check (contrato_hasta is null or contrato_desde is null or contrato_hasta >= contrato_desde)
);
create unique index frentes_uq on public.frentes_trabajo (proyecto_id, area_id, seguridad.normalizar_nombre(nombre));

create table public.empresa_frentes (
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  frente_id       uuid not null references public.frentes_trabajo(id) on delete cascade,
  contrato_desde  date,
  contrato_hasta  date,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  primary key (empresa_id, frente_id),
  constraint empresa_frentes_contrato_ck check (contrato_hasta is null or contrato_desde is null or contrato_hasta >= contrato_desde)
);
create index on public.empresa_frentes (frente_id);

-- ---------------------------------------------------------------------------
-- Comedores y servicios
-- ---------------------------------------------------------------------------

create table public.sectores (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique check (codigo ~ '^[A-Z_]+$'),
  nombre      text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.comedores (
  id                      uuid primary key default gen_random_uuid(),
  nombre                  text not null,
  sector_id               uuid references public.sectores(id),
  habilitado_raciones     boolean not null default false,
  habilitado_refrigerios  boolean not null default false,
  habilitado_puntos_k     boolean not null default false,
  habilitado_kitchenette  boolean not null default false,
  activo                  boolean not null default true,
  origen_id               text unique,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid default auth.uid()
);
create unique index comedores_nombre_uq on public.comedores (seguridad.normalizar_nombre(nombre));

create table public.tipos_servicio (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique check (codigo ~ '^[A-Z_]+$'),
  nombre      text not null,
  orden       int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.servicios (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  tipo_servicio_id  uuid not null references public.tipos_servicio(id),
  es_a_campo        boolean not null default false,
  orden             int not null default 0,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid()
);
create unique index servicios_nombre_uq on public.servicios (seguridad.normalizar_nombre(nombre));

create table public.servicio_tarifas (
  id             uuid primary key default gen_random_uuid(),
  servicio_id    uuid not null references public.servicios(id) on delete cascade,
  precio         numeric(10, 2) not null check (precio >= 0),
  vigente_desde  date not null,
  vigente_hasta  date not null default '2099-12-31',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  constraint tarifas_rango_ck check (vigente_hasta >= vigente_desde),
  -- Nunca dos tarifas vigentes a la vez para el mismo servicio.
  constraint tarifas_sin_solape exclude using gist (
    servicio_id with =,
    daterange(vigente_desde, vigente_hasta, '[]') with &&
  )
);

create table public.comedor_servicios (
  comedor_id   uuid not null references public.comedores(id) on delete cascade,
  servicio_id  uuid not null references public.servicios(id) on delete cascade,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  primary key (comedor_id, servicio_id)
);
create index on public.comedor_servicios (servicio_id);

-- Matriz de sectores entre los que se permite trasladar (origen → destino).
create table public.traslado_reglas_sector (
  sector_origen_id   uuid not null references public.sectores(id) on delete cascade,
  sector_destino_id  uuid not null references public.sectores(id) on delete cascade,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  primary key (sector_origen_id, sector_destino_id)
);

-- Excepciones a la regla "mismo tipo de servicio".
create table public.traslado_reglas_servicio (
  servicio_origen_id   uuid not null references public.servicios(id) on delete cascade,
  servicio_destino_id  uuid not null references public.servicios(id) on delete cascade,
  permitido            boolean not null,
  created_at           timestamptz not null default now(),
  created_by           uuid default auth.uid(),
  primary key (servicio_origen_id, servicio_destino_id)
);

-- Triggers updated_at
do $$
declare t text;
begin
  foreach t in array array[
    'empresas','empresa_contactos','proyectos','areas','frentes_trabajo','empresa_frentes',
    'sectores','comedores','tipos_servicio','servicios','servicio_tarifas','comedor_servicios'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function seguridad.trg_updated_at()', t || '_updated_at', t);
  end loop;
end $$;
