import type { MetadataRoute } from 'next';

/**
 * The web app manifest is generated per deployment, not per tenant. The bundled icons are the
 * app's own; a company logo is uploaded by the tenant Admin and used inside the app, not in
 * this build-time file.
 */
export default function manifest(): MetadataRoute.Manifest {
  const appName = 'Safex Safety';
  return {
    name: appName,
    short_name: appName,
    description: `${appName} · Site-aware safety reporting and alerts`,
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f6f9',
    theme_color: '#0f2540',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
    ]
  };
}
