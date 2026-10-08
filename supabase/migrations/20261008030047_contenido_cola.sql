-- =============================================================================
-- Kuntur Wasi · Fase 6 (6/7): cola de correos: tope de reintentos y limpieza de archivos.
-- =============================================================================

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

revoke execute on function public.correos_tomar_lote(int) from public, anon, authenticated;
grant execute on function public.correos_tomar_lote(int) to service_role;
revoke execute on function seguridad.disparar_envio_correos() from public, anon, authenticated;
