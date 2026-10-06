# Portal de Raciones · Kuntur Wasi

Web app que reemplaza la Power App de gestión de raciones. Stack: Next.js + TypeScript + Supabase (ver `docs/`).

## Puesta en marcha (Windows, paso a paso)

> Haz esto una sola vez. Los comandos se escriben en la terminal (PowerShell) **dentro de la carpeta `app`**.
> Para abrirla: en el Explorador entra a `KunturWasi\app`, haz clic en la barra de direcciones, escribe `powershell` y pulsa Enter.

### 1. Instalar Node.js

Descarga e instala **Node.js 22 LTS** desde <https://nodejs.org>. Comprueba la instalación con:

```powershell
node -v
```

Debe mostrar `v22.x` o superior.

### 2. Instalar las dependencias

```powershell
npm install
```

Tarda unos minutos y crea la carpeta `node_modules` (no la sincronices con OneDrive). También crea `package-lock.json`: ese archivo **sí** debe subirse a GitHub, porque fija las versiones exactas.

### 3. Crear el proyecto de Supabase (entorno de pruebas, plan Free)

1. En <https://supabase.com/dashboard> crea un proyecto nuevo con la región **East US (North Virginia)** y una contraseña de base de datos fuerte. Guárdala en tu gestor de contraseñas.
2. En **Project Settings → API**, copia la URL y las claves.
3. Copia el archivo `.env.example` como `.env.local` y completa los valores. Nunca compartas `.env.local`.

### 4. Crear las tablas y los datos de ejemplo

```powershell
npx supabase login
npx supabase link --project-ref TU_ID_DE_PROYECTO
npm run db:ejemplo
```

`TU_ID_DE_PROYECTO` es el texto que aparece en la URL del proyecto (`https://TU_ID_DE_PROYECTO.supabase.co`). `db:ejemplo` crea todas las tablas, las reglas de seguridad y los **datos de ejemplo**.

> Usa `db:ejemplo` **solo en el proyecto de pruebas**. En producción se usa `npm run db:push`, que no carga datos de ejemplo.

### 5. Configurar el login en el panel de Supabase

Sigue la sección "Autenticación" de `docs/CONFIGURACION.md` (desactivar el registro libre, URLs y plantillas de correo).

### 6. Crear los usuarios de ejemplo (uno por rol)

```powershell
npm run usuarios:ejemplo
```

Muestra las contraseñas temporales **una sola vez**: guárdalas. El Superadmin usa el correo que pusiste en `SUPERADMIN_EMAIL`.

### 7. Abrir la app

```powershell
npm run dev
```

Entra a <http://localhost:3000>. En el primer ingreso:

- cada usuario debe crear su propia contraseña;
- Superadmin y Admin deben activar la verificación en dos pasos con Google Authenticator o Microsoft Authenticator.

## Comandos útiles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Abre la app en modo desarrollo |
| `npm test` | Pruebas automáticas de la lógica |
| `npm run lint` | Revisa el estilo y errores comunes del código |
| `npm run typecheck` | Revisa los tipos de TypeScript |
| `npm run build` | Compila la versión de producción |
| `npm run db:push` | Aplica en Supabase las migraciones nuevas (sin datos de ejemplo) |
| `npm run db:ejemplo` | Igual que `db:push` + datos de ejemplo (solo en pruebas) |
| `npm run db:tipos` | Regenera los tipos TypeScript desde la base de datos |

Las pruebas de seguridad de la base de datos (`supabase/tests`) se ejecutan automáticamente en GitHub en cada cambio.

## Estructura

```
app/
├─ docs/                 Especificación, modelo de datos, decisiones y avance
├─ supabase/
│  ├─ migrations/        Tablas, seguridad (RLS) y datos del sistema, en orden
│  ├─ tests/             Pruebas de seguridad de la base de datos (pgTAP)
│  ├─ seed.sql           Datos de EJEMPLO (sin datos personales reales)
│  └─ config.toml        Configuración de Supabase local / CI
├─ src/
│  ├─ app/               Pantallas (cada carpeta es una ruta)
│  ├─ components/        Piezas visuales reutilizables
│  ├─ lib/               Lógica: sesión, permisos, validaciones
│  └─ proxy.ts           Renueva la sesión y aplica cabeceras de seguridad
└─ scripts/              Utilidades (usuarios de ejemplo)
```

## Seguridad: reglas que no se rompen

- Los datos reales (CSV, Excel, Word) **nunca** van al repositorio; `.gitignore` los bloquea.
- Las claves solo viven en `.env.local` (en tu PC) y en Secret Manager (en producción).
- Cada empresa ve solo sus datos. Lo garantiza la base de datos (RLS), no solo la pantalla.
- Cada página y cada acción del servidor verifica el permiso del usuario.
