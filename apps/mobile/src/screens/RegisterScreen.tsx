import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useClerk, useSignUp } from '@clerk/expo';
import { theme } from '../theme';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export default function RegisterScreen({ navigation }: Props) {
  // @clerk/expo v4 exposes the signals API: methods resolve to { error }
  // rather than throwing, and progress is read off signUp.status afterwards.
  const { signUp } = useSignUp();
  const clerk = useClerk();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // Clerk verifies the email address before the account becomes usable, so
  // registration is two steps rather than one. This flag is what separates
  // them.
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /**
   * Names are not collected during sign-up: whether Clerk accepts first/last
   * name at all is an instance setting, and rejecting the whole registration
   * over it would be the wrong trade. Set it on the user once the session
   * exists instead, and let it go if the instance has name disabled -- the
   * backend falls back to the email address for the display name.
   */
  async function saveName() {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (!parts.length || !clerk.user) return;
    try {
      await clerk.user.update({
        firstName: parts[0],
        lastName: parts.slice(1).join(' ') || undefined,
      });
    } catch {
      // Instance has name attributes disabled; nothing the user can act on.
    }
  }

  async function handleCreate() {
    if (!signUp) return;
    setError('');
    setSubmitting(true);
    try {
      const { error: signUpError } = await signUp.password({
        emailAddress: email.trim(),
        password,
      });
      if (signUpError) {
        setError(signUpError.longMessage ?? signUpError.message);
        return;
      }
      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) {
        setError(sendError.longMessage ?? sendError.message);
        return;
      }
      setAwaitingCode(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify() {
    if (!signUp) return;
    setError('');
    setSubmitting(true);
    try {
      const { error: codeError } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (codeError) {
        setError(codeError.longMessage ?? codeError.message);
        return;
      }
      if (signUp.status === 'complete') {
        await signUp.finalize();
        await saveName();
        return;
      }
      setError('Your account still needs something Kall cannot collect here. Please finish signing up on the website.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create your account</Text>
      <Text style={styles.subtitle}>
        {awaitingCode
          ? `Enter the 6-digit code we sent to ${email.trim()}.`
          : 'Track applications, tailor resumes, and get a daily brief.'}
      </Text>

      {awaitingCode ? (
        <TextInput
          style={styles.input}
          placeholder="Verification code"
          placeholderTextColor={theme.textMuted}
          keyboardType="number-pad"
          value={code}
          onChangeText={setCode}
        />
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor={theme.textMuted}
            value={fullName}
            onChangeText={setFullName}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={theme.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={styles.button}
        onPress={awaitingCode ? handleVerify : handleCreate}
        disabled={submitting || !signUp}
      >
        {submitting ? (
          <ActivityIndicator color={theme.accentInk} />
        ) : (
          <Text style={styles.buttonText}>{awaitingCode ? 'Verify email' : 'Create account'}</Text>
        )}
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Login')}>
        <Text style={styles.link}>Already have an account? Sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background, padding: 24, justifyContent: 'center' },
  title: { color: theme.text, fontSize: 28, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: theme.textSecondary, fontSize: 15, marginBottom: 32, lineHeight: 21 },
  input: {
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    color: theme.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  error: { color: theme.danger, marginBottom: 12, fontSize: 14, lineHeight: 20 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: theme.accentInk, fontWeight: '700', fontSize: 16 },
  link: { color: theme.textSecondary, textAlign: 'center', marginTop: 20, fontSize: 14 },
});
