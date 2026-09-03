import KallMark from '../components/KallMark';

// Same flag the middleware and /sign-up gate on, so this page can never claim
// one access model while the runtime enforces the other.
const inviteOnly = process.env.ALPHA_INVITE_ONLY === 'true';

export const metadata = {
  title: inviteOnly ? 'Private alpha' : 'Create your account',
};

export default function AlphaPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Kall home"><KallMark />Kall</a>
        <a href="/sign-in">Log in</a>
      </header>
      <section className="hero" style={{ maxWidth: 820 }}>
        {inviteOnly ? (
          <>
            <span className="eyebrow">Invite-only alpha</span>
            <h1>Kall is opening carefully.</h1>
            <p>
              We are inviting a small group to test career records, role comparisons,
              resume guidance, and application review while the product is still evolving.
              If you received an invitation, use the private link in that message.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <a className="button" href="/sign-in">Log in to your workspace</a>
              <a className="button secondary" href="/demo/opportunity-intelligence">See a role comparison</a>
            </div>
            <p className="notice" style={{ marginTop: 28 }}>
              An invitation is tied to its recipient. Kall will never ask you to paste an invitation code into chat.
            </p>
          </>
        ) : (
          <>
            <span className="eyebrow">Now open</span>
            <h1>Kall is open to everyone.</h1>
            <p>
              Create a free account to keep your career record, compare roles against it, and prepare
              applications you review before anything is submitted. Kall is still under active development --
              expect frequent changes, and review every generated suggestion.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <a className="button" href="/sign-up">Create your account</a>
              <a className="button secondary" href="/demo/opportunity-intelligence">See a role comparison</a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
