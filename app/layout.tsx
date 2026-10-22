import type { Metadata, Viewport } from 'next';
import { I18nProvider } from './components/I18nProvider';
import SourceGuard from './components/SourceGuard';
import './globals.css';

// The static shell cannot know the tenant: the real company name arrives from
// /api/bootstrap and brands the page at runtime.
const appName = 'Safex Safety';

export const metadata: Metadata = {
  title: appName,
  description: 'Site-aware safety reporting and alerts',
  applicationName: appName,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: appName, statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { url: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    apple: '/icon-192.png'
  }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f2540'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-mode="light" data-palette="safex"><body>
      <SourceGuard />
      <I18nProvider>{children}</I18nProvider>
    </body></html>;
}
