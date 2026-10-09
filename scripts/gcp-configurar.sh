#!/usr/bin/env bash
# =============================================================================
# Configuración inicial de Google Cloud para publicar el Portal de Raciones KW.
# Se ejecuta UNA sola vez, en Cloud Shell (console.cloud.google.com → icono >_).
#
#   bash gcp-configurar.sh ID_DEL_PROYECTO
#
# Qué hace (se puede repetir sin romper nada):
#   1. Activa los servicios necesarios (Cloud Run, Artifact Registry, Secret Manager…).
#   2. Crea el almacén de imágenes "kw" en us-east4 (guarda solo las 5 últimas).
#   3. Crea dos cuentas de servicio: kw-app (la app) y kw-despliegue (GitHub Actions).
#   4. Guarda la clave secreta de Supabase en Secret Manager (tú la pegas; no se muestra).
#   5. Conecta GitHub con Google Cloud SIN llaves (Workload Identity Federation),
#      solo para la rama main del repositorio CesarTHH/kw.
#   6. Imprime los valores que debes copiar en GitHub → Settings → Variables.
# =============================================================================
set -euo pipefail

PROYECTO="${1:-}"
if [ -z "$PROYECTO" ]; then
  echo "Uso: bash gcp-configurar.sh ID_DEL_PROYECTO" >&2
  exit 1
fi

REGION="us-east4"
REPO_GITHUB="CesarTHH/kw"
REPO_IMAGENES="kw"
SA_APP="kw-app"
SA_DESPLIEGUE="kw-despliegue"
POOL="github"
PROVEEDOR="github"
SECRETO="supabase-secret-key"

gcloud config set project "$PROYECTO" >/dev/null
NUMERO=$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)')
SA_APP_EMAIL="${SA_APP}@${PROYECTO}.iam.gserviceaccount.com"
SA_DESPLIEGUE_EMAIL="${SA_DESPLIEGUE}@${PROYECTO}.iam.gserviceaccount.com"

echo "== 1/6 Activando servicios (puede tardar 1-2 minutos)…"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com

echo "== 2/6 Almacén de imágenes…"
if ! gcloud artifacts repositories describe "$REPO_IMAGENES" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO_IMAGENES" \
    --repository-format=docker --location="$REGION" \
    --description="Imágenes del Portal de Raciones KW"
fi
# Borra imágenes viejas (se guardan las 5 últimas) para no pagar almacenamiento de más.
cat > /tmp/kw-limpieza.json <<'JSON'
[
  { "name": "conservar-ultimas-5", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 5 } },
  { "name": "borrar-resto", "action": { "type": "Delete" }, "condition": { "tagState": "ANY" } }
]
JSON
gcloud artifacts repositories set-cleanup-policies "$REPO_IMAGENES" \
  --location="$REGION" --policy=/tmp/kw-limpieza.json --no-dry-run >/dev/null

echo "== 3/6 Cuentas de servicio…"
for SA in "$SA_APP" "$SA_DESPLIEGUE"; do
  if ! gcloud iam service-accounts describe "${SA}@${PROYECTO}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SA" --display-name="Portal KW: $SA"
  fi
done
# kw-despliegue: publicar en Cloud Run, subir imágenes y "actuar como" kw-app (nada más).
gcloud projects add-iam-policy-binding "$PROYECTO" \
  --member="serviceAccount:${SA_DESPLIEGUE_EMAIL}" --role="roles/run.admin" --condition=None >/dev/null
gcloud artifacts repositories add-iam-policy-binding "$REPO_IMAGENES" --location="$REGION" \
  --member="serviceAccount:${SA_DESPLIEGUE_EMAIL}" --role="roles/artifactregistry.writer" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$SA_APP_EMAIL" \
  --member="serviceAccount:${SA_DESPLIEGUE_EMAIL}" --role="roles/iam.serviceAccountUser" >/dev/null

echo "== 4/6 Clave secreta de Supabase…"
if gcloud secrets describe "$SECRETO" >/dev/null 2>&1; then
  read -r -p "La clave ya está guardada. ¿Reemplazarla? (s/N): " RESP
else
  gcloud secrets create "$SECRETO" --replication-policy=automatic
  RESP="s"
fi
if [ "${RESP,,}" = "s" ]; then
  echo "Supabase → Project Settings → API Keys → Secret key (empieza con sb_secret_)."
  read -r -s -p "Pégala aquí (no se verá) y pulsa Enter: " CLAVE
  echo
  if [ -z "$CLAVE" ]; then echo "No se pegó ninguna clave." >&2; exit 1; fi
  printf '%s' "$CLAVE" | gcloud secrets versions add "$SECRETO" --data-file=- >/dev/null
  unset CLAVE
fi
# Solo la app puede leerla.
gcloud secrets add-iam-policy-binding "$SECRETO" \
  --member="serviceAccount:${SA_APP_EMAIL}" --role="roles/secretmanager.secretAccessor" >/dev/null

echo "== 5/6 Conexión GitHub → Google Cloud (sin llaves)…"
if ! gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVEEDOR" \
     --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVEEDOR" \
    --location=global --workload-identity-pool="$POOL" \
    --display-name="GitHub CesarTHH/kw" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='${REPO_GITHUB}' && assertion.ref=='refs/heads/main'"
fi
gcloud iam service-accounts add-iam-policy-binding "$SA_DESPLIEGUE_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${NUMERO}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO_GITHUB}" >/dev/null

echo
echo "== 6/6 Listo. Copia estas variables en GitHub:"
echo "   github.com/${REPO_GITHUB} → Settings → Secrets and variables → Actions → pestaña Variables → New repository variable"
echo
echo "GCP_PROJECT_ID       = ${PROYECTO}"
echo "GCP_WIF_PROVIDER     = projects/${NUMERO}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVEEDOR}"
echo "GCP_SA_DESPLIEGUE    = ${SA_DESPLIEGUE_EMAIL}"
echo "GCP_SA_APP           = ${SA_APP_EMAIL}"
echo
echo "Además (los mismos valores de tu .env.local, son públicos):"
echo "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,"
echo "NEXT_PUBLIC_SITE_URL = https://raciones.kunturwasi-catering.com y SES_SNS_TOPIC_ARN (si ya lo tienes)."
