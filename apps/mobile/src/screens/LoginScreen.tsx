import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSignIn } from '@clerk/expo';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { BrandMark } from '../components/ui';
import { theme } from '../theme';
import SocialSignInButtons from '../components/SocialSignInButtons';
import type { AuthStackParamList } from '../navigation/types';
import { elevation, radius } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

const GENERIC_ERROR = 'Unable to sign in. Please try again.';
const allowRegistration = Constants.expoConfig?.extra?.allowRegistration === true;

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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <LinearGradient accessible={false} pointerEvents="none" colors={['#17243a', theme.background, theme.background]} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />
      <View accessible={false} pointerEvents="none" style={styles.glow} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <View style={styles.brandRow}><BrandMark /><View><Text accessibilityRole="header" style={styles.title}>Kall</Text><Text style={styles.kicker}>Career command center</Text></View></View>
      <View style={styles.authCard}>
      <Text accessibilityRole="header" style={styles.formTitle}>{awaitingCode ? 'Confirm this device' : 'Welcome back'}</Text>
      <Text style={styles.subtitle}>
        {awaitingCode
          ? `Enter the code we sent to ${email.trim()} to confirm this device.`
          : 'Sign in to your career workspace.'}
      </Text>
      {!allowRegistration && !awaitingCode ? (
        <Text style={styles.inviteNote}>Invite-only alpha. Sign in with the email address that received your invitation.</Text>
      ) : null}

      {awaitingCode ? (
        <TextInput
          style={styles.input}
          placeholder="Verification code"
          placeholderTextColor={theme.textMuted}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          accessibilityLabel="Verification code"
          returnKeyType="done"
          onSubmitEditing={() => void handleCode()}
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
            autoComplete="email"
            textContentType="emailAddress"
            accessibilityLabel="Email address"
            returnKeyType="next"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={theme.textMuted}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            accessibilityLabel="Password"
            returnKeyType="done"
            onSubmitEditing={() => void handlePassword()}
            value={password}
            onChangeText={setPassword}
          />
        </>
      )}

      {error ? <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text> : null}

      <Pressable
        style={styles.button}
        onPress={awaitingCode ? handleCode : handlePassword}
        disabled={submitting || !signIn}
        accessibilityRole="button"
        accessibilityLabel={awaitingCode ? 'Verify this device' : 'Sign in to Kall'}
        accessibilityState={{ disabled: submitting || !signIn, busy: submitting }}
      >
        {submitting ? (
          <ActivityIndicator color={theme.accentInk} />
        ) : (
          <Text style={styles.buttonText}>{awaitingCode ? 'Verify device' : 'Sign in'}</Text>
        )}
      </Pressable>

      {!awaitingCode ? <SocialSignInButtons onError={setError} /> : null}

      {allowRegistration ? (
        <Pressable
          onPress={() => navigation.navigate('Register')}
          accessibilityRole="link"
          accessibilityLabel="Create a Kall account"
          hitSlop={10}
        >
          <Text style={styles.link}>Need an account? Create one</Text>
        </Pressable>
      ) : null}
      </View>
      <Text style={styles.privacyNote}>Private by design · Nothing is submitted without your approval</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 52 },
  glow: { position: 'absolute', width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(216, 182, 111, 0.055)', top: -86, right: -64 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 34 },
  title: { color: theme.text, fontSize: 25, lineHeight: 29, fontWeight: '700', letterSpacing: -0.5 },
  kicker: { color: theme.textMuted, fontSize: 12, marginTop: 1, letterSpacing: 0.25 },
  authCard: { ...elevation.card, backgroundColor: 'rgba(17, 28, 43, 0.92)', borderRadius: radius.xl, padding: 22 },
  formTitle: { color: theme.text, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4, marginBottom: 6 },
  subtitle: { color: theme.textSecondary, fontSize: 15, marginBottom: 24, lineHeight: 21 },
  inviteNote: { color: theme.textSecondary, fontSize: 13, lineHeight: 19, marginTop: -10, marginBottom: 18, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: theme.accent },
  input: {
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 52,
    color: theme.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  error: { color: theme.danger, marginBottom: 12, fontSize: 14, lineHeight: 20 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: theme.accent,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  buttonText: { color: theme.accentInk, fontWeight: '700', fontSize: 16 },
  link: { color: theme.textSecondary, textAlign: 'center', marginTop: 20, fontSize: 14 },
  privacyNote: { color: theme.textMuted, textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 20, paddingHorizontal: 12 },
});
