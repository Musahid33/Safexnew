import type { MetadataRoute } from 'next';
import { DEMO_TENANT } from '@/lib/demo-data';

function getCompanyLogoType(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0].toLowerCase();
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

export default function manifest(): MetadataRoute.Manifest {
  const appName = DEMO_TENANT.companyName.trim() || 'Safex Safety';
  const companyLogo = DEMO_TENANT.logoPath?.trim();
  const icons: NonNullable<MetadataRoute.Manifest['icons']> = companyLogo
    ? getCompanyLogoType(companyLogo) === 'image/svg+xml'
      ? [{ src: companyLogo, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
      : [
          { src: companyLogo, sizes: '192x192', type: getCompanyLogoType(companyLogo), purpose: 'any' },
          { src: companyLogo, sizes: '512x512', type: getCompanyLogoType(companyLogo), purpose: 'any' }
        ]
    : [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
      ];

  return {
    name: appName,
    short_name: appName,
    description: `${appName} · Site-aware safety reporting and alerts`,
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f6f9',
    theme_color: '#0f2540',
    icons
  };
}
