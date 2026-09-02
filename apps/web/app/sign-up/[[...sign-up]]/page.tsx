import { SignUp } from '@clerk/nextjs';

// Same flag the middleware gates on, so the copy can never claim one access model
// while the runtime enforces the other.
const inviteOnly = process.env.ALPHA_INVITE_ONLY === 'true';

export default function SignUpPage() {
  return (
    <main className="shell" style={{ paddingTop: 56 }}>
      <section className="section-heading" style={{ maxWidth: 960, margin: '0 auto 28px' }}>
        <div>
          <span className="eyebrow">{inviteOnly ? 'Private alpha invitation' : 'Create your account'}</span>
          <h1 style={{ marginTop: 12 }}>Build your career record with Kall.</h1>
        </div>
        <p>
          {inviteOnly
            ? 'Your invitation gives you access to an early product. Expect active development, review every generated suggestion, and tell us when the workflow feels unclear.'
            : 'Kall is an early product under active development. Review every generated suggestion, and tell us when the workflow feels unclear.'}
        </p>
      </section>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <SignUp appearance={{ elements: { footerItem: { color: '#17120e' } } }} />
      </div>
    </main>
  );
}
