import type { Metadata, Viewport } from 'next';
import OpportunitiesAtsSearch from './components/OpportunitiesAtsSearch';
import SiteFooter from './components/SiteFooter';
import ToastHost from './components/ToastHost';
import './globals.css';
import './search-apply.css';
import './search-tracking.css';
import './toast.css';

export const metadata: Metadata = {
  title: {
    default: 'Kall — The Career Operating System',
    template: '%s — Kall',
  },
  description:
    'A calm, private workspace for building a meaningful career over time.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Kall',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#10231b',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ToastHost />
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1 }}>
            {children}
            <OpportunitiesAtsSearch />
          </div>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
