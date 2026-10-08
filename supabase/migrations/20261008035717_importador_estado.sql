-- =============================================================================
-- Kuntur Wasi · Fase 7 · importador (2/3): estado de la importación (marcar, existentes, finalizar).
-- =============================================================================

-- Cuántos de estos movimientos ya existen (para la simulación).
create or replace function public.importacion_existentes(p_origenes text[])
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not seguridad.puede_importar() then
    raise exception 'No tienes permiso para importar' using errcode = '42501';
  end if;
  return (select count(*)::int from public.racion_movimientos where origen_id = any (p_origenes));
end;
$$;

-- Estado "importando" (solo desde "analizado") o "fallido" con el motivo.
create or replace function public.importacion_marcar(p_id uuid, p_estado text, p_detalle text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not seguridad.puede_importar() then
    raise exception 'No tienes permiso para importar' using errcode = '42501';
  end if;
  if p_estado = 'importando' then
    update public.importaciones set estado = 'importando' where id = p_id and estado in ('analizado', 'importando', 'fallido');
    if not found then
      raise exception 'Primero hay que ejecutar la simulación' using errcode = '22023';
    end if;
    insert into public.auditoria (usuario_id, modulo, accion, entidad, entidad_id)
    values (auth.uid(), 'importador', 'iniciar_importacion', 'importaciones', p_id::text);
  elsif p_estado = 'fallido' then
    update public.importaciones set estado = 'fallido', resultado = jsonb_build_object('error', left(p_detalle, 500))
    where id = p_id and estado = 'importando';
  else
    raise exception 'Estado no válido' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.importacion_finalizar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.importaciones;
begin
  if not seguridad.puede_importar() then
    raise exception 'No tienes permiso para importar' using errcode = '42501';
  end if;
  select * into i from public.importaciones where id = p_id and estado = 'importando' for update;
  if not found then
    raise exception 'La importación no está en curso' using errcode = '22023';
  end if;
  if not i.catalogos_hechos
     or (select count(*) from public.importacion_lotes l where l.importacion_id = p_id and l.lote < i.lotes_total) < i.lotes_total
     or exists (select 1 from unnest(i.meses) m where not (m = any (i.meses_listos))) then
    raise exception 'Faltan pasos por terminar' using errcode = '22023';
  end if;
  update public.importaciones set estado = 'importado', terminado_en = now() where id = p_id;
  insert into public.auditoria (usuario_id, modulo, accion, entidad, entidad_id, detalle)
  values (auth.uid(), 'importador', 'importacion_terminada', 'importaciones', p_id::text,
          jsonb_build_object('resumen', i.resumen, 'resultado', i.resultado));
end;
$$;

revoke execute on function public.importacion_existentes(text[]) from public, anon;
revoke execute on function public.importacion_marcar(uuid, text, text) from public, anon;
revoke execute on function public.importacion_finalizar(uuid) from public, anon;
grant execute on function public.importacion_existentes(text[]) to authenticated;
grant execute on function public.importacion_marcar(uuid, text, text) to authenticated;
grant execute on function public.importacion_finalizar(uuid) to authenticated;
