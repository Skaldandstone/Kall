import { Fraunces, IBM_Plex_Sans } from 'next/font/google';
import './ground.css';

/**
 * The public career page uses a different type pairing from the product.
 *
 * Loaded here rather than in the root layout so only this route pays for
 * them, and through next/font because the CSP in next.config.mjs does not
 * permit fonts.googleapis.com -- referencing the families by name would have
 * fallen back silently to a system serif.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-fraunces',
  display: 'swap',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

export default function CareerPageLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${fraunces.variable} ${plexSans.variable}`}>{children}</div>;
}
