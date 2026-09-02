import type { Metadata } from 'next';
import KallMark from '../components/KallMark';
import { LegalEmail, LegalValue } from '../components/LegalValue';
import { LEGAL } from '../lib/legal';

export const metadata: Metadata = {
  title: 'Support',
  description: 'How to reach a person about Kall, and what to expect.',
};

/**
 * A published, reachable support contact is a launch requirement in its own
 * right, and app stores and payment processors both look for one. Every value
 * on this page comes from app/lib/legal.ts.
 */
export default function SupportPage() {
  return (
    <main className="shell" style={{ maxWidth: 920, paddingTop: 48, paddingBottom: 72 }}>
      <a className="brand" href="/" aria-label="Kall home"><KallMark />Kall</a>
      <section className="hero" style={{ paddingTop: 48, paddingBottom: 36 }}>
        <div>
          <span className="eyebrow">Support</span>
          <h1 style={{ fontSize: 'clamp(42px, 7vw, 72px)' }}>Get help</h1>
          <p>One mailbox, answered by a person.</p>
        </div>
      </section>

      <article className="card" style={{ marginTop: 28, display: 'grid', gap: 28, lineHeight: 1.7 }}>
        <section>
          <h2>Email us</h2>
          <p style={{ fontSize: 20 }}>
            <LegalEmail value={LEGAL.supportContactEmail} label="support email" />
          </p>
          <p>
            We aim to reply within{' '}
            <LegalValue value={LEGAL.supportResponseBusinessDays} label="support response time in business days" />{' '}
            business days. Kall is a small team, so there is no phone line and no live chat.
          </p>
        </section>

        <section>
          <h2>What to include</h2>
          <ul>
            <li>The email address on your Kall account.</li>
            <li>What you were doing and what happened instead.</li>
            <li>The page you were on, and roughly when.</li>
            <li>A screenshot, if the problem is something you can see.</li>
          </ul>
          <p>
            Never send us a password or a two-factor code. We will never ask for one.
          </p>
        </section>

        <section>
          <h2>Billing questions</h2>
          <p>
            Plans, invoices, payment method, and cancellation are all self-service on the{' '}
            <a href="/billing">billing page</a>. What happens when you cancel, and what refund you
            are owed, is set out in section 9 of the <a href="/terms">Terms of Service</a>. If
            something looks wrong on a charge, email support with the date and amount.
          </p>
        </section>

        <section>
          <h2>Privacy requests</h2>
          <p>
            <strong>Deleting your data does not need a request.</strong> Delete your account
            yourself from account settings, any time, without asking us. It is immediate and
            irreversible, and section 10 of the <a href="/terms">Terms of Service</a> sets out
            exactly what it removes. You can also edit or remove individual profile fields,
            resumes, and documents directly.
          </p>
          <p>
            For anything deletion does not cover, write to{' '}
            <LegalEmail value={LEGAL.privacyContactEmail} label="privacy email" />: a copy of the
            information we hold about you, a correction, a question about how something is used, or
            help if you cannot sign in to do it yourself. We may need to verify who you are first.
          </p>
        </section>

        <section>
          <h2>Security reports</h2>
          <p>
            If you have found a vulnerability, report it to{' '}
            <LegalEmail value={LEGAL.securityContactEmail} label="security email" />. Please give us
            a reasonable chance to fix it before disclosing it publicly. Do not access, modify, or
            keep another person&rsquo;s data while testing.
          </p>
        </section>

        <section>
          <h2>By mail</h2>
          <address style={{ fontStyle: 'normal' }}>
            <LegalValue value={LEGAL.operatorLegalName} label="legal operator name" />
            <br />
            <LegalValue value={LEGAL.mailingAddress} label="mailing address" />
          </address>
        </section>
      </article>
    </main>
  );
}
