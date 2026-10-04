import type { Metadata, Viewport } from 'next';
import { DEMO_TENANT } from '@/lib/demo-data';
import { I18nProvider } from './components/I18nProvider';
import './globals.css';

const appName = DEMO_TENANT.companyName.trim() || 'Safex Safety';
const companyLogo = DEMO_TENANT.logoPath?.trim();

export const metadata: Metadata = {
  title: appName,
  description: 'Site-aware safety reporting and alerts',
  applicationName: appName,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: appName, statusBarStyle: 'black-translucent' },
  icons: {
    icon: companyLogo ? [{ url: companyLogo }] : [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { url: '/icon.svg', type: 'image/svg+xml' }],
    apple: companyLogo ?? '/icon-192.png'
  }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f2540'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="hi-IN" data-mode="light" data-palette="safex"><body><I18nProvider>{children}</I18nProvider></body></html>;
}
