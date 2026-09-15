import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Epilogue, IBM_Plex_Mono, Syne } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { SENTRY_DSN_META_NAME, SENTRY_ENVIRONMENT_META_NAME } from '../lib/sentry-shared';
import OpportunitiesAtsSearch from './components/OpportunitiesAtsSearch';
import SiteFooter from './components/SiteFooter';
import MaintenanceBanner from './components/MaintenanceBanner';
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
    default: 'Kall™ | Make better career decisions',
    template: '%s | Kall™',
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
    title: 'Kall™',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#191b1c',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Request-time fallback for the browser Sentry DSN (public by design). Only
  // dynamically rendered pages see this; prerendered pages freeze the layout
  // at build, which is why NEXT_PUBLIC_SENTRY_DSN is also inlined there.
  // instrumentation-client.ts reads these tags when the build-time value is
  // absent. Both empty leaves the browser SDK inert.
  const sentryDsn = process.env.SENTRY_DSN;
  const sentryEnvironment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;
  return (
    <html lang="en" data-kall-theme={process.env.KALL_UI_THEME === 'legacy' ? 'legacy' : 'inscription'} className={`${inscription.variable} ${syne.variable} ${epilogue.variable} ${plexMono.variable}`}>
      <head>
        {sentryDsn ? <meta name={SENTRY_DSN_META_NAME} content={sentryDsn} /> : null}
        {sentryDsn && sentryEnvironment ? (
          <meta name={SENTRY_ENVIRONMENT_META_NAME} content={sentryEnvironment} />
        ) : null}
      </head>
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
          {/* Raised by fetchKall on a 502/503/504 or a failed fetch -- a
              deploy rolling out underneath an open tab, not a real outage. */}
          <MaintenanceBanner />
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
