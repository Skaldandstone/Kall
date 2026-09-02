import { SignIn } from '@clerk/nextjs';

// Same flag the middleware gates on, so the copy can never claim one access model
// while the runtime enforces the other.
const inviteOnly = process.env.ALPHA_INVITE_ONLY === 'true';

export default function SignInPage() {
  return (
    <main className="shell" style={{ paddingTop: 56 }}>
      <section className="section-heading" style={{ maxWidth: 960, margin: '0 auto 28px' }}>
        <div>
          <span className="eyebrow">{inviteOnly ? 'Private alpha' : 'Welcome back'}</span>
          <h1 style={{ marginTop: 12 }}>Return to your career workspace.</h1>
        </div>
        <p>
          {inviteOnly
            ? 'Sign in with the account connected to your invitation. Your career record, saved roles, and application drafts remain private to you.'
            : 'Sign in to pick up where you left off. Your career record, saved roles, and application drafts remain private to you.'}
        </p>
      </section>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <SignIn
          appearance={{
            elements: {
              // Invite-only has no self-service path, so the "Sign up" footer link is a
              // dead end; once sign-up is public it becomes the obvious next step.
              ...(inviteOnly ? { footerAction: { display: 'none' } } : {}),
              footerItem: { color: '#17120e' },
            },
          }}
        />
      </div>
    </main>
  );
}
