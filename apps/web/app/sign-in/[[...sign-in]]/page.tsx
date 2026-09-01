import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="shell" style={{ paddingTop: 56 }}>
      <section className="section-heading" style={{ maxWidth: 960, margin: '0 auto 28px' }}>
        <div>
          <span className="eyebrow">Private alpha</span>
          <h1 style={{ marginTop: 12 }}>Return to your career workspace.</h1>
        </div>
        <p>
          Sign in with the account connected to your invitation. Your career record,
          saved roles, and application drafts remain private to you.
        </p>
      </section>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <SignIn
          appearance={{
            elements: {
              footerAction: { display: 'none' },
              footerItem: { color: '#17120e' },
            },
          }}
        />
      </div>
    </main>
  );
}
