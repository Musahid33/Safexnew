import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Safex Safety',
  description: 'Site-aware safety reporting and alerts',
  applicationName: 'Safex',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Safex', statusBarStyle: 'black-translucent' },
  icons: { icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { url: '/icon.svg', type: 'image/svg+xml' }], apple: '/icon-192.png' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f2540'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-mode="light" data-palette="safex"><body>{children}</body></html>;
}
