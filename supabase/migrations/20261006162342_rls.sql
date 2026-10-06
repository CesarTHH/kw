-- =============================================================================
-- Kuntur Wasi · Migración 4: Row Level Security (RLS), permisos de tabla y
-- funciones RPC de contexto para la app.
--
-- Principio: nadie ve ni toca nada salvo que una política lo permita.
-- El rol "anon" (sin sesión) no tiene acceso a ninguna tabla.
-- =============================================================================

-- RLS en todas las tablas del esquema public.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- TRUNCATE ignora RLS: nunca para usuarios de la app.
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- La auditoría solo se escribe desde triggers / funciones del sistema.
revoke insert, update, delete, truncate on public.auditoria from authenticated;

-- ---------------------------------------------------------------------------
-- Catálogos: lectura para cualquier usuario activo; escritura con permiso.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('proyectos',                'maestras.catalogos'),
      ('areas',                    'maestras.catalogos'),
      ('sectores',                 'maestras.catalogos'),
      ('comedores',                'maestras.catalogos'),
      ('tipos_servicio',           'maestras.catalogos'),
      ('servicios',                'maestras.catalogos'),
      ('servicio_tarifas',         'maestras.catalogos'),
      ('comedor_servicios',        'maestras.catalogos'),
      ('traslado_reglas_sector',   'maestras.catalogos'),
      ('traslado_reglas_servicio', 'maestras.catalogos')
    ) as v(tabla, menu)
  loop
    execute format($f$create policy %I on public.%I for select to authenticated
                      using ((select seguridad.usuario_activo()))$f$, t.tabla || '_leer', t.tabla);
    execute format($f$create policy %I on public.%I for insert to authenticated
                      with check ((select seguridad.tiene_permiso(%L, 'editar')))$f$, t.tabla || '_crear', t.tabla, t.menu);
    execute format($f$create policy %I on public.%I for update to authenticated
                      using ((select seguridad.tiene_permiso(%L, 'editar')))
                      with check ((select seguridad.tiene_permiso(%L, 'editar')))$f$, t.tabla || '_editar', t.tabla, t.menu, t.menu);
    execute format($f$create policy %I on public.%I for delete to authenticated
                      using ((select seguridad.tiene_permiso(%L, 'editar')))$f$, t.tabla || '_borrar', t.tabla, t.menu);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Empresas y contactos: cada usuario ve solo lo que su alcance permite.
-- ---------------------------------------------------------------------------
create policy empresas_leer on public.empresas for select to authenticated
  using (seguridad.puede_ver_empresa(id));
create policy empresas_crear on public.empresas for insert to authenticated
  with check ((select seguridad.tiene_permiso('maestras.clientes', 'editar')) and (select seguridad.mi_alcance()) = 'todas');
create policy empresas_editar on public.empresas for update to authenticated
  using ((select seguridad.tiene_permiso('maestras.clientes', 'editar')) and seguridad.puede_ver_empresa(id))
  with check ((select seguridad.tiene_permiso('maestras.clientes', 'editar')) and seguridad.puede_ver_empresa(id));
create policy empresas_borrar on public.empresas for delete to authenticated
  using ((select seguridad.es_superadmin()));

create policy contactos_leer on public.empresa_contactos for select to authenticated
  using (seguridad.puede_ver_empresa(empresa_id));
create policy contactos_crear on public.empresa_contactos for insert to authenticated
  with check ((select seguridad.tiene_permiso('maestras.clientes', 'editar')) and seguridad.puede_ver_empresa(empresa_id));
create policy contactos_editar on public.empresa_contactos for update to authenticated
  using ((select seguridad.tiene_permiso('maestras.clientes', 'editar')) and seguridad.puede_ver_empresa(empresa_id))
  with check ((select seguridad.tiene_permiso('maestras.clientes', 'editar')) and seguridad.puede_ver_empresa(empresa_id));
create policy contactos_borrar on public.empresa_contactos for delete to authenticated
  using ((select seguridad.tiene_permiso('maestras.clientes', 'editar')) and seguridad.puede_ver_empresa(empresa_id));

-- ---------------------------------------------------------------------------
-- Frentes de trabajo: una empresa solo ve los frentes que tiene asignados.
-- ---------------------------------------------------------------------------
create policy frentes_leer on public.frentes_trabajo for select to authenticated
  using (
    (select seguridad.mi_alcance()) in ('todas', 'comedor')
    or exists (
      select 1 from public.empresa_frentes ef
      where ef.frente_id = frentes_trabajo.id
        and ef.empresa_id = (select seguridad.mi_empresa_id())
    )
  );
create policy frentes_crear on public.frentes_trabajo for insert to authenticated
  with check ((select seguridad.tiene_permiso('maestras.frentes', 'editar')) and (select seguridad.mi_alcance()) = 'todas');
create policy frentes_editar on public.frentes_trabajo for update to authenticated
  using ((select seguridad.tiene_permiso('maestras.frentes', 'editar')) and (select seguridad.mi_alcance()) = 'todas')
  with check ((select seguridad.tiene_permiso('maestras.frentes', 'editar')) and (select seguridad.mi_alcance()) = 'todas');
create policy frentes_borrar on public.frentes_trabajo for delete to authenticated
  using ((select seguridad.es_superadmin()));

create policy empresa_frentes_leer on public.empresa_frentes for select to authenticated
  using (seguridad.puede_ver_empresa(empresa_id));
create policy empresa_frentes_crear on public.empresa_frentes for insert to authenticated
  with check ((select seguridad.tiene_permiso('maestras.frentes', 'editar')) and (select seguridad.mi_alcance()) = 'todas');
create policy empresa_frentes_editar on public.empresa_frentes for update to authenticated
  using ((select seguridad.tiene_permiso('maestras.frentes', 'editar')) and (select seguridad.mi_alcance()) = 'todas')
  with check ((select seguridad.tiene_permiso('maestras.frentes', 'editar')) and (select seguridad.mi_alcance()) = 'todas');
create policy empresa_frentes_borrar on public.empresa_frentes for delete to authenticated
  using ((select seguridad.tiene_permiso('maestras.frentes', 'editar')) and (select seguridad.mi_alcance()) = 'todas');

-- ---------------------------------------------------------------------------
-- Roles, menús y permisos: solo el Superadmin los modifica.
-- ---------------------------------------------------------------------------
create policy roles_leer on public.roles for select to authenticated
  using (
    (select seguridad.es_superadmin())
    or (select seguridad.tiene_permiso('maestras.usuarios', 'ver'))
    or id = (select c.rol_id from seguridad.contexto() c)
  );
create policy roles_crear on public.roles for insert to authenticated
  with check ((select seguridad.es_superadmin()) and codigo <> 'superadmin' and not es_sistema);
create policy roles_editar on public.roles for update to authenticated
  using ((select seguridad.es_superadmin()))
  with check ((select seguridad.es_superadmin()));
create policy roles_borrar on public.roles for delete to authenticated
  using ((select seguridad.es_superadmin()) and not es_sistema);

create policy menus_leer on public.menus for select to authenticated
  using ((select seguridad.usuario_activo()));
create policy menus_editar on public.menus for update to authenticated
  using ((select seguridad.es_superadmin()))
  with check ((select seguridad.es_superadmin()));

create policy rol_permisos_leer on public.rol_permisos for select to authenticated
  using (
    (select seguridad.es_superadmin())
    or rol_id = (select c.rol_id from seguridad.contexto() c where c.activo)
  );
create policy rol_permisos_crear on public.rol_permisos for insert to authenticated
  with check ((select seguridad.es_superadmin()));
create policy rol_permisos_editar on public.rol_permisos for update to authenticated
  using ((select seguridad.es_superadmin()))
  with check ((select seguridad.es_superadmin()));
create policy rol_permisos_borrar on public.rol_permisos for delete to authenticated
  using ((select seguridad.es_superadmin()));

-- ---------------------------------------------------------------------------
-- Perfiles de usuario. Las altas las hace el servidor con service_role
-- (Supabase Auth + trigger). Nunca se borran: se desactivan.
-- ---------------------------------------------------------------------------
-- Un usuario interno (sin empresa) solo es visible para roles de alcance "todas".
create policy perfiles_leer on public.perfiles for select to authenticated
  using (
    id = (select auth.uid())
    or (
      (select seguridad.tiene_permiso('maestras.usuarios', 'ver'))
      and case when empresa_id is null then (select seguridad.mi_alcance()) = 'todas'
               else seguridad.puede_ver_empresa(empresa_id) end
    )
  );
create policy perfiles_editar on public.perfiles for update to authenticated
  using (
    (select seguridad.tiene_permiso('maestras.usuarios', 'editar'))
    and case when empresa_id is null then (select seguridad.mi_alcance()) = 'todas'
             else seguridad.puede_ver_empresa(empresa_id) end
  )
  with check (
    (select seguridad.tiene_permiso('maestras.usuarios', 'editar'))
    and case when empresa_id is null then (select seguridad.mi_alcance()) = 'todas'
             else seguridad.puede_ver_empresa(empresa_id) end
  );
revoke insert, delete on public.perfiles from authenticated;
-- Solo estas columnas se pueden cambiar desde la app.
revoke update on public.perfiles from authenticated;
grant update (nombre, rol_id, empresa_id, comedor_id, estado, debe_cambiar_password) on public.perfiles to authenticated;

-- ---------------------------------------------------------------------------
-- Auditoría: solo lectura con permiso.
-- ---------------------------------------------------------------------------
create policy auditoria_leer on public.auditoria for select to authenticated
  using ((select seguridad.tiene_permiso('admin.auditoria', 'ver')));

-- ---------------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------------
create policy configuracion_leer on public.configuracion for select to authenticated
  using (
    (publica and (select seguridad.usuario_activo()))
    or (select seguridad.tiene_permiso('admin.configuracion', 'ver'))
  );
create policy configuracion_crear on public.configuracion for insert to authenticated
  with check ((select seguridad.tiene_permiso('admin.configuracion', 'editar')));
create policy configuracion_editar on public.configuracion for update to authenticated
  using ((select seguridad.tiene_permiso('admin.configuracion', 'editar')))
  with check ((select seguridad.tiene_permiso('admin.configuracion', 'editar')));

create policy config_horarios_leer on public.config_horarios for select to authenticated
  using ((select seguridad.usuario_activo()));
create policy config_horarios_editar on public.config_horarios for update to authenticated
  using ((select seguridad.tiene_permiso('admin.configuracion', 'editar')))
  with check ((select seguridad.tiene_permiso('admin.configuracion', 'editar')));

-- ---------------------------------------------------------------------------
-- RPC para la app
-- ---------------------------------------------------------------------------

-- Datos del usuario actual. Funciona aunque falte verificar MFA, para que la
-- app sepa a dónde redirigir (cambiar contraseña, MFA, cuenta pendiente…).
create or replace function public.mi_contexto()
returns table (
  usuario_id             uuid,
  nombre                 text,
  correo                 text,
  estado                 text,
  rol_codigo             text,
  rol_nombre             text,
  alcance                text,
  requiere_mfa           boolean,
  mfa_verificado         boolean,
  debe_cambiar_password  boolean,
  empresa_id             uuid,
  empresa_ruc            text,
  empresa_nombre         text,
  comedor_id             uuid,
  activo                 boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.nombre, p.correo, p.estado,
    r.codigo, r.nombre, r.alcance, coalesce(r.requiere_mfa, false),
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2',
    p.debe_cambiar_password,
    e.id, e.ruc, e.nombre_corto,
    p.comedor_id,
    seguridad.usuario_activo()
  from public.perfiles p
  left join public.roles r on r.id = p.rol_id
  left join public.empresas e on e.id = p.empresa_id
  where p.id = auth.uid();
$$;

-- Menús y acciones permitidas para el usuario actual (árbol plano ordenado).
create or replace function public.mi_menu()
returns table (
  codigo        text,
  padre_codigo  text,
  nombre        text,
  icono         text,
  ruta          text,
  orden         int,
  acciones      text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with ctx as (select * from seguridad.contexto() where activo)
  select m.codigo, m.padre_codigo, m.nombre, m.icono, m.ruta, m.orden,
         case when ctx.rol_codigo = 'superadmin' then m.acciones_disponibles else rp.acciones end
  from public.menus m
  cross join ctx
  left join public.rol_permisos rp on rp.menu_codigo = m.codigo and rp.rol_id = ctx.rol_id
  where m.activo
    and (ctx.rol_codigo = 'superadmin' or 'ver' = any (rp.acciones))
  order by m.orden, m.codigo;
$$;

revoke execute on function public.mi_contexto() from anon, public;
revoke execute on function public.mi_menu() from anon, public;
grant execute on function public.mi_contexto() to authenticated;
grant execute on function public.mi_menu() to authenticated;

-- Funciones internas: solo usuarios con sesión (el esquema no se expone en la API).
revoke execute on all functions in schema seguridad from public, anon;
grant execute on all functions in schema seguridad to authenticated, service_role;

-- Las nuevas tablas y funciones que se creen en el futuro tampoco quedan abiertas.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
alter default privileges in schema public revoke all on functions from anon, public;
