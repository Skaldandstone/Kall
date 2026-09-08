import type { Metadata } from 'next';
import KallMark from '../components/KallMark';

export const metadata: Metadata = {
  title: 'Install the Android beta',
  description: 'Join Kall’s private Android beta and install through Google Play.',
};

// Closed testing links verified in Play Console. Do not replace the enrollment
// URL with the internal-testing track: it does not count toward the closed test.
const signupUrl = 'https://forms.gle/ZbqaLtAt7gVvVoiQ8';
const joinUrl = 'https://play.google.com/apps/testing/com.skaldandstone.kall';
const installUrl = 'https://play.google.com/store/apps/details?id=com.skaldandstone.kall';

export default function InstallPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Kall home">
          <KallMark />
          Kall
        </a>
        <a className="button secondary" href="/dashboard">Open Kall on the web</a>
      </header>

      <section aria-labelledby="install-heading" style={{ maxWidth: 720 }}>
        <span className="eyebrow">Private Android beta</span>
        <h1 id="install-heading">Get Kall on your phone.</h1>
        <p>
          You’ll need an Android phone with Google Play and an invitation to the beta.
          Use the same Google account for signup, joining the test, and installation.
        </p>

        <ol style={{ display: 'grid', gap: 24, paddingLeft: 24, lineHeight: 1.6 }}>
          <li>
            <h2>Request your invitation</h2>
            <p>
              Share the Google account email you use in the Play Store. Wait for your
              invitation email before continuing. Already invited? Go to step 2.
            </p>
            <a className="button secondary" href={signupUrl}>Sign up for the beta</a>
          </li>
          <li>
            <h2>Join the test</h2>
            <p>Open Google’s testing page with your invited account and choose to become a tester.</p>
            <a className="button secondary" href={joinUrl}>Join the Google Play test</a>
          </li>
          <li>
            <h2>Install Kall</h2>
            <p>After joining, open the listing on your Android phone and tap Install.</p>
            <a className="button" href={installUrl}>Install on Google Play</a>
          </li>
        </ol>

        <p style={{ marginTop: 32 }}>
          Stay enrolled for 14 days, try Kall during that time, and send us your feedback.
          The signup form alone does not enroll you in the test.
        </p>
        <details className="card" style={{ marginTop: 24 }}>
          <summary>Can’t access the test or install the app?</summary>
          <p>
            Check that your invitation has arrived and that Google Play is using the
            email you signed up with. Availability also depends on your device and
            Play Store country.
          </p>
          <p>
            If you previously joined Kall’s internal test, leave that test before
            joining this closed beta.
          </p>
          <p>
            Still stuck? Email <a href="mailto:apps@skaldandstone.com">apps@skaldandstone.com</a>
            {' '}with the message Google Play shows you.
          </p>
        </details>
      </section>
    </main>
  );
}
