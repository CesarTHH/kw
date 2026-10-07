import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera un servidor autónomo para el contenedor Docker de Cloud Run.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Adjuntos de Contáctanos (hasta 10 MB) y PDFs; el servidor valida tipo y tamaño real.
    serverActions: { bodySizeLimit: "12mb" },
    proxyClientMaxBodySize: "12mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      {
        // Visor de PDF dentro de la app (la cabecera de abajo reemplaza a DENY solo en esta ruta).
        source: "/api/archivos/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;
