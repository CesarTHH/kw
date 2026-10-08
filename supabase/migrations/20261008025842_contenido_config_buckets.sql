-- =============================================================================
-- Kuntur Wasi · Fase 6 (1/7): configuración, buckets privados y columnas de adjuntos en la cola de correos.
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

-- Adjuntos y "responder a" en la cola de correos (Contáctanos).
alter table public.correos_pendientes
  add column adjuntos jsonb not null default '[]' check (jsonb_typeof(adjuntos) = 'array'),
  add column responder_a text check (responder_a is null or length(responder_a) <= 254);

