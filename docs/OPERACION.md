# Operación: publicar y mantener el Portal de Raciones KW

La app corre en **Google Cloud Run** (región `us-east4`). La base de datos y el inicio de sesión están en **Supabase**. Los correos salen por **Amazon SES**. El dominio se administra en **Cloudflare**.

Cada vez que se sube código a la rama `main` de GitHub, primero se ejecutan las pruebas (CI) y, si todo sale bien, **la app se publica sola** (flujo `Desplegar a Cloud Run`).

Dirección de la app: **https://raciones.kunturwasi-catering.com**
(Se usa un subdominio para no tocar la página web ni el correo que ya existen en `kunturwasi-catering.com`).

---

## A. Primera publicación (una sola vez)

### 1. Proyecto de Google Cloud
1. Entra a <https://console.cloud.google.com> con tu cuenta de Google.
2. Arriba, en el selector de proyectos → **Proyecto nuevo** → nombre `portal-raciones-kw`. Anota el **ID del proyecto** (aparece debajo del nombre).
3. Menú → **Facturación**: vincula el proyecto a tu cuenta de facturación. Con el uso previsto, Cloud Run queda dentro del nivel gratuito o en pocos dólares al mes.
4. Recomendado: **Facturación → Presupuestos y alertas** → presupuesto de 10 USD con aviso al 50 % y 100 %.

### 2. Ejecutar el script de configuración
1. En la consola, pulsa el icono **>_** (Cloud Shell), arriba a la derecha.
2. Escribe:
   ```bash
   git clone https://github.com/CesarTHH/kw.git && bash kw/scripts/gcp-configurar.sh ID_DEL_PROYECTO
   ```
3. Cuando lo pida, pega la **Secret key** de Supabase (Project Settings → API Keys). No se verá al pegarla. Esa clave **solo** se guarda en Google Secret Manager; no va a GitHub ni al chat.
4. Al final el script muestra 4 valores. Déjalo abierto.

### 3. Variables en GitHub
En <https://github.com/CesarTHH/kw> → **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**, crea:

| Variable | Valor |
|---|---|
| `GCP_PROJECT_ID` | (lo muestra el script) |
| `GCP_WIF_PROVIDER` | (lo muestra el script) |
| `GCP_SA_DESPLIEGUE` | (lo muestra el script) |
| `GCP_SA_APP` | (lo muestra el script) |
| `NEXT_PUBLIC_SUPABASE_URL` | el mismo de tu `.env.local` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | el mismo de tu `.env.local` (es pública) |
| `NEXT_PUBLIC_SITE_URL` | `https://raciones.kunturwasi-catering.com` |
| `SES_SNS_TOPIC_ARN` | el ARN del tema SNS (si ya lo creaste; si no, déjalo para después) |

Son **variables**, no secretos: ninguna es una contraseña.

### 4. Primera publicación
GitHub → pestaña **Actions** → **Desplegar a Cloud Run** → **Run workflow**. Tarda unos 5 minutos. Al final, el paso "Verificar que responde" muestra una dirección como `https://portal-raciones-xxxx.us-east4.run.app`. Ábrela: debe salir la pantalla de inicio de sesión.

### 5. Dominio (Cloudflare)
1. **Verificar el dominio en Google** (solo la primera vez). En Cloud Shell:
   ```bash
   gcloud domains verify kunturwasi-catering.com
   ```
   Se abre Search Console: elige el método **registro TXT**, copia el valor y agrégalo en **Cloudflare → DNS → Records → Add record** (tipo `TXT`, nombre `@`). Vuelve a Search Console y pulsa **Verificar**.
2. **Asociar el subdominio** a la app (Cloud Shell):
   ```bash
   gcloud beta run domain-mappings create --service portal-raciones \
     --domain raciones.kunturwasi-catering.com --region us-east4
   ```
3. En **Cloudflare → DNS → Add record**: tipo `CNAME`, nombre `raciones`, destino `ghs.googlehosted.com`, **Proxy: desactivado (nube gris, "DNS only")**.
4. El certificado HTTPS lo emite Google: tarda de 15 minutos a unas horas. Puedes ver el estado con:
   ```bash
   gcloud beta run domain-mappings describe --domain raciones.kunturwasi-catering.com --region us-east4
   ```

> **Por qué la nube gris:** Google necesita ver el subdominio directamente para emitir y renovar el certificado. Con el proxy de Cloudflare activado, la renovación puede fallar y la app quedaría sin HTTPS. La alternativa con proxy (balanceador de Google) cuesta unos 18 USD/mes; no es necesaria para ~200 usuarios. Ver D44 en DECISIONES.md.

### 6. Supabase apuntando al dominio
Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://raciones.kunturwasi-catering.com`
- **Redirect URLs:** agrega `https://raciones.kunturwasi-catering.com/**` (deja también `http://localhost:3000/**` para seguir probando en tu PC).

En la app, **Administración → Configuración**: cambia **Dirección pública de la app** a `https://raciones.kunturwasi-catering.com` (es la que va en los enlaces de los correos).

### 7. Correos en producción (Amazon SES)
1. Sigue la sección de SES de `docs/CONFIGURACION.md` (dominio verificado con DKIM, SPF y DMARC en Cloudflare).
2. En AWS → SES → **Account dashboard → Request production access**: tipo *Transactional*, sitio `https://raciones.kunturwasi-catering.com`, y explica que son confirmaciones de pedidos de raciones para ~200 usuarios registrados (~500 correos al mes). AWS responde en 1 día aprox.
3. Suscripción SNS de eventos: endpoint `https://raciones.kunturwasi-catering.com/api/ses/eventos`.
4. Cuando AWS apruebe, en **Administración → Configuración → Envío de correos** cambia de "solo registrar" a **enviar**.

---

## B. Día a día

| Tarea | Cómo |
|---|---|
| Publicar un cambio | Subir a `main`. Si el CI pasa, se publica solo. |
| Ver si la app está viva | `https://raciones.kunturwasi-catering.com/api/salud` debe decir `ok`. |
| Ver errores del servidor | Google Cloud → Cloud Run → `portal-raciones` → **Registros**. También en la app: Administración → Métricas. |
| Volver a la versión anterior | Cloud Run → `portal-raciones` → **Revisiones** → elige la anterior → **Administrar tráfico** → 100 %. |
| Cambiar la clave secreta de Supabase | Vuelve a ejecutar `bash kw/scripts/gcp-configurar.sh ID_DEL_PROYECTO` y responde **s** cuando pregunte. Después publica de nuevo (Actions → Run workflow). |
| Costos | Facturación → Informes. Cloud Run cobra solo mientras atiende pedidos (mínimo 0 instancias). |

## C. Importar el Excel histórico

El importador (Administración → Importar Excel) funciona en la app publicada: Cloud Run tiene 2 GB de memoria y 15 minutos por pedido. Si se corta, se continúa donde quedó.

## D. Seguridad

- No hay llaves de Google guardadas en GitHub: GitHub se identifica con Workload Identity Federation y **solo** desde la rama `main` de `CesarTHH/kw`.
- La clave secreta de Supabase solo existe en Google Secret Manager y la lee únicamente la cuenta `kw-app`.
- El contenedor corre sin privilegios de administrador y no incluye código fuente, documentos ni datos.
- El repositorio es **público**: nunca subas archivos `.env`, Excel, CSV ni PDFs con datos reales (el `.gitignore` ya los excluye).
