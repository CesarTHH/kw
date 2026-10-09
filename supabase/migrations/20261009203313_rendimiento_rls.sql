-- =============================================================================
-- Kuntur Wasi · Rendimiento de las reglas de seguridad (RLS).
--
-- Las políticas de lectura de raciones y refrigerios llamaban a una función por
-- CADA fila (seguridad.puede_ver_raciones(empresa_id, comedor_id)). Con el
-- volumen del histórico (~320 000 movimientos) el tablero de un contratista
-- superaba los 5 minutos. Ahora el perfil del usuario se calcula UNA vez por
-- consulta con (select …) y cada fila solo compara columnas.
-- La regla de quién ve qué no cambia.
-- =============================================================================

create or replace function seguridad.mi_comedor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.comedor_id from seguridad.contexto() c where c.activo;
$$;
revoke execute on function seguridad.mi_comedor_id() from public, anon;
grant execute on function seguridad.mi_comedor_id() to authenticated, service_role;

-- Raciones
alter policy movimientos_leer on public.racion_movimientos
  using (
    (select seguridad.tiene_permiso('raciones', 'ver'))
    and (
      (select seguridad.mi_alcance()) = 'todas'
      or ((select seguridad.mi_alcance()) = 'empresa' and empresa_id = (select seguridad.mi_empresa_id()))
      or ((select seguridad.mi_alcance()) = 'comedor' and comedor_id = (select seguridad.mi_comedor_id()))
    )
  );
alter policy saldos_leer on public.racion_saldos
  using (
    (select seguridad.tiene_permiso('raciones', 'ver'))
    and (
      (select seguridad.mi_alcance()) = 'todas'
      or ((select seguridad.mi_alcance()) = 'empresa' and empresa_id = (select seguridad.mi_empresa_id()))
      or ((select seguridad.mi_alcance()) = 'comedor' and comedor_id = (select seguridad.mi_comedor_id()))
    )
  );

-- Refrigerios
alter policy refrigerio_pedidos_leer on public.refrigerio_pedidos
  using (
    (select seguridad.tiene_permiso('refrigerios', 'ver'))
    and (
      (select seguridad.mi_alcance()) = 'todas'
      or ((select seguridad.mi_alcance()) = 'empresa' and empresa_id = (select seguridad.mi_empresa_id()))
      or ((select seguridad.mi_alcance()) = 'comedor' and comedor_id = (select seguridad.mi_comedor_id()))
    )
  );
-- Los ítems y movimientos heredan la visibilidad del pedido (que ya filtra su propia política).
alter policy refrigerio_items_leer on public.refrigerio_pedido_items
  using (exists (select 1 from public.refrigerio_pedidos p where p.id = pedido_id));
alter policy refrigerio_movimientos_leer on public.refrigerio_movimientos
  using (exists (select 1 from public.refrigerio_pedidos p where p.id = pedido_id));

-- Empresas, contactos y asignaciones (tablas pequeñas, mismo patrón por consistencia).
alter policy empresas_leer on public.empresas
  using ((select seguridad.mi_alcance()) in ('todas', 'comedor') or id = (select seguridad.mi_empresa_id()));
alter policy contactos_leer on public.empresa_contactos
  using ((select seguridad.mi_alcance()) in ('todas', 'comedor') or empresa_id = (select seguridad.mi_empresa_id()));
alter policy empresa_frentes_leer on public.empresa_frentes
  using ((select seguridad.mi_alcance()) in ('todas', 'comedor') or empresa_id = (select seguridad.mi_empresa_id()));

