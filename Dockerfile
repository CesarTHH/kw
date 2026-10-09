# syntax=docker/dockerfile:1
# Imagen de producción para Google Cloud Run (servidor autónomo de Next.js).

FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1

# 1. Dependencias (versiones exactas del package-lock.json).
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2. Compilación. Las variables NEXT_PUBLIC_* se graban en el código del navegador,
#    por eso llegan como argumentos de compilación (son públicas, no secretas).
FROM base AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build

# 3. Imagen final: solo el servidor compilado, sin código fuente ni herramientas.
FROM base AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Sin privilegios de administrador dentro del contenedor.
USER node
EXPOSE 8080
CMD ["node", "server.js"]
