-- =============================================================================
-- Kuntur Wasi · Migración 6: guardado atómico de permisos de un rol.
-- SECURITY INVOKER: las políticas RLS se aplican (solo el Superadmin puede).
-- =============================================================================

create or replace function public.guardar_permisos_rol(p_rol_id uuid, p_permisos jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_codigo text;
  v_total  int;
begin
  if not seguridad.es_superadmin() then
    raise exception 'Solo el Superadmin puede cambiar permisos' using errcode = '42501';
  end if;

  select codigo into v_codigo from public.roles where id = p_rol_id;
  if v_codigo is null then
    raise exception 'Rol no encontrado' using errcode = 'P0002';
  end if;
  if v_codigo = 'superadmin' then
    raise exception 'El Superadmin siempre tiene todos los permisos' using errcode = '22023';
  end if;
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' or jsonb_array_length(p_permisos) > 500 then
    raise exception 'Formato de permisos no válido' using errcode = '22023';
  end if;

  -- Un rol limitado a su empresa nunca recibe menús de administración ni tablas maestras.
  if (select alcance from public.roles where id = p_rol_id) = 'empresa' and exists (
    select 1 from jsonb_array_elements(p_permisos) x
    where x ->> 'menu' like 'maestras%' or x ->> 'menu' like 'admin%'
  ) then
    raise exception 'Un rol de alcance "empresa" no puede tener menús de administración' using errcode = '22023';
  end if;

  delete from public.rol_permisos where rol_id = p_rol_id;

  -- Solo se guardan acciones que el menú realmente ofrece.
  insert into public.rol_permisos (rol_id, menu_codigo, acciones)
  select p_rol_id, m.codigo, array(
           select distinct a
           from jsonb_array_elements_text(x -> 'acciones') a
           where a = any (m.acciones_disponibles)
           order by a
         )
  from jsonb_array_elements(p_permisos) x
  join public.menus m on m.codigo = x ->> 'menu'
  where exists (
    select 1 from jsonb_array_elements_text(x -> 'acciones') a where a = any (m.acciones_disponibles)
  );

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

revoke execute on function public.guardar_permisos_rol(uuid, jsonb) from anon, public;
grant execute on function public.guardar_permisos_rol(uuid, jsonb) to authenticated;
