import '@fontsource-variable/fraunces';
import '@fontsource-variable/ibm-plex-sans';
import './ground.css';

/**
 * The public career page uses a different type pairing from the product.
 *
 * Loaded here rather than in the root layout so only this route pays for
 * them. Fontsource bundles the files with the application, so production
 * builds and the browser never depend on Google Fonts being reachable.
 */
export default function CareerPageLayout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
