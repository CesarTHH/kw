/** Content-Security-Policy con nonce: solo se ejecutan los scripts que emite la propia app. */
export function construirCSP(nonce: string, supabaseUrl: string, desarrollo: boolean): string {
  const directivas = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${desarrollo ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseUrl}${desarrollo ? " ws:" : ""}`,
    "frame-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (!desarrollo) directivas.push("upgrade-insecure-requests");
  return directivas.join("; ");
}
