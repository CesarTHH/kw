-- =============================================================================
-- Kuntur Wasi · Fase 6 (7/7): plantilla del correo de Contáctanos (se ejecuta en el SQL Editor).
-- =============================================================================

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

