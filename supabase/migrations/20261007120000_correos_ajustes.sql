-- =============================================================================
-- Kuntur Wasi · Fase 3: ajustes de la revisión de seguridad de correos.
-- =============================================================================

-- 1) Encolar nunca debe romper la operación principal (empresa inexistente → sin datos extra).
create or replace function seguridad.encolar_correo(
  p_plantilla          text,
  p_datos              jsonb,
  p_para               text[],
  p_empresa_id         uuid default null,
  p_envio_id           uuid default null,
  p_incluir_contactos  boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_cco    text;
  v_datos  jsonb := coalesce(p_datos, '{}'::jsonb);
begin
  if not exists (select 1 from public.plantillas_correo where codigo = p_plantilla and activo) then
    return null;
  end if;
  if p_empresa_id is not null and not exists (select 1 from public.empresas where id = p_empresa_id) then
    p_empresa_id := null;
  end if;

  if not v_datos ? 'fecha_envio' then
    v_datos := v_datos || jsonb_build_object(
      'fecha_envio', to_char(now() at time zone seguridad.zona_horaria(), 'DD/MM/YYYY HH24:MI'));
  end if;
  if p_empresa_id is not null and not (v_datos ? 'empresa') then
    v_datos := v_datos || coalesce((
      select jsonb_build_object('empresa', e.razon_social, 'ruc', e.ruc)
      from public.empresas e where e.id = p_empresa_id
    ), '{}'::jsonb);
  end if;

  insert into public.correos_pendientes (plantilla, datos, empresa_id, envio_id)
  values (p_plantilla, v_datos, p_empresa_id, p_envio_id)
  returning id into v_id;

  insert into public.correo_destinatarios (correo_id, correo, tipo, estado)
  select v_id, d.correo, d.tipo,
         case when exists (select 1 from public.correos_suprimidos s where s.correo = d.correo)
              then 'suprimido' else 'pendiente' end
  from (
    select distinct on (correo) correo, tipo
    from (
      select lower(btrim(x)) as correo, 'para'::text as tipo, 1 as orden, o as sub
      from unnest(coalesce(p_para, '{}'::text[])) with ordinality as t(x, o)
      union all
      select c.correo, 'cc', 2, row_number() over (order by c.created_at)
      from (
        select lower(btrim(ec.correo)) as correo, min(ec.created_at) as created_at
        from public.empresa_contactos ec
        where p_incluir_contactos and ec.empresa_id = p_empresa_id and ec.activo and ec.recibe_notificaciones
        group by lower(btrim(ec.correo))
        order by min(ec.created_at)
        limit 5
      ) c
    ) todos
    where correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(correo) <= 254
    order by correo, orden, sub
  ) d;

  v_cco := lower(btrim(coalesce((select c.valor #>> '{}' from public.configuracion c where c.clave = 'correo.cco_interno'), '')));
  if v_cco ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    insert into public.correo_destinatarios (correo_id, correo, tipo)
    values (v_id, v_cco, 'cco')
    on conflict (correo_id, correo) do nothing;
  end if;

  if not exists (select 1 from public.correo_destinatarios where correo_id = v_id and estado = 'pendiente' and tipo <> 'cco') then
    update public.correos_pendientes
    set estado = 'fallido', ultimo_error = 'Sin destinatarios válidos', procesado_en = now()
    where id = v_id;
  end if;
  return v_id;
end;
$$;

-- 2) Un empresa_id mal formado en app_metadata no impide crear el usuario.
create or replace function seguridad.trg_correo_cuenta_creada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta     jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_empresa  uuid;
begin
  if coalesce(v_meta ->> 'rol_codigo', '') = '' or coalesce(v_meta ->> 'sin_correo', '') = 'true' or new.email is null then
    return new;
  end if;
  if (v_meta ->> 'empresa_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_empresa := (v_meta ->> 'empresa_id')::uuid;
  end if;
  perform seguridad.encolar_correo(
    case when v_meta ? 'solicitud_id' then 'registro_aprobado' else 'usuario_creado' end,
    jsonb_build_object(
      'usuario', coalesce(nullif(btrim(v_meta ->> 'nombre'), ''), split_part(new.email, '@', 1)),
      'correo_usuario', lower(new.email)
    ),
    array[lower(new.email)],
    v_empresa
  );
  return new;
end;
$$;

-- 3) Solo se reenvía un correo que ya terminó (no uno en cola o enviándose).
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

  insert into public.correos_pendientes (plantilla, datos, empresa_id, envio_id, reenvio_de)
  values (c.plantilla, c.datos, c.empresa_id, c.envio_id, c.id)
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

-- 4) La configuración de correo (remitente, copia oculta, modo) solo la cambia el Superadmin.
create or replace function seguridad.trg_config_correo_superadmin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.clave like 'correo.%' and auth.uid() is not null and not seguridad.es_superadmin() then
    raise exception 'Solo el Superadmin puede cambiar la configuración de correos' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger configuracion_correo_superadmin before insert or update on public.configuracion
  for each row execute function seguridad.trg_config_correo_superadmin();

-- 5) El aviso de registro (formulario público) no repite textos escritos por quien se registra:
--    evita que alguien use el formulario para mandar mensajes a terceros desde nuestro dominio.
update public.plantillas_correo
set asunto = 'Recibimos una solicitud de registro en el Portal de Raciones',
    html = '<p>Hola:</p>
<p>Recibimos una solicitud de registro en el Portal de Raciones de Kuntur Wasi para el RUC <strong>{{ruc}}</strong>, con este correo como usuario.</p>
<p>La revisaremos y te escribiremos a este correo cuando sea aprobada.</p>
<p>Si no hiciste esta solicitud, ignora este mensaje o escríbenos a {{correo_contacto}}.</p>
<p>Saludos cordiales<br>Equipo de Facturación</p>',
    texto = 'Hola:

Recibimos una solicitud de registro en el Portal de Raciones de Kuntur Wasi para el RUC {{ruc}}, con este correo como usuario.
La revisaremos y te escribiremos a este correo cuando sea aprobada.

Si no hiciste esta solicitud, ignora este mensaje o escríbenos a {{correo_contacto}}.

Saludos cordiales
Equipo de Facturación',
    variables = array['ruc','correo_contacto']
where codigo = 'registro_recibido';

create or replace function seguridad.trg_correo_registro_recibido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform seguridad.encolar_correo('registro_recibido', jsonb_build_object('ruc', new.ruc), array[new.usuario_correo]);
  return new;
end;
$$;

revoke execute on all functions in schema seguridad from public, anon;
grant execute on all functions in schema seguridad to authenticated, service_role;
revoke execute on function seguridad.encolar_correo(text, jsonb, text[], uuid, uuid, boolean) from authenticated;
revoke execute on function seguridad.disparar_envio_correos() from authenticated;
