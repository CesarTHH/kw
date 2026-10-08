-- =============================================================================
-- Kuntur Wasi · Mejora de rendimiento.
--
-- 1. mi_sesion(): contexto + menú + alertas en UNA sola llamada (antes eran tres
--    viajes a la base de datos en cada página).
-- 2. Índices para las llaves foráneas que se usan al filtrar o al borrar.
-- =============================================================================

create or replace function public.mi_sesion()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contexto', (select to_jsonb(c) from public.mi_contexto() c limit 1),
    'menu', coalesce((select jsonb_agg(to_jsonb(m)) from public.mi_menu() m), '[]'::jsonb),
    'alertas', coalesce((select jsonb_agg(to_jsonb(a)) from public.mis_alertas() a), '[]'::jsonb)
  );
$$;
revoke execute on function public.mi_sesion() from public, anon;
grant execute on function public.mi_sesion() to authenticated;

create index if not exists frentes_trabajo_area_idx on public.frentes_trabajo (area_id);
create index if not exists comedores_sector_idx on public.comedores (sector_id);
create index if not exists servicios_tipo_idx on public.servicios (tipo_servicio_id);
create index if not exists perfiles_comedor_idx on public.perfiles (comedor_id);
create index if not exists menus_padre_idx on public.menus (padre_codigo);
create index if not exists rol_permisos_menu_idx on public.rol_permisos (menu_codigo);
create index if not exists borradores_empresa_idx on public.borradores (empresa_id);
create index if not exists racion_movimientos_frente_idx on public.racion_movimientos (frente_id);
create index if not exists racion_movimientos_par_idx on public.racion_movimientos (traslado_par) where traslado_par is not null;
create index if not exists racion_saldos_frente_idx on public.racion_saldos (frente_id);
create index if not exists refrigerio_pedidos_turno_idx on public.refrigerio_pedidos (turno_id);
create index if not exists refrigerio_movimientos_envio_idx on public.refrigerio_movimientos (envio_id);
create index if not exists refrigerio_pedido_items_producto_idx on public.refrigerio_pedido_items (producto_id);
create index if not exists mensajes_contacto_correo_idx on public.mensajes_contacto (correo_id);
create index if not exists correos_pendientes_reenvio_idx on public.correos_pendientes (reenvio_de) where reenvio_de is not null;
create index if not exists solicitudes_registro_empresa_idx on public.solicitudes_registro (empresa_id);
