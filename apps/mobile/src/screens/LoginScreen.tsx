import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSignIn } from '@clerk/expo';
import { theme } from '../theme';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

const GENERIC_ERROR = 'Unable to sign in. Please try again.';

export default function LoginScreen({ navigation }: Props) {
  // @clerk/expo v4 exposes the signals API: methods resolve to { error } rather
  // than throwing, and progress is read off signIn.status afterwards.
  const { signIn } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // Clerk asks for an emailed code when it does not yet trust this device
  // (needs_client_trust) or when the account has email as a second factor.
  // Both land the user on the same code entry step.
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /** Advance past whatever state the sign-in landed in, or explain the stall. */
  async function settle() {
    if (!signIn) return;
    if (signIn.status === 'complete') {
      await signIn.finalize();
      return;
    }
    if (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') {
      const { error: sendError } = await signIn.emailCode.sendCode();
      if (sendError) {
        setError(sendError.longMessage ?? sendError.message);
        return;
      }
      setAwaitingCode(true);
      return;
    }
    setError('This account needs another step Kall cannot complete on mobile yet. Please sign in on the website.');
  }

  async function handlePassword() {
    if (!signIn) return;
    setError('');
    setSubmitting(true);
    try {
      const { error: signInError } = await signIn.password({
        identifier: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.longMessage ?? signInError.message ?? GENERIC_ERROR);
        return;
      }
      await settle();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCode() {
    if (!signIn) return;
    setError('');
    setSubmitting(true);
    try {
      const { error: codeError } = await signIn.emailCode.verifyCode({ code: code.trim() });
      if (codeError) {
        setError(codeError.longMessage ?? codeError.message ?? 'That code was not accepted.');
        return;
      }
      await settle();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Kall</Text>
      <Text style={styles.subtitle}>
        {awaitingCode
          ? `Enter the code we sent to ${email.trim()} to confirm this device.`
          : 'Sign in to your career workspace.'}
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
        onPress={awaitingCode ? handleCode : handlePassword}
        disabled={submitting || !signIn}
      >
        {submitting ? (
          <ActivityIndicator color={theme.accentInk} />
        ) : (
          <Text style={styles.buttonText}>{awaitingCode ? 'Verify device' : 'Sign in'}</Text>
        )}
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Register')}>
        <Text style={styles.link}>Need an account? Create one</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background, padding: 24, justifyContent: 'center' },
  title: { color: theme.text, fontSize: 32, fontWeight: '700', marginBottom: 4 },
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
