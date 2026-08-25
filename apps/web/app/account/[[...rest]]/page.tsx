import { UserProfile } from '@clerk/nextjs';

// Passkeys, authenticator-app 2FA and connected accounts all live here now --
// this replaces the hand-rolled /security-setup panel.
export default function AccountPage() {
  return (
    <main className="shell" style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
      <UserProfile routing="path" path="/account" />
    </main>
  );
}
