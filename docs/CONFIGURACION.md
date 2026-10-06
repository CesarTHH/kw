# Configuración de entornos

## Variables de entorno

| Variable | Dónde se usa | Secreta | Valor en desarrollo | Valor en producción |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Navegador y servidor | No | URL del proyecto de pruebas | URL del proyecto de producción |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Navegador y servidor | No (RLS protege los datos) | Clave publishable / anon | Ídem |
| `SUPABASE_SECRET_KEY` | Solo servidor | **Sí**: salta RLS | En `.env.local` | Google Secret Manager |
| `NEXT_PUBLIC_SITE_URL` | Enlaces de correos | No | `http://localhost:3000` | `https://<dominio>` |
| `SUPERADMIN_EMAIL` | Script de usuarios de ejemplo | No | Tu correo | No se usa |
| `SES_SNS_TOPIC_ARN` | Servidor (eventos de SES) | No | ARN del tema SNS (opcional) | ARN del tema SNS |

## Autenticación (panel de Supabase)

Hazlo en el proyecto de pruebas y repítelo en producción.

1. **Authentication → Sign In / Providers → Email**
   - "Allow new users to sign up": **desactivado**. Las cuentas las crea el administrador.
   - "Confirm email": activado.
   - "Secure password change": activado.
2. **Authentication → Policies (Password)**
   - Longitud mínima: **10**.
   - Requisitos: **minúsculas, mayúsculas y números**.
   - "Prevent use of leaked passwords": activado, si tu plan lo permite.
3. **Authentication → URL Configuration**
   - Site URL: `http://localhost:3000` (en producción, el dominio real).
   - Redirect URLs: `http://localhost:3000/auth/confirm`.
4. **Authentication → Email Templates**
   - **Reset password**: pega el contenido de `supabase/templates/recuperar.html`.
   - **Invite user**: pega el contenido de `supabase/templates/invitacion.html`.
   - Es necesario porque la app valida los enlaces en `/auth/confirm`.
5. **Authentication → Multi-Factor**
   - TOTP: habilitado (viene así por defecto).
6. **Authentication → Sessions** (requiere plan Pro)
   - Time-box: 12 h.
   - Inactivity timeout: 2 h.

> **Correos en desarrollo:** sin un proveedor SMTP propio, Supabase envía como máximo 2 correos por hora y solo a los miembros de tu equipo en Supabase. Por eso los usuarios de ejemplo reciben una contraseña temporal. Para conectar Amazon SES, sigue la sección "Correos con Amazon SES".

## Roles y verificación en dos pasos

- Los roles con "Exigir verificación en dos pasos" (por defecto Superadmin y Admin) **no ven ningún dato** hasta verificar el segundo factor.
- Lo controla la base de datos, que exige que la sesión tenga nivel `aal2`.
- Se puede cambiar por rol en **Administración → Roles y permisos**. En el Superadmin no se puede desactivar.

## Correos con Amazon SES (Fase 3)

Cómo funciona: cada acción que notifica deja el correo en una **cola** en la base de datos. Cada minuto, Supabase Cron llama a la Edge Function `enviar-correos`, que arma el correo con su plantilla y lo envía por Amazon SES. Si SES falla, reintenta con espera creciente (2, 4, 8, 16 y 32 minutos). Las entregas, rebotes y quejas vuelven a la app y se ven en **Administración → Historial de correos**.

Mientras SES no esté listo, deja **Configuración → Envío de correos** en "Solo registrar": los correos se arman y se ven en el historial, pero no salen.

### 1. Dominio y remitente (una vez)

1. En la consola de AWS, región **us-east-1 (N. Virginia)**, abre **Amazon SES → Identities → Create identity → Domain**.
2. Escribe tu dominio (por ejemplo `kunturwasi-catering.com`) y activa **Easy DKIM (RSA 2048)**.
3. SES muestra 3 registros CNAME. Agrégalos en el DNS del dominio (Cloudflare u otro). La verificación tarda de minutos a unas horas.
4. Recomendado: en la misma identidad, configura un **MAIL FROM** propio (`correo.<dominio>`) y agrega el registro MX y el TXT (SPF) que indica SES.
5. Agrega un registro **DMARC** en el DNS: `_dmarc.<dominio>` TXT `v=DMARC1; p=none; rua=mailto:<tu correo>`.

### 2. Usuario de AWS con permiso solo para enviar

1. **IAM → Users → Create user**, nombre `kw-ses-envio`, sin acceso a la consola.
2. Asígnale esta política (solo permite enviar correo desde tu dominio):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ses:SendEmail", "ses:SendRawEmail"],
    "Resource": "*",
    "Condition": { "StringLike": { "ses:FromAddress": "*@<tu-dominio>" } }
  }]
}
```

3. En el usuario, **Security credentials → Create access key → Application running outside AWS**. Guarda la clave en tu gestor de contraseñas. **No la pegues en el chat ni en ningún archivo del proyecto.**

### 3. Secretos de la Edge Function

En Supabase → **Edge Functions → Secrets** (o **Project Settings → Edge Functions**), agrega:

| Nombre | Valor |
|---|---|
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | La clave del paso 2 |
| `AWS_SECRET_ACCESS_KEY` | El secreto del paso 2 |
| `SES_CONFIGURATION_SET` | `kw-eventos` (paso 5) |

### 4. Remitente y modo de envío en la app

En **Administración → Configuración y horarios → Configuración general**:

- **Dirección del remitente:** por ejemplo `notificaciones@<tu-dominio>`.
- **Nombre del remitente:** "Administración de Facturación".
- **Dirección pública de la app:** la URL con la que se entra al portal.
- **Envío de correos:** "Enviar por Amazon SES".

### 5. Entregas, rebotes y quejas (eventos de SES)

1. **Amazon SNS → Topics → Create topic** (tipo Standard), nombre `kw-ses-eventos`. Copia su **ARN**.
2. **SES → Configuration sets → Create set**, nombre `kw-eventos`. En **Event destinations → Add destination**, marca *Deliveries, Hard bounces, Complaints, Rejects* y elige el tema SNS anterior.
3. En el servidor de la app agrega la variable `SES_SNS_TOPIC_ARN` con ese ARN.
4. En SNS, en el tema, **Create subscription**: protocolo **HTTPS**, endpoint `https://<dominio-de-la-app>/api/ses/eventos`. La app confirma la suscripción sola (verifica la firma de AWS).

> En desarrollo (`localhost`) SNS no puede llegar a tu PC; este paso se completa al desplegar (Fase 8).

### 6. Salir del modo sandbox

En sandbox, SES solo envía a direcciones verificadas (SES → Identities → Create identity → Email address) y hasta 200 correos al día. Para enviar a cualquier dirección, en **SES → Account dashboard → Request production access** describe el uso: correos transaccionales de confirmación a clientes registrados (unos 500 al mes), con manejo de rebotes y quejas. Suele aprobarse en 1 o 2 días.

### 7. Correos de recuperación de contraseña (Supabase Auth)

Los correos de "olvidé mi contraseña" los envía Supabase Auth. Para que salgan por SES:

1. **SES → SMTP settings → Create SMTP credentials** (crea otro usuario IAM solo para SMTP). Guarda el usuario y la contraseña SMTP.
2. En Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**:
   - Host: `email-smtp.us-east-1.amazonaws.com`, puerto `587`.
   - Usuario y contraseña: los del paso anterior.
   - Sender email: `notificaciones@<tu-dominio>`. Sender name: `Portal de Raciones KW`.
3. En **Authentication → Rate Limits**, sube "Rate limit for sending emails" a 100 por hora.

### 8. Programación del envío (ya hecha en el proyecto de pruebas)

La migración `correos_cron` programa el envío cada minuto. Necesita dos secretos en **Supabase → Project Settings → Vault**:

- `correos_url`: `https://<proyecto>.supabase.co/functions/v1/enviar-correos`
- `correos_cron_secreto`: un texto aleatorio de 32 caracteres o más

En el proyecto de pruebas ya están creados. En producción hay que crearlos de nuevo.
