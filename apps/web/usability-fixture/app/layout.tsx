import { Epilogue, IBM_Plex_Mono, Syne } from 'next/font/google';
import '../../app/globals.css';
import '../../app/search-apply.css';
import '../../app/search-tracking.css';
import '../../app/toast.css';
import ToastHost from '../../app/components/ToastHost';

const syne = Syne({ subsets: ['latin'], display: 'swap', weight: ['600', '700', '800'], variable: '--font-syne' });
const epilogue = Epilogue({ subsets: ['latin'], display: 'swap', weight: ['400', '500', '600'], variable: '--font-epilogue' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], display: 'swap', weight: ['400', '500'], variable: '--font-plex-mono' });

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${syne.variable} ${epilogue.variable} ${mono.variable}`}><body>
    <p style={{ margin: 0, padding: '6px 16px', background: '#24334a', color: '#e8ecf2', fontSize: 12 }}>Local UI fixture. Synthetic data only. No authentication or live sending.</p>
    <ToastHost />{children}
  </body></html>;
}
