-- =============================================================================
-- Kuntur Wasi · Fase 5 (1/3): refrigerios, tablas y seguridad.
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
revoke execute on function seguridad.puede_ver_refrigerios(uuid, uuid) from public, anon;
grant execute on function seguridad.puede_ver_refrigerios(uuid, uuid) to authenticated, service_role;

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

-- Turnos de entrega por defecto (configurables desde Catálogos).
insert into public.refrigerio_turnos (hora, etiqueta) values
  ('09:30', '9:30 am'), ('11:30', '11:30 am'), ('18:00', '6:00 pm')
on conflict (hora) do nothing;

