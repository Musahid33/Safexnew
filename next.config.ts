import type { NextConfig } from 'next';

// Frame blocking is relaxed only for the local dev server (`next dev`) and for an explicitly
// opted-in preview instance (SAFEX_ALLOW_FRAME=1), so sandboxed/iframe previews can render.
// A normal production deploy (`next start` without the flag) keeps the strict anti-clickjacking
// headers, so this can never silently weaken a real deployment.
const allowFraming =
  process.env.NODE_ENV === 'development' || process.env.SAFEX_ALLOW_FRAME === '1';
const isDevServer = process.env.NODE_ENV === 'development';

// The only backend this app talks to is its own origin plus the configured Supabase project.
// Resolving that origin here keeps connect-src/img-src exact instead of the previous
// `https:` wildcard, which let any injected script exfiltrate data to an arbitrary host.
const supabaseOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
})();

const backendOrigins = supabaseOrigin ? [supabaseOrigin] : [];

const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // No iframes or embeds are used anywhere in the app.
  "frame-src 'none'",
  // Only dev/preview instances may be embedded in a frame.
  ...(allowFraming ? [] : ["frame-ancestors 'none'"]),
  // Recognition artwork may be served from the Supabase project storage bucket.
  `img-src 'self' data: blob: ${backendOrigins.join(' ')}`.trim(),
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // React's development runtime needs eval() for stack traces; never extend this to production.
  ...(isDevServer ? ["script-src 'self' 'unsafe-inline' 'unsafe-eval'"] : ["script-src 'self' 'unsafe-inline'"]),
  "script-src-attr 'none'",
  // WebSocket is only needed for the dev/HMR connection; production talks to 'self' + Supabase.
  `connect-src 'self' ${backendOrigins.join(' ')}${isDevServer ? ' ws: wss:' : ''}`.replace(/\s+/g, ' ').trim(),
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  'upgrade-insecure-requests'
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The live preview reaches the dev server through a proxied host, which Next
  // would otherwise reject as a cross-origin dev request (breaks HMR/websocket).
  ...(isDevServer ? { allowedDevOrigins: ['*.e2b.app'] } : {}),
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          ...(allowFraming ? [] : [{ key: 'X-Frame-Options', value: 'DENY' }]),
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'Content-Security-Policy', value: cspDirectives.join('; ') },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' }
        ]
      }
    ];
  }
};

export default nextConfig;
