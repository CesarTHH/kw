import type { Metadata, Viewport } from "next";
import "./globals.css";

// La CSP usa un nonce distinto por petición: todas las páginas se generan al momento.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Portal de Raciones · KW Catering", template: "%s · KW Catering" },
  description: "Gestión de raciones y refrigerios para empresas contratistas",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f58634",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-PE">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
