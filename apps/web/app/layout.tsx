import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Epilogue, IBM_Plex_Mono, Syne } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import OpportunitiesAtsSearch from './components/OpportunitiesAtsSearch';
import SiteFooter from './components/SiteFooter';
import PlanLimitDialog from './components/PlanLimitDialog';
import ToastHost from './components/ToastHost';
import './globals.css';
import './search-apply.css';
import './search-tracking.css';
import './toast.css';
import './inscription.css';

const inscription = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-inscription',
  display: 'swap',
});

// Self-hosted at build time rather than linked from fonts.googleapis.com,
// which the CSP in next.config.mjs does not permit for styles or fonts.
const syne = Syne({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-syne',
  display: 'swap',
});

const epilogue = Epilogue({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-epilogue',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Kall | Make better career decisions',
    template: '%s | Kall',
  },
  description:
    'Keep your professional record current, compare roles with real experience, and prepare applications without inventing qualifications.',
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
  themeColor: '#191b1c',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-kall-theme={process.env.KALL_UI_THEME === 'legacy' ? 'legacy' : 'inscription'} className={`${inscription.variable} ${syne.variable} ${epilogue.variable} ${plexMono.variable}`}>
      <body>
        {/* Inside <body>, per Clerk's placement rule for this SDK version.
            Telemetry is off deliberately: the CSP blocks clerk-telemetry.com
            anyway, so leaving it on only produced console errors on every
            page -- and this app handles EEO and work-authorization data, so
            fewer third-party beacons is the right default regardless. */}
        {/* signInUrl/signUpUrl keep redirects on Kall's own branded pages --
            without them a protected route bounces to Clerk's hosted
            accounts.dev domain, which throws the user out of the product. */}
        <ClerkProvider telemetry={false} signInUrl="/sign-in" signUpUrl="/sign-up">
          <ToastHost />
          {/* Raised by fetchKall on any 402, from anywhere in the app. */}
          <PlanLimitDialog />
          <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1 }}>
              {children}
              <OpportunitiesAtsSearch />
            </div>
            <SiteFooter />
          </div>
        </ClerkProvider>
      </body>
    </html>
  );
}
