import KallMark from '../components/KallMark';

export const metadata = {
  title: 'Private alpha',
};

export default function AlphaPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Kall home"><KallMark />Kall</a>
        <a href="/sign-in">Log in</a>
      </header>
      <section className="hero" style={{ maxWidth: 820 }}>
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
      </section>
    </main>
  );
}
