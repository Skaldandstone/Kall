import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="shell" style={{ display: 'flex', justifyContent: 'center', paddingTop: 70 }}>
      <SignIn />
    </main>
  );
}
