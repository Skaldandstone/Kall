import type { Metadata } from 'next';
import KallMark from '../components/KallMark';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Kall collects, uses, protects, and shares personal information.',
};

const updated = 'August 3, 2026';

export default function PrivacyPolicyPage() {
  return (
    <main className="shell" style={{ maxWidth: 920, paddingTop: 48, paddingBottom: 72 }}>
      <a className="brand" href="/" aria-label="Kall home"><KallMark />Kall</a>
      <section className="hero" style={{ paddingTop: 48, paddingBottom: 36 }}>
        <div>
          <span className="eyebrow">Legal</span>
          <h1 style={{ fontSize: 'clamp(42px, 7vw, 72px)' }}>Privacy Policy</h1>
          <p>Last updated: {updated}</p>
        </div>
      </section>

      <article className="card" style={{ marginTop: 28, display: 'grid', gap: 28, lineHeight: 1.7 }}>
        <section>
          <h2>1. Overview</h2>
          <p>
            Kall is a career operating system that helps people organize professional information,
            discover opportunities, prepare application materials, track applications, and plan career growth.
            This Privacy Policy explains what information Kall collects, how it is used, when it may be shared,
            and the choices available to users.
          </p>
        </section>

        <section>
          <h2>2. Information we collect</h2>
          <p>Depending on the features you use, Kall may collect:</p>
          <ul>
            <li><strong>Account information:</strong> name, email address, country, state or region, authentication method, and account settings.</li>
            <li><strong>Career profile information:</strong> employment history, education, skills, certifications, languages, awards, publications, memberships, volunteer work, references, compensation preferences, work authorization, work-location preferences, and career goals.</li>
            <li><strong>Documents and application content:</strong> resumes, cover letters, portfolios, job descriptions, application responses, testimonials, references, and generated or tailored materials.</li>
            <li><strong>Job-search activity:</strong> searches, saved opportunities, match scores, ignored roles, application status, submission history, and career-growth activity.</li>
            <li><strong>Authentication and security information:</strong> password hashes, linked OAuth provider identifiers, passkey credential data, authenticator-app status, session records, login attempts, and security-event metadata. Kall does not store the private key associated with a passkey.</li>
            <li><strong>Billing information:</strong> subscription status, plan, transaction identifiers, and billing-event metadata. Payment card details are processed by the payment provider and are not stored directly by Kall.</li>
            <li><strong>Technical information:</strong> IP address, browser and device information, timestamps, diagnostic logs, and information needed to operate, secure, and troubleshoot the service.</li>
          </ul>
        </section>

        <section>
          <h2>3. How we use information</h2>
          <p>Kall may use personal information to:</p>
          <ul>
            <li>Provide and personalize the service.</li>
            <li>Create and manage accounts, profiles, resumes, applications, and career plans.</li>
            <li>Search for and rank job opportunities based on user-selected criteria.</li>
            <li>Generate, tailor, or improve career documents and recommendations.</li>
            <li>Authenticate users, prevent fraud, protect accounts, and investigate abuse.</li>
            <li>Process subscriptions and maintain billing records.</li>
            <li>Communicate about account activity, service changes, security events, and support requests.</li>
            <li>Monitor reliability, diagnose errors, and improve Kall’s features and user experience.</li>
            <li>Comply with legal obligations and enforce applicable agreements.</li>
          </ul>
        </section>

        <section>
          <h2>4. Artificial intelligence and automated processing</h2>
          <p>
            Some Kall features may use artificial intelligence to analyze resumes and job descriptions,
            suggest improvements, generate application materials, summarize market information, or recommend
            career-development steps. User content may be sent to configured AI service providers solely to
            perform the requested function. Kall does not guarantee that generated content is complete or error-free,
            and users should review all outputs before relying on or submitting them.
          </p>
        </section>

        <section>
          <h2>5. When information may be shared</h2>
          <p>Kall may share information in the following circumstances:</p>
          <ul>
            <li><strong>At the user’s direction:</strong> when a user chooses to submit an application, share a profile, request a testimonial, or otherwise send information to another party.</li>
            <li><strong>Service providers:</strong> with hosting, database, authentication, AI, communications, analytics, payment, and security vendors that process information on Kall’s behalf.</li>
            <li><strong>Connected services:</strong> with third-party account providers or integrations the user chooses to connect, such as Google, LinkedIn, or GitHub.</li>
            <li><strong>Legal and safety reasons:</strong> when reasonably necessary to comply with law, legal process, enforce rights, protect users, prevent harm, or investigate fraud or abuse.</li>
            <li><strong>Business transfers:</strong> as part of a merger, financing, acquisition, reorganization, bankruptcy, or sale of assets, subject to applicable legal requirements.</li>
          </ul>
          <p>Kall does not sell personal information for money.</p>
        </section>

        <section>
          <h2>6. User controls and privacy choices</h2>
          <p>
            Kall provides field-level privacy controls for certain profile information. Users may choose whether
            supported fields are used for tailoring, application autofill, profile display, or omitted. Users may
            also update account and professional-profile information, disconnect supported integrations, change
            resume associations, and manage authentication settings from the service.
          </p>
        </section>

        <section>
          <h2>7. Retention</h2>
          <p>
            Kall retains personal information for as long as needed to provide the service, maintain account and
            transaction records, comply with legal obligations, resolve disputes, enforce agreements, and protect
            the service. Retention periods may vary by data type. Information may remain in backups for a limited
            period after deletion from active systems.
          </p>
        </section>

        <section>
          <h2>8. Security</h2>
          <p>
            Kall uses administrative, technical, and organizational safeguards designed to protect personal
            information. These may include encryption, access controls, secure authentication, hashed passwords,
            encrypted sensitive fields, passkeys, authenticator-app verification, logging, and restricted database
            access. No method of storage or transmission is completely secure, so absolute security cannot be guaranteed.
          </p>
        </section>

        <section>
          <h2>9. International processing</h2>
          <p>
            Kall and its service providers may process information in countries other than the user’s country of
            residence. Those countries may have different data-protection laws. Where required, Kall will use
            appropriate safeguards for international transfers.
          </p>
        </section>

        <section>
          <h2>10. Privacy rights</h2>
          <p>
            Depending on location, users may have rights to access, correct, delete, restrict, object to, or obtain
            a copy of personal information, and to withdraw consent where processing relies on consent. Certain
            information may be retained when required by law or for legitimate security, fraud-prevention, accounting,
            or dispute-resolution purposes.
          </p>
          <p>
            Requests may be submitted through the account settings or the support contact published within the service.
            Kall may need to verify the requester’s identity before completing a request.
          </p>
        </section>

        <section>
          <h2>11. California privacy notice</h2>
          <p>
            California residents may have rights under applicable California privacy law, including rights to know,
            access, correct, or delete certain personal information and to receive information about disclosures.
            Kall does not sell personal information for money and does not knowingly use personal information for
            cross-context behavioral advertising.
          </p>
        </section>

        <section>
          <h2>12. Children</h2>
          <p>
            Kall is not directed to children under 13, and Kall does not knowingly collect personal information from
            children under 13. If such information is discovered, Kall will take reasonable steps to delete it.
          </p>
        </section>

        <section>
          <h2>13. Third-party services and links</h2>
          <p>
            Kall may link to job boards, employer sites, educational resources, identity providers, payment providers,
            and other third-party services. Their privacy practices are governed by their own policies, not this Policy.
          </p>
        </section>

        <section>
          <h2>14. Changes to this policy</h2>
          <p>
            Kall may update this Privacy Policy as the service changes. The revised date will appear at the top of
            the page. Material changes may also be communicated through the service or by email when appropriate.
          </p>
        </section>

        <section>
          <h2>15. Contact</h2>
          <p>
            Privacy questions and requests may be submitted through Kall’s account settings or through the support
            contact displayed in the service. Before public launch, Kall should add the legal operator name, mailing
            address, and dedicated privacy-contact email to this section.
          </p>
        </section>
      </article>
    </main>
  );
}
