-- Ejecutar UNA vez en Supabase → SQL Editor (proyecto de pruebas).
-- Es la migración 20261007211500_refrigerios_borradores_estandar más su registro en el historial.
-- =============================================================================
-- Kuntur Wasi · Fase 5 (3/3): borradores de refrigerios y guardado atómico del estándar.
-- =============================================================================
alter table public.borradores drop constraint borradores_modulo_check;
alter table public.borradores add constraint borradores_modulo_check
  check (modulo in ('programar', 'adicionar_reducir', 'trasladar', 'refrigerios'));

-- Composición estándar en una sola transacción (Catálogos). p_items: [{producto_id, cantidad}]
create or replace function public.guardar_estandar_refrigerio(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not seguridad.tiene_permiso('maestras.catalogos', 'editar') then
    raise exception 'No tienes permiso para editar catálogos' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'El refrigerio estándar debe tener al menos un producto' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('refrigerio_estandar'));
  delete from public.refrigerio_estandar_items
  where producto_id not in (select (x ->> 'producto_id')::uuid from jsonb_array_elements(p_items) x);
  insert into public.refrigerio_estandar_items (producto_id, cantidad)
  select (x ->> 'producto_id')::uuid, (x ->> 'cantidad')::int from jsonb_array_elements(p_items) x
  on conflict (producto_id) do update set cantidad = excluded.cantidad;
end;
$$;
revoke execute on function public.guardar_estandar_refrigerio(jsonb) from public, anon;
grant execute on function public.guardar_estandar_refrigerio(jsonb) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261007211500', 'refrigerios_borradores_estandar')
on conflict (version) do nothing;
