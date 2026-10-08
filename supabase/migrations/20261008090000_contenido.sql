-- =============================================================================
-- Kuntur Wasi · Fase 6: contenido y contacto.
--
-- Documentos PDF con versiones (menú semanal 1 y 2, términos y condiciones,
-- manual) en un bucket privado; alertas post-login; formulario Contáctanos
-- con adjuntos que salen por la cola de correos.
-- Los archivos se suben con la sesión del usuario: las políticas de Storage
-- deciden quién sube y quién lee; nunca se usa la clave service_role en la app.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Configuración nueva
-- ---------------------------------------------------------------------------
insert into public.configuracion (clave, valor, descripcion, publica) values
  ('archivos.documento_max_bytes', '10485760', 'Tamaño máximo del PDF de términos y condiciones o del manual', true),
  ('contacto.cc_maximo',           '5',        'Máximo de direcciones en copia (CC) en Contáctanos', true),
  ('contacto.max_por_hora',        '10',       'Máximo de mensajes de Contáctanos por usuario en una hora', true)
on conflict (clave) do nothing;
-- El formulario muestra el destinatario fijo a todos los usuarios.
update public.configuracion set publica = true where clave = 'contacto.destinatario';

create or replace function seguridad.config_entero(p_clave text, p_defecto bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case when jsonb_typeof(valor) = 'number' then (valor #>> '{}')::bigint end
                   from public.configuracion where clave = p_clave), p_defecto);
$$;

-- ---------------------------------------------------------------------------
-- Buckets privados
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('documentos', 'documentos', false, 10485760, array['application/pdf']),
  ('contacto',   'contacto',   false, 10485760, array['application/pdf', 'image/png', 'image/jpeg',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Documentos con versiones
-- ---------------------------------------------------------------------------
create table public.documentos (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('menu_1', 'menu_2', 'terminos', 'manual')),
  version         int not null check (version >= 1),
  titulo          text not null check (length(btrim(titulo)) between 1 and 120),
  nombre_archivo  text not null check (length(nombre_archivo) between 1 and 200),
  ruta            text not null unique,
  tamano          bigint not null check (tamano > 0),
  vigente         boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  unique (tipo, version)
);
create unique index documentos_vigente_uq on public.documentos (tipo) where vigente;

create or replace function seguridad.puede_ver_documento(p_tipo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select seguridad.usuario_activo() and case
    when p_tipo in ('menu_1', 'menu_2') then seguridad.tiene_permiso('menu_semanal', 'ver')
    when p_tipo in ('terminos', 'manual') then seguridad.tiene_permiso('manual_tyc', 'ver')
    else false end;
$$;

create or replace function seguridad.puede_editar_documento(p_tipo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select seguridad.usuario_activo() and case
    when p_tipo in ('menu_1', 'menu_2') then seguridad.tiene_permiso('menu_semanal', 'editar')
    when p_tipo in ('terminos', 'manual') then seguridad.tiene_permiso('manual_tyc', 'editar')
    else false end;
$$;

alter table public.documentos enable row level security;
revoke all on public.documentos from anon;
revoke insert, update, delete, truncate, references, trigger on public.documentos from authenticated;
grant select on public.documentos to authenticated;
create policy documentos_leer on public.documentos for select to authenticated
  using (vigente and seguridad.puede_ver_documento(tipo) or seguridad.puede_editar_documento(tipo));

-- Storage: la primera carpeta de la ruta es el tipo (menu_1/…). Sin modificar ni borrar: cada versión es un archivo nuevo.
create or replace function seguridad.puede_leer_archivo_documento(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select seguridad.puede_editar_documento((storage.foldername(p_nombre))[1])
      or exists (select 1 from public.documentos d
                 where d.ruta = p_nombre and d.vigente and seguridad.puede_ver_documento(d.tipo));
$$;

-- Quien solo ve: únicamente el archivo de la versión vigente. Quien publica: todas las versiones.
create policy documentos_leer on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and seguridad.puede_leer_archivo_documento(name));
create policy documentos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and seguridad.puede_editar_documento((storage.foldername(name))[1]));

-- Registra como vigente un PDF ya subido al bucket por el mismo usuario.
create or replace function public.registrar_documento(p_tipo text, p_ruta text, p_nombre text, p_titulo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx       record;
  v_tamano  bigint;
  v_mime    text;
  v_limite  bigint;
  v_version int;
  v_id      uuid;
  v_nombre  text := btrim(coalesce(p_nombre, ''));
  v_titulo  text := btrim(coalesce(p_titulo, ''));
begin
  select * into ctx from seguridad.contexto() c where c.activo;
  if not found or not seguridad.puede_editar_documento(p_tipo) then
    raise exception 'No tienes permiso para publicar este documento' using errcode = '42501';
  end if;
  if exists (select 1 from public.perfiles where id = ctx.usuario_id and debe_cambiar_password) then
    raise exception 'Debes cambiar tu contraseña antes de continuar' using errcode = '42501';
  end if;
  if p_ruta is null or p_ruta !~ ('^' || p_tipo || '/[0-9a-f-]{36}\.pdf$') then
    raise exception 'Ruta de archivo no válida' using errcode = '22023';
  end if;
  if length(v_nombre) not between 1 and 200 or length(v_titulo) not between 1 and 120 then
    raise exception 'Indica el título y el nombre del archivo' using errcode = '22023';
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_tamano, v_mime
  from storage.objects o
  where o.bucket_id = 'documentos' and o.name = p_ruta and o.owner_id = ctx.usuario_id::text;
  if v_tamano is null then
    raise exception 'El archivo no se encontró. Vuelve a subirlo.' using errcode = '22023';
  end if;
  v_limite := case when p_tipo like 'menu_%'
                   then seguridad.config_entero('archivos.pdf_menu_max_bytes', 1048576)
                   else seguridad.config_entero('archivos.documento_max_bytes', 10485760) end;
  if v_tamano > v_limite or v_mime is distinct from 'application/pdf' then
    raise exception 'El archivo debe ser un PDF de hasta % KB', v_limite / 1024 using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('documentos:' || p_tipo));
  select coalesce(max(version), 0) + 1 into v_version from public.documentos where tipo = p_tipo;
  update public.documentos set vigente = false where tipo = p_tipo and vigente;
  insert into public.documentos (tipo, version, titulo, nombre_archivo, ruta, tamano, created_by)
  values (p_tipo, v_version, v_titulo, v_nombre, p_ruta, v_tamano, ctx.usuario_id)
  returning id into v_id;

  insert into public.auditoria (usuario_id, modulo, accion, entidad, entidad_id, detalle)
  values (ctx.usuario_id, 'documentos', 'publicar_documento', 'documentos', v_id::text,
          jsonb_build_object('tipo', p_tipo, 'version', v_version, 'archivo', v_nombre, 'tamano', v_tamano));
  return v_id;
end;
$$;

-- Vuelve a publicar una versión anterior.
create or replace function public.restaurar_documento(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.documentos;
begin
  select * into d from public.documentos where id = p_id;
  if not found or not seguridad.puede_editar_documento(d.tipo)
     or exists (select 1 from public.perfiles where id = auth.uid() and debe_cambiar_password) then
    raise exception 'No tienes permiso para publicar este documento' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('documentos:' || d.tipo));
  update public.documentos set vigente = false where tipo = d.tipo and vigente and id <> d.id;
  update public.documentos set vigente = true where id = d.id;
  insert into public.auditoria (usuario_id, modulo, accion, entidad, entidad_id, detalle)
  values (auth.uid(), 'documentos', 'restaurar_documento', 'documentos', d.id::text,
          jsonb_build_object('tipo', d.tipo, 'version', d.version));
end;
$$;

-- ---------------------------------------------------------------------------
-- Alertas post-login
-- ---------------------------------------------------------------------------
create table public.alertas (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null check (length(btrim(titulo)) between 1 and 120),
  contenido   text not null check (length(btrim(contenido)) between 1 and 4000),
  desde       timestamptz not null,
  hasta       timestamptz not null,
  roles       text[] not null check (cardinality(roles) between 1 and 20),
  una_vez     boolean not null default true,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  constraint alertas_rango_ck check (hasta > desde)
);
create index on public.alertas (activo, desde, hasta);

create table public.alertas_vistas (
  alerta_id   uuid not null references public.alertas(id) on delete cascade,
  usuario_id  uuid not null,
  sesion      text not null default '',
  visto_en    timestamptz not null default now(),
  primary key (alerta_id, usuario_id, sesion)
);

create or replace function seguridad.trg_alertas_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(new.roles) r where not exists (select 1 from public.roles x where x.codigo = r)) then
    raise exception 'Hay un rol que no existe' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger alertas_roles before insert or update on public.alertas
  for each row execute function seguridad.trg_alertas_roles();
create trigger alertas_updated_at before update on public.alertas
  for each row execute function seguridad.trg_updated_at();
create trigger alertas_auditoria after insert or update or delete on public.alertas
  for each row execute function seguridad.trg_auditoria('alertas');

alter table public.alertas enable row level security;
alter table public.alertas_vistas enable row level security;
revoke all on public.alertas, public.alertas_vistas from anon;
revoke delete, truncate, references, trigger on public.alertas from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.alertas_vistas from authenticated;
grant select, insert, update on public.alertas to authenticated;
grant select on public.alertas_vistas to authenticated;
create policy alertas_leer on public.alertas for select to authenticated
  using ((select seguridad.tiene_permiso('admin.alertas', 'ver')));
create policy alertas_crear on public.alertas for insert to authenticated
  with check ((select seguridad.tiene_permiso('admin.alertas', 'editar')));
create policy alertas_editar on public.alertas for update to authenticated
  using ((select seguridad.tiene_permiso('admin.alertas', 'editar')))
  with check ((select seguridad.tiene_permiso('admin.alertas', 'editar')));
create policy alertas_vistas_leer on public.alertas_vistas for select to authenticated
  using ((select seguridad.tiene_permiso('admin.alertas', 'ver')));

-- Alertas que el usuario debe ver ahora. "Cada login" se controla con el id de la sesión de Supabase Auth.
create or replace function public.mis_alertas()
returns table (id uuid, titulo text, contenido text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.titulo, a.contenido
  from public.alertas a
  cross join seguridad.contexto() c
  where c.activo
    and a.activo
    and now() >= a.desde and now() < a.hasta
    and c.rol_codigo = any (a.roles)
    and not exists (
      select 1 from public.alertas_vistas v
      where v.alerta_id = a.id and v.usuario_id = c.usuario_id
        and (a.una_vez or v.sesion = coalesce(auth.jwt() ->> 'session_id', ''))
    )
  order by a.desde, a.created_at
  limit 5;
$$;

create or replace function public.marcar_alertas_vistas(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_ids is null or cardinality(p_ids) > 20 then
    return;
  end if;
  insert into public.alertas_vistas (alerta_id, usuario_id, sesion)
  select m.id, auth.uid(), coalesce(auth.jwt() ->> 'session_id', '')
  from public.mis_alertas() m
  where m.id = any (p_ids)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Contáctanos
-- ---------------------------------------------------------------------------
alter table public.correos_pendientes
  add column adjuntos jsonb not null default '[]' check (jsonb_typeof(adjuntos) = 'array'),
  add column responder_a text check (responder_a is null or length(responder_a) <= 254);

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

-- La plantilla muestra quién va en copia.
update public.plantillas_correo
set html = '<p>Mensaje enviado desde el Portal de Raciones por <strong>{{usuario}}</strong> ({{correo_usuario}}) de <strong>{{empresa}}</strong> (RUC {{ruc}}):</p>
<p style="font-size:12px;color:#5C5E4E">Con copia a: {{cc}}</p>
<div style="white-space:pre-wrap;border-left:4px solid #F58634;padding:8px 12px;background:#E8E9E4">{{mensaje}}</div>
<p style="font-size:12px;color:#5C5E4E">Para responder, use «Responder»: la respuesta llega a {{correo_usuario}}.</p>',
    texto = 'Mensaje enviado desde el Portal de Raciones por {{usuario}} ({{correo_usuario}}) de {{empresa}} (RUC {{ruc}}):
Con copia a: {{cc}}

{{mensaje}}

Para responder, use «Responder»: la respuesta llega a {{correo_usuario}}.',
    variables = array['asunto', 'usuario', 'correo_usuario', 'empresa', 'ruc', 'mensaje', 'cc']
where codigo = 'contacto';

-- Un correo que se interrumpió muchas veces "en proceso" queda como fallido (no se reintenta sin fin).
create or replace function public.correos_tomar_lote(p_limite int default 20)
returns setof public.correos_pendientes
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.correos_pendientes
  set estado = 'fallido', ultimo_error = 'El envío se interrumpió varias veces'
  where estado = 'procesando' and procesado_en < now() - interval '10 minutes' and intentos >= 6;

  return query
  update public.correos_pendientes c
  set estado = 'procesando', intentos = c.intentos + 1, procesado_en = now()
  where c.id in (
    select x.id from public.correos_pendientes x
    where (x.estado = 'pendiente' and x.proximo_intento <= now())
       or (x.estado = 'procesando' and x.procesado_en < now() - interval '10 minutes')
    order by x.proximo_intento
    limit least(greatest(p_limite, 1), 100)
    for update skip locked
  )
  returning c.*;
end;
$$;

-- El disparo de cada minuto también llama a la función una vez por hora si hay archivos huérfanos que limpiar.
create or replace function seguridad.disparar_envio_correos()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url      text;
  v_secreto  text;
begin
  if not exists (
    select 1 from public.correos_pendientes
    where (estado = 'pendiente' and proximo_intento <= now())
       or (estado = 'procesando' and procesado_en < now() - interval '10 minutes')
  ) and not (extract(minute from now()) = 7 and exists (select 1 from public.archivos_huerfanos(1))) then
    return;
  end if;

  execute $q$
    select (select decrypted_secret from vault.decrypted_secrets where name = 'correos_url'),
           (select decrypted_secret from vault.decrypted_secrets where name = 'correos_cron_secreto')
  $q$ into v_url, v_secreto;
  if v_url is null or v_secreto is null then
    return;
  end if;

  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 55000)'
  using v_url, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'x-cron-secreto', v_secreto);
exception when undefined_table or invalid_schema_name or undefined_function then
  return;
end;
$$;

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

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.registrar_documento(text, text, text, text) from public, anon;
revoke execute on function public.restaurar_documento(uuid) from public, anon;
revoke execute on function public.mis_alertas() from public, anon;
revoke execute on function public.marcar_alertas_vistas(uuid[]) from public, anon;
revoke execute on function public.enviar_contacto(text[], text, text, jsonb, uuid) from public, anon;
grant execute on function public.registrar_documento(text, text, text, text) to authenticated;
grant execute on function public.restaurar_documento(uuid) to authenticated;
grant execute on function public.mis_alertas() to authenticated;
grant execute on function public.marcar_alertas_vistas(uuid[]) to authenticated;
grant execute on function public.enviar_contacto(text[], text, text, jsonb, uuid) to authenticated;
revoke execute on function public.archivos_huerfanos(int) from public, anon, authenticated;
grant execute on function public.archivos_huerfanos(int) to service_role;
revoke execute on function public.correos_tomar_lote(int) from public, anon, authenticated;
grant execute on function public.correos_tomar_lote(int) to service_role;

revoke execute on all functions in schema seguridad from public, anon;
grant execute on all functions in schema seguridad to authenticated, service_role;
revoke execute on function seguridad.mover_saldo(uuid, date, uuid, uuid, uuid, int) from authenticated;
revoke execute on function seguridad.encolar_correo(text, jsonb, text[], uuid, uuid, boolean) from authenticated;
revoke execute on function seguridad.disparar_envio_correos() from authenticated;
