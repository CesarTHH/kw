-- =============================================================================
-- Kuntur Wasi · Fase 6 (3/7): políticas de Storage de los documentos.
-- =============================================================================

-- Quien solo ve: únicamente el archivo de la versión vigente. Quien publica: todas las versiones.
create policy documentos_leer on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and seguridad.puede_leer_archivo_documento(name));
create policy documentos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and seguridad.puede_editar_documento((storage.foldername(name))[1]));

