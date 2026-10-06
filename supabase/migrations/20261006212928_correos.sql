-- =============================================================================
-- Kuntur Wasi · Fase 3: correos (patrón outbox).
--
-- Cada acción que debe notificar llama a seguridad.encolar_correo() DENTRO de
-- su misma transacción: si los datos se guardan, el correo queda en cola; si
-- algo falla, no queda ninguno. La Edge Function "enviar-correos" (cada minuto,
-- con Supabase Cron) toma la cola, arma el correo con la plantilla y lo envía
-- por Amazon SES, con reintentos. Los eventos de SES (entregado, rebote, queja)
-- llegan a la app y actualizan el estado de cada destinatario.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Plantillas (editables por el Superadmin)
-- ---------------------------------------------------------------------------
create table public.plantillas_correo (
  codigo       text primary key check (codigo ~ '^[a-z][a-z0-9_]{1,60}$'),
  nombre       text not null,
  asunto       text not null check (length(asunto) between 1 and 300),
  html         text not null check (length(html) <= 50000),
  texto        text not null check (length(texto) <= 50000),
  -- Columnas de {{tabla_registros}}: [{"clave": "fecha", "titulo": "Fecha"}, …]
  columnas     jsonb not null default '[]' check (jsonb_typeof(columnas) = 'array'),
  -- Variables disponibles (solo informativo para quien edita).
  variables    text[] not null default '{}',
  activo       boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid()
);
create trigger plantillas_correo_updated_at before update on public.plantillas_correo
  for each row execute function seguridad.trg_updated_at();
create trigger plantillas_correo_auditoria after insert or update or delete on public.plantillas_correo
  for each row execute function seguridad.trg_auditoria('correos');

-- ---------------------------------------------------------------------------
-- Cola de correos y estado por destinatario
-- ---------------------------------------------------------------------------
create table public.correos_pendientes (
  id               uuid primary key default gen_random_uuid(),
  plantilla        text not null references public.plantillas_correo(codigo),
  datos            jsonb not null default '{}' check (jsonb_typeof(datos) = 'object'),
  empresa_id       uuid references public.empresas(id),
  envio_id         uuid,                       -- envío de raciones / refrigerios relacionado (Fase 4+)
  reenvio_de       uuid references public.correos_pendientes(id),
  estado           text not null default 'pendiente'
                     check (estado in ('pendiente', 'procesando', 'enviado', 'registrado', 'parcial', 'fallido')),
  intentos         int not null default 0,
  proximo_intento  timestamptz not null default now(),
  ultimo_error     text,
  asunto_final     text,
  html_final       text,
  texto_final      text,
  creado_por       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  procesado_en     timestamptz
);
create index on public.correos_pendientes (estado, proximo_intento);
create index on public.correos_pendientes (created_at desc);
create index on public.correos_pendientes (empresa_id, created_at desc);
create index on public.correos_pendientes (envio_id);

create table public.correo_destinatarios (
  id              uuid primary key default gen_random_uuid(),
  correo_id       uuid not null references public.correos_pendientes(id) on delete cascade,
  correo          text not null check (correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(correo) <= 254),
  tipo            text not null check (tipo in ('para', 'cc', 'cco')),
  estado          text not null default 'pendiente'
                    check (estado in ('pendiente', 'enviado', 'registrado', 'entregado', 'rebotado', 'queja', 'fallido', 'suprimido')),
  ses_message_id  text,
  detalle         text,
  actualizado_en  timestamptz not null default now(),
  unique (correo_id, correo)
);
create index on public.correo_destinatarios (lower(correo));
create index on public.correo_destinatarios (ses_message_id) where ses_message_id is not null;

-- Direcciones que rebotaron (rebote permanente) o marcaron spam: no se les vuelve a escribir.
create table public.correos_suprimidos (
  correo      text primary key check (correo = lower(correo)),
  motivo      text not null check (motivo in ('rebote', 'queja', 'manual')),
  detalle     text,
  created_at  timestamptz not null default now()
);
create trigger correos_suprimidos_auditoria after insert or update or delete on public.correos_suprimidos
  for each row execute function seguridad.trg_auditoria('correos');

-- ---------------------------------------------------------------------------
-- Seguridad: solo lectura con permiso; las escrituras van por funciones.
-- ---------------------------------------------------------------------------
alter table public.plantillas_correo enable row level security;
alter table public.correos_pendientes enable row level security;
alter table public.correo_destinatarios enable row level security;
alter table public.correos_suprimidos enable row level security;

revoke all on public.plantillas_correo, public.correos_pendientes, public.correo_destinatarios, public.correos_suprimidos from anon;
revoke insert, update, delete, truncate on public.correos_pendientes, public.correo_destinatarios from authenticated;
revoke insert, delete, truncate on public.plantillas_correo from authenticated;
revoke insert, update, truncate on public.correos_suprimidos from authenticated;
grant select on public.plantillas_correo, public.correos_pendientes, public.correo_destinatarios, public.correos_suprimidos to authenticated;
-- Solo estas columnas de las plantillas se editan desde la app.
revoke update on public.plantillas_correo from authenticated;
grant update (asunto, html, texto, activo) on public.plantillas_correo to authenticated;
grant delete on public.correos_suprimidos to authenticated;

create policy plantillas_leer on public.plantillas_correo for select to authenticated
  using ((select seguridad.tiene_permiso('admin.correos', 'ver')));
create policy plantillas_editar on public.plantillas_correo for update to authenticated
  using ((select seguridad.es_superadmin()))
  with check ((select seguridad.es_superadmin()));

create policy correos_leer on public.correos_pendientes for select to authenticated
  using ((select seguridad.tiene_permiso('admin.correos', 'ver')) and (select seguridad.mi_alcance()) = 'todas');
create policy destinatarios_leer on public.correo_destinatarios for select to authenticated
  using ((select seguridad.tiene_permiso('admin.correos', 'ver')) and (select seguridad.mi_alcance()) = 'todas');
create policy suprimidos_leer on public.correos_suprimidos for select to authenticated
  using ((select seguridad.tiene_permiso('admin.correos', 'ver')) and (select seguridad.mi_alcance()) = 'todas');
-- Quitar una dirección de la lista (por ejemplo, después de corregir el buzón): solo Superadmin.
create policy suprimidos_borrar on public.correos_suprimidos for delete to authenticated
  using ((select seguridad.es_superadmin()));

-- ---------------------------------------------------------------------------
-- Encolar un correo. La usan las demás funciones del sistema (misma transacción).
--   p_para:               destinatarios principales
--   p_incluir_contactos:  suma los contactos de la empresa que reciben notificaciones (máx. 5)
-- Siempre agrega la copia oculta interna configurada (correo.cco_interno).
-- ---------------------------------------------------------------------------
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
    -- Plantilla desactivada: no se envía (y no se interrumpe la operación).
    return null;
  end if;

  -- Fecha de envío en la zona oficial, como en los correos actuales.
  if not v_datos ? 'fecha_envio' then
    v_datos := v_datos || jsonb_build_object(
      'fecha_envio', to_char(now() at time zone seguridad.zona_horaria(), 'DD/MM/YYYY HH24:MI'));
  end if;
  if p_empresa_id is not null and not (v_datos ? 'empresa') then
    v_datos := v_datos || (
      select jsonb_build_object('empresa', e.razon_social, 'ruc', e.ruc)
      from public.empresas e where e.id = p_empresa_id
    );
  end if;

  insert into public.correos_pendientes (plantilla, datos, empresa_id, envio_id)
  values (p_plantilla, v_datos, p_empresa_id, p_envio_id)
  returning id into v_id;

  -- Destinatarios (sin duplicados; el primero que aparece define el tipo).
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
    where correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    order by correo, orden, sub
  ) d;

  v_cco := lower(btrim(coalesce((select c.valor #>> '{}' from public.configuracion c where c.clave = 'correo.cco_interno'), '')));
  if v_cco ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    insert into public.correo_destinatarios (correo_id, correo, tipo)
    values (v_id, v_cco, 'cco')
    on conflict (correo_id, correo) do nothing;
  end if;

  -- Sin ningún destinatario principal utilizable (la copia oculta sola no cuenta), queda como fallido.
  if not exists (select 1 from public.correo_destinatarios where correo_id = v_id and estado = 'pendiente' and tipo <> 'cco') then
    update public.correos_pendientes
    set estado = 'fallido', ultimo_error = 'Sin destinatarios válidos', procesado_en = now()
    where id = v_id;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Para la Edge Function (solo service_role): toma un lote para enviar.
-- FOR UPDATE SKIP LOCKED evita que dos ejecuciones envíen el mismo correo.
-- También recupera los que quedaron "procesando" más de 10 minutos.
-- ---------------------------------------------------------------------------
create or replace function public.correos_tomar_lote(p_limite int default 20)
returns setof public.correos_pendientes
language plpgsql
security definer
set search_path = ''
as $$
begin
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

-- Verifica el secreto con el que Supabase Cron llama a la Edge Function.
-- El secreto vive solo en Supabase Vault (nombre: correos_cron_secreto).
create or replace function public.correos_verificar_secreto(p_secreto text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  execute 'select coalesce((select decrypted_secret = $1 from vault.decrypted_secrets where name = ''correos_cron_secreto''), false)'
    into v_ok using p_secreto;
  return coalesce(v_ok, false) and length(coalesce(p_secreto, '')) >= 32;
exception when undefined_table or invalid_schema_name then
  return false;
end;
$$;

revoke execute on function public.correos_tomar_lote(int) from public, anon, authenticated;
revoke execute on function public.correos_verificar_secreto(text) from public, anon, authenticated;
grant execute on function public.correos_tomar_lote(int) to service_role;
grant execute on function public.correos_verificar_secreto(text) to service_role;

-- ---------------------------------------------------------------------------
-- Reenviar un correo del historial (mismo contenido y destinatarios).
-- ---------------------------------------------------------------------------
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
revoke execute on function public.reenviar_correo(uuid) from public, anon;
grant execute on function public.reenviar_correo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Configuración nueva
-- ---------------------------------------------------------------------------
insert into public.configuracion (clave, valor, descripcion, publica) values
  ('correo.modo', '"registrar"',
   'registrar = solo guarda el correo sin enviarlo (pruebas) · enviar = lo envía por Amazon SES', false),
  ('app.url', '"http://localhost:3000"', 'Dirección pública de la app (para los enlaces de los correos)', false)
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- Plantillas iniciales (las 4 del Word + las nuevas)
-- ---------------------------------------------------------------------------
insert into public.plantillas_correo (codigo, nombre, asunto, html, texto, columnas, variables) values
(
  'programacion_raciones', 'Programación de raciones',
  'Detalle de Programación de Raciones - {{ruc}}',
  '<p>Estimada empresa<br><strong>{{empresa}}</strong></p>
<p>Se ha registrado la siguiente solicitud</p>
{{tabla_registros}}
{{pie_facturacion}}',
  'Estimada empresa
{{empresa}}

Se ha registrado la siguiente solicitud

{{tabla_registros}}

{{pie_facturacion}}',
  '[{"clave":"fecha","titulo":"Fecha"},{"clave":"proyecto","titulo":"Proyecto"},{"clave":"area","titulo":"Área"},{"clave":"frente","titulo":"Frente Trabajo"},{"clave":"comedor","titulo":"Comedor"},{"clave":"servicio","titulo":"Servicio"},{"clave":"cantidad","titulo":"Cantidad"}]',
  array['empresa','ruc','usuario','fecha_envio','tabla_registros']
),
(
  'adicion_reduccion_raciones', 'Adición / reducción de raciones',
  'Detalle de Adición/Reducción de Raciones - {{ruc}}',
  '<p>Estimada empresa<br><strong>{{empresa}}</strong></p>
<p>Se ha registrado la siguiente solicitud de acuerdo con lo previamente acordado</p>
{{tabla_registros}}
{{pie_facturacion}}',
  'Estimada empresa
{{empresa}}

Se ha registrado la siguiente solicitud de acuerdo con lo previamente acordado

{{tabla_registros}}

{{pie_facturacion}}',
  '[{"clave":"fecha","titulo":"Fecha"},{"clave":"proyecto","titulo":"Proyecto"},{"clave":"area","titulo":"Área"},{"clave":"frente","titulo":"Frente Trabajo"},{"clave":"comedor","titulo":"Comedor"},{"clave":"servicio","titulo":"Servicio"},{"clave":"cantidad","titulo":"Cantidad"}]',
  array['empresa','ruc','usuario','fecha_envio','tabla_registros']
),
(
  'traslado_raciones', 'Traslado de raciones',
  'Detalle de Traslado de Raciones - {{ruc}}',
  '<p>Estimada empresa<br><strong>{{empresa}}</strong></p>
<p>Se ha registrado la siguiente solicitud</p>
{{tabla_registros}}
{{pie_facturacion}}',
  'Estimada empresa
{{empresa}}

Se ha registrado la siguiente solicitud

{{tabla_registros}}

{{pie_facturacion}}',
  '[{"clave":"fecha","titulo":"Fecha"},{"clave":"proyecto","titulo":"Proyecto"},{"clave":"area","titulo":"Área"},{"clave":"frente","titulo":"Frente Trabajo"},{"clave":"comedor","titulo":"Comedor"},{"clave":"servicio","titulo":"Servicio"},{"clave":"cantidad","titulo":"Cantidad"}]',
  array['empresa','ruc','usuario','fecha_envio','tabla_registros']
),
(
  'solicitud_refrigerios', 'Solicitud de refrigerios',
  'Detalle de Solicitud de Refrigerios - {{ruc}}',
  '<p>Estimada empresa<br><strong>{{empresa}}</strong></p>
<p>Se ha registrado la siguiente solicitud</p>
{{tabla_registros}}
{{pie_facturacion}}',
  'Estimada empresa
{{empresa}}

Se ha registrado la siguiente solicitud

{{tabla_registros}}

{{pie_facturacion}}',
  '[{"clave":"fecha","titulo":"Fecha"},{"clave":"comedor","titulo":"Comedor"},{"clave":"turno","titulo":"Turno Entrega"},{"clave":"composicion","titulo":"Composición"},{"clave":"cantidad","titulo":"Cant."},{"clave":"precio","titulo":"Precio sin IGV"},{"clave":"tipo","titulo":"Tipo"},{"clave":"encargado","titulo":"Encargado"}]',
  array['empresa','ruc','usuario','fecha_envio','tabla_registros']
),
(
  'registro_recibido', 'Registro recibido',
  'Recibimos tu solicitud de registro - {{ruc}}',
  '<p>Hola {{usuario}}:</p>
<p>Recibimos la solicitud de registro de <strong>{{empresa}}</strong> (RUC {{ruc}}) en el Portal de Raciones.</p>
<p>La revisaremos y te escribiremos a este correo cuando sea aprobada.</p>
<p>Si no hiciste esta solicitud, escríbenos a {{correo_contacto}}.</p>
<p>Saludos cordiales<br>Equipo de Facturación</p>',
  'Hola {{usuario}}:

Recibimos la solicitud de registro de {{empresa}} (RUC {{ruc}}) en el Portal de Raciones.
La revisaremos y te escribiremos a este correo cuando sea aprobada.

Si no hiciste esta solicitud, escríbenos a {{correo_contacto}}.

Saludos cordiales
Equipo de Facturación',
  '[]', array['usuario','empresa','ruc','correo_contacto']
),
(
  'registro_aprobado', 'Registro aprobado',
  'Tu registro fue aprobado - Portal de Raciones Kuntur Wasi',
  '<p>Hola {{usuario}}:</p>
<p>La solicitud de registro de <strong>{{empresa}}</strong> fue <strong>aprobada</strong>.</p>
<p>Tu usuario es <strong>{{correo_usuario}}</strong>. Para crear tu contraseña, entra a
<a href="{{url_app}}/olvide-password">{{url_app}}/olvide-password</a>, escribe tu correo y sigue el enlace que te enviaremos.</p>
<p>Saludos cordiales<br>Equipo de Facturación</p>',
  'Hola {{usuario}}:

La solicitud de registro de {{empresa}} fue aprobada.

Tu usuario es {{correo_usuario}}. Para crear tu contraseña, entra a {{url_app}}/olvide-password, escribe tu correo y sigue el enlace que te enviaremos.

Saludos cordiales
Equipo de Facturación',
  '[]', array['usuario','empresa','correo_usuario','url_app']
),
(
  'registro_rechazado', 'Registro rechazado',
  'Tu solicitud de registro no fue aprobada - {{ruc}}',
  '<p>Hola {{usuario}}:</p>
<p>La solicitud de registro de <strong>{{empresa}}</strong> (RUC {{ruc}}) no fue aprobada por el siguiente motivo:</p>
<blockquote style="border-left:4px solid #F58634;margin:0;padding:8px 12px;background:#E8E9E4">{{motivo}}</blockquote>
<p>Si crees que es un error, escríbenos a {{correo_contacto}}.</p>
<p>Saludos cordiales<br>Equipo de Facturación</p>',
  'Hola {{usuario}}:

La solicitud de registro de {{empresa}} (RUC {{ruc}}) no fue aprobada por el siguiente motivo:

{{motivo}}

Si crees que es un error, escríbenos a {{correo_contacto}}.

Saludos cordiales
Equipo de Facturación',
  '[]', array['usuario','empresa','ruc','motivo','correo_contacto']
),
(
  'usuario_creado', 'Cuenta creada',
  'Tu cuenta en el Portal de Raciones Kuntur Wasi',
  '<p>Hola {{usuario}}:</p>
<p>Se creó tu cuenta en el Portal de Raciones de Kuntur Wasi. Tu usuario es <strong>{{correo_usuario}}</strong>.</p>
<p>Para crear tu contraseña, entra a <a href="{{url_app}}/olvide-password">{{url_app}}/olvide-password</a>,
escribe tu correo y sigue el enlace que te enviaremos. Si el administrador te dio una contraseña temporal, también puedes usarla:
el sistema te pedirá cambiarla al ingresar.</p>
<p>Saludos cordiales<br>Equipo de Facturación</p>',
  'Hola {{usuario}}:

Se creó tu cuenta en el Portal de Raciones de Kuntur Wasi. Tu usuario es {{correo_usuario}}.

Para crear tu contraseña, entra a {{url_app}}/olvide-password, escribe tu correo y sigue el enlace que te enviaremos.
Si el administrador te dio una contraseña temporal, también puedes usarla: el sistema te pedirá cambiarla al ingresar.

Saludos cordiales
Equipo de Facturación',
  '[]', array['usuario','correo_usuario','url_app']
),
(
  'contacto', 'Mensaje de Contáctanos',
  '{{asunto}}',
  '<p>Mensaje enviado desde el Portal de Raciones por <strong>{{usuario}}</strong> ({{correo_usuario}}) de <strong>{{empresa}}</strong> (RUC {{ruc}}):</p>
<div style="white-space:pre-wrap;border-left:4px solid #F58634;padding:8px 12px;background:#E8E9E4">{{mensaje}}</div>',
  'Mensaje enviado desde el Portal de Raciones por {{usuario}} ({{correo_usuario}}) de {{empresa}} (RUC {{ruc}}):

{{mensaje}}',
  '[]', array['asunto','usuario','correo_usuario','empresa','ruc','mensaje']
);

-- ---------------------------------------------------------------------------
-- Correos automáticos del registro y de la creación de cuentas
-- ---------------------------------------------------------------------------

-- Registro recibido: al guardar la solicitud.
create or replace function seguridad.trg_correo_registro_recibido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform seguridad.encolar_correo(
    'registro_recibido',
    jsonb_build_object('usuario', new.usuario_nombre, 'empresa', new.razon_social, 'ruc', new.ruc),
    array[new.usuario_correo]
  );
  return new;
end;
$$;
create trigger solicitudes_registro_correo after insert on public.solicitudes_registro
  for each row execute function seguridad.trg_correo_registro_recibido();

-- Cuenta creada: al crear el usuario en Auth con un rol asignado.
-- Si viene de una solicitud aprobada, se usa la plantilla "registro_aprobado".
create or replace function seguridad.trg_correo_cuenta_creada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta     jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_empresa  uuid := nullif(v_meta ->> 'empresa_id', '')::uuid;
begin
  if coalesce(v_meta ->> 'rol_codigo', '') = '' or coalesce(v_meta ->> 'sin_correo', '') = 'true' or new.email is null then
    return new;
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
-- El nombre hace que se ejecute después de en_nuevo_usuario (orden alfabético).
create trigger en_nuevo_usuario_correo after insert on auth.users
  for each row execute function seguridad.trg_correo_cuenta_creada();

-- Rechazo: se agrega el correo a la función existente (misma transacción).
create or replace function public.rechazar_solicitud(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.solicitudes_registro;
begin
  if not (seguridad.tiene_permiso('maestras.solicitudes', 'aprobar') and seguridad.mi_alcance() = 'todas') then
    raise exception 'No tienes permiso para rechazar solicitudes' using errcode = '42501';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) not between 5 and 500 then
    raise exception 'Indica un motivo (5 a 500 caracteres)' using errcode = '22023';
  end if;
  update public.solicitudes_registro
  set estado = 'rechazada', motivo_rechazo = btrim(p_motivo), revisado_por = auth.uid(), revisado_en = now()
  where id = p_id and estado = 'pendiente'
  returning * into s;
  if not found then
    raise exception 'La solicitud no existe o ya fue revisada' using errcode = '22023';
  end if;
  perform seguridad.encolar_correo(
    'registro_rechazado',
    jsonb_build_object('usuario', s.usuario_nombre, 'empresa', s.razon_social, 'ruc', s.ruc, 'motivo', s.motivo_rechazo),
    array[s.usuario_correo]
  );
end;
$$;

revoke execute on all functions in schema seguridad from public, anon;
grant execute on all functions in schema seguridad to authenticated, service_role;
-- encolar_correo solo se usa desde otras funciones del sistema, nunca directamente.
revoke execute on function seguridad.encolar_correo(text, jsonb, text[], uuid, uuid, boolean) from authenticated;
