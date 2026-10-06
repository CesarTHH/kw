# Avance del proyecto

| Fase | Estado | Fecha | Notas |
|---|---|---|---|
| 0. Análisis | **Completa** | 05/10/2026 | P1–P6 y P8 respondidas; las demás preguntas se resuelven en la fase de cada módulo |
| 1. Base | **Entregada, compila y pasa todas las pruebas en GitHub** | 06/10/2026 | Pendiente: tu prueba en el navegador |
| 2. Maestras y registro | Pendiente | | |
| 3. Correos | Pendiente | | |
| 4. Gestiona tus raciones | Pendiente | | |
| 5. Refrigerios | Pendiente | | |
| 6. Contenido y contacto | Pendiente | | |
| 7. Importador, métricas y rendimiento | Pendiente | | |
| 8. Despliegue | Pendiente | | |

## Fase 0: qué se revisó

- 7 CSV maestros y el Excel de solicitudes (320.163 filas, ene-2025 a dic-2026).
- 14 capturas de pantalla: registro, login, menú, Data maestra, dashboard, consulta, programación, adición/reducción, traslado, refrigerios (3) y Contáctanos.
- Word con 4 modelos de correo.
- No se escribió código de la app.

## Nota de seguridad

En el mensaje inicial del proyecto se compartió en texto plano la contraseña de la cuenta Microsoft que usan los contratistas. **Debe cambiarse.** Esa contraseña no se guardó en ningún archivo del proyecto.

## Fase 1: qué se entregó

- **Base de datos** (`supabase/migrations`, 6 migraciones):
  - Organización y catálogos.
  - Roles, menús y permisos configurables.
  - Perfiles de usuario.
  - Auditoría automática de cambios.
  - Configuración y horarios.
  - Hora oficial del servidor.
  - RLS en todas las tablas.
- **Pruebas de seguridad de la base:** 56 pruebas pgTAP, todas aprobadas en PostgreSQL. Cubren aislamiento entre empresas, MFA, escalamiento de privilegios y auditoría.
- **App:**
  - Inicio, login, recuperación y cambio de contraseña, verificación en dos pasos.
  - Menú principal dinámico según permisos.
  - Pantalla de roles y permisos (Superadmin).
  - Páginas "en construcción" para los módulos de fases siguientes.
- **Seguridad de la app:**
  - CSP con nonce y cabeceras HTTP seguras.
  - Límite de intentos de login.
  - Redirecciones seguras.
  - Verificación de permiso en cada página y en cada acción.
- **Calidad:**
  - Pruebas unitarias (Vitest).
  - CI en GitHub (lint, tipos, pruebas, build, auditoría de dependencias, pruebas de la base).
  - Dependabot.
- **Revisión de seguridad independiente:** se corrigieron todos los hallazgos de prioridad alta y media.

## Pendientes conocidos

- 06/10/2026: primera ejecución en GitHub Actions en verde (lint, tipos, pruebas unitarias, build, auditoría de dependencias y 56 pruebas de seguridad en Supabase real).
- Proyecto Supabase de pruebas: `kw-raciones-pruebas` (us-east-1), con migraciones, datos de ejemplo y un usuario por rol.
- La IP registrada en la auditoría es la del servidor de la app; la IP real del usuario se agregará en la Fase 3.
- Después de verificar el segundo factor, la app vuelve al menú en lugar de a la página que se pidió originalmente. Es una mejora menor.
