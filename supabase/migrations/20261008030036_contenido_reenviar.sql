-- =============================================================================
-- Kuntur Wasi · Fase 6 (5/7): reenviar conserva adjuntos y "responder a".
-- =============================================================================

-- Reenviar desde el historial conserva adjuntos y "responder a".
create or replace function public.reenviar_correo(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c     public.correos_pendientes;
  v_id  uuid;
begin
  if not (seguridad.tiene_permiso('admin.correos', 'enviar') and seguridad.mi_alcance() = 'todas') then
    raise exception 'No tienes permiso para reenviar correos' using errcode = '42501';
  end if;
  select * into c from public.correos_pendientes where id = p_id;
  if not found then
    raise exception 'Correo no encontrado' using errcode = 'P0002';
  end if;
  if c.estado in ('pendiente', 'procesando') then
    raise exception 'El correo todavía está en cola' using errcode = '22023';
  end if;

  insert into public.correos_pendientes (plantilla, datos, empresa_id, envio_id, reenvio_de, adjuntos, responder_a)
  values (c.plantilla, c.datos, c.empresa_id, c.envio_id, c.id, c.adjuntos, c.responder_a)
  returning id into v_id;

  insert into public.correo_destinatarios (correo_id, correo, tipo, estado)
  select v_id, d.correo, d.tipo,
         case when exists (select 1 from public.correos_suprimidos s where s.correo = lower(d.correo))
              then 'suprimido' else 'pendiente' end
  from public.correo_destinatarios d
  where d.correo_id = p_id;

  if not exists (select 1 from public.correo_destinatarios where correo_id = v_id and estado = 'pendiente' and tipo <> 'cco') then
    update public.correos_pendientes
    set estado = 'fallido', ultimo_error = 'Sin destinatarios válidos', procesado_en = now()
    where id = v_id;
  end if;

  insert into public.auditoria (usuario_id, modulo, accion, entidad, entidad_id, detalle)
  values (auth.uid(), 'correos', 'reenviar', 'correos_pendientes', v_id::text, jsonb_build_object('original', p_id));
  return v_id;
end;
$$;

