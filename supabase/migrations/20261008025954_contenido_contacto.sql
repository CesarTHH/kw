-- =============================================================================
-- Kuntur Wasi · Fase 6 (4/7): Contáctanos (mensajes, adjuntos, límites).
-- =============================================================================

create table public.mensajes_contacto (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null,
  empresa_id  uuid references public.empresas(id),
  para        text not null,
  cc          text[] not null default '{}',
  asunto      text not null check (length(btrim(asunto)) between 1 and 200),
  mensaje     text not null check (length(btrim(mensaje)) between 1 and 5000),
  adjuntos    jsonb not null default '[]' check (jsonb_typeof(adjuntos) = 'array'),
  correo_id   uuid references public.correos_pendientes(id),
  clave       uuid not null unique,
  created_at  timestamptz not null default now()
);
create index on public.mensajes_contacto (usuario_id, created_at desc);
create index on public.mensajes_contacto (created_at desc);

alter table public.mensajes_contacto enable row level security;
revoke all on public.mensajes_contacto from anon;
revoke insert, update, delete, truncate, references, trigger on public.mensajes_contacto from authenticated;
grant select on public.mensajes_contacto to authenticated;
create policy mensajes_contacto_leer on public.mensajes_contacto for select to authenticated
  using (usuario_id = (select auth.uid())
         or ((select seguridad.tiene_permiso('admin.correos', 'ver')) and (select seguridad.mi_alcance()) = 'todas'));

-- Archivos subidos por el usuario a Contáctanos en la última hora (freno contra usar el bucket como almacén).
create or replace function seguridad.subidas_contacto_recientes()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from storage.objects
  where bucket_id = 'contacto' and owner_id = auth.uid()::text and created_at > now() - interval '1 hour';
$$;

-- Storage: cada usuario sube en su propia carpeta (primera carpeta = su id), hasta 40 archivos por hora.
create policy contacto_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'contacto'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and seguridad.usuario_activo()
              and seguridad.tiene_permiso('contactanos', 'enviar')
              and seguridad.subidas_contacto_recientes() < 40);
create policy contacto_leer on storage.objects for select to authenticated
  using (bucket_id = 'contacto'
         and ((storage.foldername(name))[1] = (select auth.uid())::text
              or (seguridad.tiene_permiso('admin.correos', 'ver') and seguridad.mi_alcance() = 'todas')));

-- Archivos que nadie usó (subidas fallidas o abandonadas): los quita la Edge Function con la API de Storage.
create or replace function public.archivos_huerfanos(p_limite int default 100)
returns table (bucket text, ruta text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.created_at < now() - interval '2 hours'
    and ((o.bucket_id = 'contacto' and not exists (
            select 1 from public.mensajes_contacto m, jsonb_array_elements(m.adjuntos) a where a ->> 'ruta' = o.name))
      or (o.bucket_id = 'documentos' and not exists (select 1 from public.documentos d where d.ruta = o.name)))
  order by o.created_at
  limit least(greatest(p_limite, 1), 500);
$$;

-- p_adjuntos: [{ruta, nombre}] ya subidos por el usuario al bucket "contacto".
create or replace function public.enviar_contacto(p_cc text[], p_asunto text, p_mensaje text, p_adjuntos jsonb, p_clave uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx         record;
  v_id        uuid;
  v_correo    uuid;
  v_para      text;
  v_yo        text;
  v_nombre    text;
  v_cc        text[];
  v_asunto    text := btrim(coalesce(p_asunto, ''));
  v_mensaje   text := btrim(coalesce(p_mensaje, ''));
  v_adjuntos  jsonb := '[]'::jsonb;
  v_total     bigint := 0;
  v_tipos     jsonb;
  a           jsonb;
  v_ruta      text;
  v_tamano    bigint;
  v_mime      text;
  v_nom       text;
begin
  select * into ctx from seguridad.contexto() c where c.activo;
  if not found or not seguridad.tiene_permiso('contactanos', 'enviar') then
    raise exception 'No tienes permiso para enviar mensajes' using errcode = '42501';
  end if;
  if exists (select 1 from public.perfiles where id = ctx.usuario_id and debe_cambiar_password) then
    raise exception 'Debes cambiar tu contraseña antes de continuar' using errcode = '42501';
  end if;
  if p_clave is null then
    raise exception 'Falta la clave del envío' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('contacto:' || ctx.usuario_id::text));
  select id into v_id from public.mensajes_contacto where clave = p_clave and usuario_id = ctx.usuario_id;
  if found then
    return v_id;
  end if;
  if exists (select 1 from public.mensajes_contacto where clave = p_clave) then
    raise exception 'Clave de envío no válida' using errcode = '22023';
  end if;
  if (select count(*) from public.mensajes_contacto
      where usuario_id = ctx.usuario_id and created_at > now() - interval '1 hour')
     >= seguridad.config_entero('contacto.max_por_hora', 10) then
    raise exception 'Enviaste demasiados mensajes en la última hora. Inténtalo más tarde.' using errcode = '22023';
  end if;

  if length(v_asunto) not between 1 and 200 then
    raise exception 'El asunto debe tener entre 1 y 200 caracteres' using errcode = '22023';
  end if;
  if length(v_mensaje) not between 1 and 5000 then
    raise exception 'El mensaje debe tener entre 1 y 5000 caracteres' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct lower(btrim(x))), '{}') into v_cc
  from unnest(coalesce(p_cc, '{}'::text[])) x
  where btrim(x) <> '';
  if cardinality(v_cc) > seguridad.config_entero('contacto.cc_maximo', 5) then
    raise exception 'Puedes poner hasta % direcciones en copia', seguridad.config_entero('contacto.cc_maximo', 5) using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_cc) x where x !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(x) > 254) then
    raise exception 'Hay una dirección en copia que no es válida' using errcode = '22023';
  end if;

  select valor #>> '{}' into v_para from public.configuracion where clave = 'contacto.destinatario';
  if v_para is null or v_para !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El destinatario de Contáctanos no está configurado' using errcode = '22023';
  end if;
  select correo, nombre into v_yo, v_nombre from public.perfiles where id = ctx.usuario_id;

  -- Adjuntos: deben estar en la carpeta del usuario, no usados antes, con tipo y tamaño permitidos.
  if jsonb_typeof(coalesce(p_adjuntos, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_adjuntos, '[]'::jsonb)) > 10 then
    raise exception 'Puedes adjuntar hasta 10 archivos' using errcode = '22023';
  end if;
  select valor into v_tipos from public.configuracion where clave = 'archivos.contacto_tipos';
  for a in select value from jsonb_array_elements(coalesce(p_adjuntos, '[]'::jsonb)) loop
    v_ruta := a ->> 'ruta';
    v_nom := left(btrim(coalesce(a ->> 'nombre', '')), 150);
    if v_ruta is null or v_ruta !~ ('^' || ctx.usuario_id::text || '/[0-9a-f-]{36}\.(pdf|png|jpg|xlsx|docx)$') or v_nom = '' then
      raise exception 'Un adjunto no es válido' using errcode = '22023';
    end if;
    select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' into v_tamano, v_mime
    from storage.objects o
    where o.bucket_id = 'contacto' and o.name = v_ruta and o.owner_id = ctx.usuario_id::text;
    if v_tamano is null then
      raise exception 'Un adjunto no se encontró. Vuelve a adjuntarlo.' using errcode = '22023';
    end if;
    if v_tipos is not null and not (v_tipos ? v_mime) then
      raise exception 'El tipo de archivo de "%" no está permitido', v_nom using errcode = '22023';
    end if;
    -- El tipo debe corresponder a la extensión de la ruta, y el nombre lleva siempre esa extensión.
    if v_mime is distinct from (case substring(v_ruta from '\.([a-z]+)$')
         when 'pdf' then 'application/pdf' when 'png' then 'image/png' when 'jpg' then 'image/jpeg'
         when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
         when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end) then
      raise exception 'Un adjunto no es válido' using errcode = '22023';
    end if;
    v_nom := left(regexp_replace(v_nom, '\.[^.]*$', ''), 140) || '.' || substring(v_ruta from '\.([a-z]+)$');
    if exists (select 1 from public.mensajes_contacto m, jsonb_array_elements(m.adjuntos) x where x ->> 'ruta' = v_ruta)
       or v_adjuntos @> jsonb_build_array(jsonb_build_object('ruta', v_ruta)) then
      raise exception 'Un adjunto ya fue usado' using errcode = '22023';
    end if;
    v_total := v_total + v_tamano;
    v_adjuntos := v_adjuntos || jsonb_build_object('bucket', 'contacto', 'ruta', v_ruta, 'nombre', v_nom, 'tipo', v_mime, 'tamano', v_tamano);
  end loop;
  if v_total > seguridad.config_entero('archivos.contacto_max_bytes', 10485760) then
    raise exception 'Los adjuntos superan el tamaño máximo de % MB',
      round(seguridad.config_entero('archivos.contacto_max_bytes', 10485760) / 1048576.0, 1) using errcode = '22023';
  end if;

  -- Va al destinatario, a las copias y una copia al propio remitente (un correo por destinatario).
  v_correo := seguridad.encolar_correo(
    'contacto',
    jsonb_build_object(
      'asunto', v_asunto,
      'mensaje', v_mensaje,
      'usuario', v_nombre,
      'correo_usuario', v_yo,
      'cc', coalesce(nullif(array_to_string(v_cc, ', '), ''), 'nadie')
    ) || case when ctx.empresa_id is null then jsonb_build_object('empresa', 'Kuntur Wasi', 'ruc', '—') else '{}'::jsonb end,
    array[v_para] || v_cc || array[v_yo],
    ctx.empresa_id, null, false
  );
  if v_correo is null then
    raise exception 'El envío de mensajes no está disponible en este momento' using errcode = '22023';
  end if;
  update public.correos_pendientes set adjuntos = v_adjuntos, responder_a = v_yo where id = v_correo;

  insert into public.mensajes_contacto (usuario_id, empresa_id, para, cc, asunto, mensaje, adjuntos, correo_id, clave)
  values (ctx.usuario_id, ctx.empresa_id, v_para, v_cc, v_asunto, v_mensaje, v_adjuntos, v_correo, p_clave)
  returning id into v_id;

  insert into public.auditoria (usuario_id, empresa_id, modulo, accion, entidad, entidad_id, detalle)
  values (ctx.usuario_id, ctx.empresa_id, 'contactanos', 'enviar_mensaje', 'mensajes_contacto', v_id::text,
          jsonb_build_object('para', v_para, 'cc', v_cc, 'adjuntos', jsonb_array_length(v_adjuntos)));
  return v_id;
end;
$$;

revoke execute on function public.enviar_contacto(text[], text, text, jsonb, uuid) from public, anon;
grant execute on function public.enviar_contacto(text[], text, text, jsonb, uuid) to authenticated;
revoke execute on function public.archivos_huerfanos(int) from public, anon, authenticated;
grant execute on function public.archivos_huerfanos(int) to service_role;
revoke execute on all functions in schema seguridad from public, anon;
grant execute on all functions in schema seguridad to authenticated, service_role;
revoke execute on function seguridad.mover_saldo(uuid, date, uuid, uuid, uuid, int) from authenticated;
revoke execute on function seguridad.encolar_correo(text, jsonb, text[], uuid, uuid, boolean) from authenticated;
revoke execute on function seguridad.disparar_envio_correos() from authenticated;
