-- =============================================================================
-- Kuntur Wasi · Fase 3: disparo automático del envío de correos.
--
-- Cada minuto, Supabase Cron revisa si hay correos en cola y, solo si los hay,
-- llama a la Edge Function "enviar-correos". La dirección de la función y el
-- secreto viven en Supabase Vault (no en el código):
--   correos_url           https://<proyecto>.supabase.co/functions/v1/enviar-correos
--   correos_cron_secreto  texto aleatorio de 32+ caracteres
-- Si faltan (entorno local o CI), no hace nada.
-- =============================================================================

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
  ) then
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
revoke execute on function seguridad.disparar_envio_correos() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.schedule('enviar-correos', '* * * * *', 'select seguridad.disparar_envio_correos()');
  end if;
end $$;
