# Configuración de entornos

## Variables de entorno

| Variable | Dónde se usa | Secreta | Valor en desarrollo | Valor en producción |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Navegador y servidor | No | URL del proyecto de pruebas | URL del proyecto de producción |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Navegador y servidor | No (RLS protege los datos) | Clave publishable / anon | Ídem |
| `SUPABASE_SECRET_KEY` | Solo servidor | **Sí**: salta RLS | En `.env.local` | Google Secret Manager |
| `NEXT_PUBLIC_SITE_URL` | Enlaces de correos | No | `http://localhost:3000` | `https://<dominio>` |
| `SUPERADMIN_EMAIL` | Script de usuarios de ejemplo | No | Tu correo | No se usa |

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

> **Correos en desarrollo:** sin un proveedor SMTP propio, Supabase envía como máximo 2 correos por hora y solo a los miembros de tu equipo en Supabase. Por eso los usuarios de ejemplo reciben una contraseña temporal en vez de un correo. En la Fase 3 se conecta Amazon SES.

## Roles y verificación en dos pasos

- Los roles con "Exigir verificación en dos pasos" (por defecto Superadmin y Admin) **no ven ningún dato** hasta verificar el segundo factor.
- Lo controla la base de datos, que exige que la sesión tenga nivel `aal2`.
- Se puede cambiar por rol en **Administración → Roles y permisos**. En el Superadmin no se puede desactivar.
