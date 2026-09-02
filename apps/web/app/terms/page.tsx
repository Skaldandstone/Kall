import type { Metadata } from 'next';
import KallMark from '../components/KallMark';
import { LegalEmail, LegalValue } from '../components/LegalValue';
import { LEGAL, noticeEmail } from '../lib/legal';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The agreement between you and the operator of Kall.',
};

const updated = 'September 2, 2026';

/**
 * Every company-specific value on this page comes from app/lib/legal.ts.
 * Do not hardcode an address, a mailbox, or a refund term here -- fill it in
 * there once and it appears on every page that needs it.
 */
export default function TermsPage() {
  return (
    <main className="shell" style={{ maxWidth: 920, paddingTop: 48, paddingBottom: 72 }}>
      <a className="brand" href="/" aria-label="Kall home"><KallMark />Kall</a>
      <section className="hero" style={{ paddingTop: 48, paddingBottom: 36 }}>
        <div>
          <span className="eyebrow">Legal</span>
          <h1 style={{ fontSize: 'clamp(42px, 7vw, 72px)' }}>Terms of Service</h1>
          <p>Last updated: {updated}</p>
        </div>
      </section>

      <article className="card" style={{ marginTop: 28, display: 'grid', gap: 28, lineHeight: 1.7 }}>
        <section>
          <h2>1. Who you are agreeing with</h2>
          <p>
            Kall is operated by{' '}
            <LegalValue value={LEGAL.operatorLegalName} label="legal operator name" />, a limited
            liability company organized in{' '}
            <LegalValue value={LEGAL.entityFormationState} label="state of formation" /> (&ldquo;Kall&rdquo;,
            &ldquo;we&rdquo;, &ldquo;us&rdquo;). These Terms are the agreement between you and us for your use of
            the Kall website, applications, browser extension, and related services (the &ldquo;Service&rdquo;).
          </p>
          <p>
            By creating an account or using the Service you accept these Terms. If you do not accept
            them, do not use the Service. Our handling of personal information is described
            separately in the <a href="/privacy-policy">Privacy Policy</a>, which is part of this
            agreement.
          </p>
        </section>

        <section>
          <h2>2. Who may use Kall</h2>
          <p>
            You must be at least 18 years old, or the age of majority where you live if that is
            higher, to have a Kall account. You may only use the Service for yourself. You may not
            create an account on someone else&rsquo;s behalf without their authorization, and you may
            not share your account with another person.
          </p>
        </section>

        <section>
          <h2>3. Your account</h2>
          <p>
            Sign-in is handled by {LEGAL.authProvider}, our identity provider. You are responsible
            for keeping your sign-in method secure and for activity that happens under your account.
            Tell us promptly at <LegalEmail value={LEGAL.supportContactEmail} label="support email" />{' '}
            if you believe your account has been accessed by someone else.
          </p>
        </section>

        <section>
          <h2>4. Your content stays yours</h2>
          <p>
            Your resumes, cover letters, profile information, application materials, and anything
            else you put into Kall remain yours. You give us permission to store, process, display,
            transmit, and adapt that content only as needed to operate the Service for you and to do
            the things you ask it to do, such as tailoring a resume, autofilling an application, or
            publishing a career page you have chosen to publish. That permission ends when you
            delete the content or close your account, except for copies that persist in backups for
            a limited period as described in the Privacy Policy.
          </p>
          <p>
            You are responsible for what you put into Kall. You confirm that you have the right to
            provide it and that it is accurate. Do not upload another person&rsquo;s personal
            information unless you are entitled to, and do not upload material you do not have the
            right to use.
          </p>
        </section>

        <section>
          <h2>5. AI-generated material</h2>
          <p>
            Some Kall features use artificial intelligence to draft, tailor, score, or summarize
            content. AI output can be wrong, incomplete, or misleading. Everything Kall generates is
            a draft for you to review. You are solely responsible for the accuracy of anything you
            submit to an employer, and you should never submit a generated document you have not
            read. Kall does not warrant that generated content is accurate, original, or suitable
            for any particular application.
          </p>
        </section>

        <section>
          <h2>6. What Kall is not</h2>
          <p>
            Kall is a tool for organizing and running your own job search. Kall is not an employer,
            an employment agency, a recruiter, or a career, legal, immigration, or financial
            adviser. We do not screen employers or job postings, we do not guarantee that a posting
            is genuine or still open, and we do not promise that using Kall will lead to an
            interview or a job. Applications you submit are governed by the receiving
            employer&rsquo;s own terms and privacy practices, not ours.
          </p>
        </section>

        <section>
          <h2>7. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Misrepresent your identity, experience, credentials, or work authorization in material prepared or submitted through Kall.</li>
            <li>Use the Service to send bulk, automated, or indiscriminate applications in a way that disrupts an employer or an application system.</li>
            <li>Scrape, resell, or redistribute Kall&rsquo;s job data, match results, or other output as a competing product.</li>
            <li>Attempt to bypass plan limits, quotas, rate limits, or access controls, including by operating multiple accounts to do so.</li>
            <li>Probe, scan, or attack the Service or its infrastructure, or attempt to access another user&rsquo;s data.</li>
            <li>Upload malware, or content that is unlawful, infringing, or harassing.</li>
          </ul>
        </section>

        <section>
          <h2>8. Plans, billing, and renewal</h2>
          <p>
            Kall offers a Free plan and paid plans. Current plans and prices are shown on the{' '}
            <a href="/billing">billing page</a>, which is the authoritative list. Payments are
            processed by {LEGAL.paymentProcessor}; we do not receive or store your card number.
          </p>
          <p>
            A paid plan renews automatically at the end of each billing period, at the then-current
            price, until you cancel. Prices may change; we will give notice before a change takes
            effect for you, and a price change never applies to a period you have already paid for.
            Taxes may be added where required.
          </p>
          <p>
            If a payment fails, your paid limits continue for {LEGAL.paymentGracePeriodHours} hours
            from the first failed attempt. A retry that also fails does not restart that clock. After
            that, the account moves to the Free plan automatically. Your data is not deleted when
            this happens, but usage above Free limits is no longer available.
          </p>
        </section>

        <section>
          <h2>9. Cancellation and refunds</h2>
          <p>
            You can cancel a paid plan at any time from the billing page. Cancelling stops the next
            renewal; it does not end the period you have already paid for, and you keep paid access
            until that period ends.
          </p>
          {LEGAL.refundStance === null ? (
            <p>
              <LegalValue value={null} label="refund policy" />
            </p>
          ) : null}
          {LEGAL.refundStance === 'no-refunds-cancel-anytime' ? (
            <p>
              Payments are otherwise non-refundable, including for partial periods and for periods
              in which you did not use the Service. This does not affect any refund right you have
              under the law where you live, which we will honor where it applies.
            </p>
          ) : null}
          {LEGAL.refundStance === 'window' ? (
            <p>
              If you ask within{' '}
              <LegalValue value={LEGAL.refundWindowDays} label="refund window in days" /> days of a
              charge, we will refund that charge in full. Ask at{' '}
              <LegalEmail value={LEGAL.supportContactEmail} label="support email" />. Outside that
              window, payments are non-refundable, except where the law where you live says
              otherwise.
            </p>
          ) : null}
          {LEGAL.refundStance === 'discretionary' ? (
            <p>
              If something went wrong, write to{' '}
              <LegalEmail value={LEGAL.supportContactEmail} label="support email" /> and we will
              consider a refund case by case. Refunds outside a legal requirement are at our
              discretion, and granting one does not commit us to granting another.
            </p>
          ) : null}
          <p>
            Deleting your account also cancels a paid subscription, on the same terms as cancelling
            it yourself: the next renewal is stopped, and the period you have already paid for is
            not refunded. If you would rather keep using the paid period, cancel on the billing page
            and delete the account when it ends.
          </p>
        </section>

        <section>
          <h2>10. Closing your account</h2>
          <p>
            You can delete your account yourself from account settings by typing your email address
            to confirm. Deletion is immediate and irreversible. When you delete an account:
          </p>
          <ul>
            <li>Your profile, resumes, documents, applications, saved opportunities, notifications, billing records, and every other row belonging to you are deleted from our live systems.</li>
            <li>A paid subscription is set to stop at the end of the period you have already paid for, so it does not renew. That period is not refunded.</li>
            <li>Your sign-in identity at {LEGAL.authProvider} is deleted, and we record that the identity was closed so that an existing browser session cannot recreate the account.</li>
            <li>Our internal record of support actions taken on the account is kept, with your identifying details removed from it, so that a record of what was done and by whom survives.</li>
            <li>Copies may remain in encrypted backups for a limited period before those backups age out.</li>
            <li>A career page you published stops being served.</li>
          </ul>
          <p>
            We can also close or suspend an account that is being used in breach of these Terms, for
            fraud or abuse, or where we are required to by law. Where it is reasonable to do so we
            will tell you why and, if the problem can be fixed, give you a chance to fix it.
          </p>
        </section>

        <section>
          <h2>11. Changes to the Service</h2>
          <p>
            Kall is under active development. We may add, change, or remove features. We may
            discontinue the Service entirely; if we do, we will give reasonable advance notice to
            active accounts, stop billing, and provide a period in which you can export your data.
            We do not offer a guaranteed level of availability.
          </p>
        </section>

        <section>
          <h2>12. Disclaimers</h2>
          <p>
            The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest
            extent permitted by law we disclaim all warranties, express or implied, including
            merchantability, fitness for a particular purpose, non-infringement, and any warranty
            that the Service will be uninterrupted, secure, error-free, or that job data or match
            results will be accurate or current. Some jurisdictions do not allow these exclusions, in
            which case they do not apply to you.
          </p>
        </section>

        <section>
          <h2>13. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, neither Kall nor its owners, employees, or
            suppliers will be liable for indirect, incidental, special, consequential, or punitive
            damages, or for lost profits, lost opportunities, lost employment, or lost or corrupted
            data. Our total liability for any claim relating to the Service is limited to the
            greater of the amount you paid us in the twelve months before the claim arose, or one
            hundred United States dollars. These limits do not apply where the law does not allow
            them to.
          </p>
        </section>

        <section>
          <h2>14. Indemnity</h2>
          <p>
            You agree to indemnify and hold Kall harmless from claims, losses, and reasonable legal
            costs arising from your content, your use of the Service, or your breach of these Terms.
          </p>
        </section>

        <section>
          <h2>15. Changes to these Terms</h2>
          <p>
            We may update these Terms as the Service changes. The revised date at the top of this
            page will change. For material changes we will give notice in the Service or by email
            before they take effect, and continuing to use Kall after that date means you accept the
            revised Terms. If you do not accept them, cancel and close your account.
          </p>
        </section>

        <section>
          <h2>16. Disputes, arbitration, and class action waiver</h2>
          <p>
            <strong>
              This section affects your legal rights. It requires most disputes to be resolved by an
              individual arbitration instead of in court, and it gives up your right to a jury and to
              participate in a class action. You can opt out of it, and keep those rights, by
              telling us within {LEGAL.arbitrationOptOutDays} days.
            </strong>
          </p>

          <h3>16.1 Talk to us first</h3>
          <p>
            Before either of us starts an arbitration or a lawsuit, we each agree to try to settle
            the dispute informally. Send a written description of the problem and what you want to{' '}
            <LegalEmail value={noticeEmail()} label="legal notice email" />, and we will do the same
            to the email on your account. If it is not resolved within {LEGAL.disputeNoticeDays}{' '}
            days, either of us may proceed. This step is a real condition, not a formality; a filing
            made without it can be paused until it is met. Any deadline for bringing a claim is
            paused while this is under way.
          </p>

          <h3>16.2 Individual arbitration</h3>
          <p>
            Except for the claims described in 16.3, you and Kall agree that any dispute arising out
            of or relating to these Terms or the Service will be resolved by binding arbitration
            administered by {LEGAL.arbitrationAdministrator} under its{' '}
            {LEGAL.arbitrationRules}, before a single arbitrator. The Federal Arbitration Act
            governs the interpretation and enforcement of this section. The arbitrator decides
            questions of arbitrability, except that a court decides whether 16.4 is enforceable. An
            arbitrator can award the same individual relief a court could, and the award may be
            entered as a judgment in any court with jurisdiction.
          </p>

          <h3>16.3 What is not arbitrated</h3>
          <p>
            Either of us may bring an individual claim in small claims court if it qualifies. Either
            of us may also ask a court for an injunction to stop infringement or misuse of
            intellectual property. Nothing in this section prevents you from reporting a concern to
            a government agency, or bars relief a law makes non-waivable where you live.
          </p>

          <h3>16.4 No class actions</h3>
          <p>
            Arbitration is on an individual basis only. You and Kall each waive any right to a jury
            trial and to bring or participate in a class, collective, consolidated, or
            representative action. The arbitrator may not preside over any form of a representative
            proceeding, and may award relief only to the individual party seeking it. If this
            paragraph is found unenforceable as to a particular claim, that claim, and only that
            claim, must be brought in court, and the rest of this section still applies to
            everything else.
          </p>

          <h3>16.5 Costs and where it happens</h3>
          <p>
            The administrator&rsquo;s consumer fee schedule governs what each side pays, and Kall
            pays the portion those rules assign to a business. If arbitration would cost you more
            than filing the same claim in court, Kall will pay the difference. Unless we agree
            otherwise, hearings are held by telephone or video, or in the county where you live; you
            will not be required to travel to us. Each side pays its own legal fees unless a law or
            the rules provide otherwise.
          </p>

          <h3>16.6 How to opt out</h3>
          <p>
            You can reject this arbitration agreement, and keep your right to sue and to participate
            in a class action, by emailing{' '}
            <LegalEmail value={noticeEmail()} label="legal notice email" /> within{' '}
            {LEGAL.arbitrationOptOutDays} days of first accepting these Terms. Include your name and
            the email address on your account, and say that you are opting out of arbitration. That
            is all it takes. Opting out costs you nothing and does not affect your account, your
            plan, or anything else in these Terms. If we later change this section materially, you
            get a fresh {LEGAL.arbitrationOptOutDays} days to opt out of the change.
          </p>

          <h3>16.7 Survival</h3>
          <p>
            This section survives the end of your account and of these Terms.
          </p>
        </section>

        <section>
          <h2>17. Governing law</h2>
          <p>
            These Terms are governed by the laws of the State of{' '}
            <LegalValue value={LEGAL.governingLawState} label="governing law state" />, without
            regard to its conflict-of-laws rules. For any dispute that is not subject to arbitration
            under section 16, the state and federal courts located there have exclusive
            jurisdiction. Nothing here removes a consumer protection you have under the
            mandatory law of your own country or state.
          </p>
        </section>

        <section>
          <h2>18. General</h2>
          <p>
            If a provision of these Terms is unenforceable, the rest stays in force. Our not
            enforcing a provision is not a waiver of it. You may not assign this agreement; we may
            assign it as part of a merger, acquisition, or sale of assets. These Terms and the
            Privacy Policy are the entire agreement between us about the Service.
          </p>
        </section>

        <section>
          <h2>19. Contact</h2>
          <p>
            Support: <LegalEmail value={LEGAL.supportContactEmail} label="support email" />. See the{' '}
            <a href="/support">support page</a> for what to include and how long a reply takes.
          </p>
          <p>
            Legal notices: <LegalEmail value={noticeEmail()} label="legal notice email" />, and by
            mail to:
          </p>
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
