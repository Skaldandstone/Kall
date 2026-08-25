import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <main className="shell" style={{ display: 'flex', justifyContent: 'center', paddingTop: 70 }}>
      <SignUp />
    </main>
  );
}
