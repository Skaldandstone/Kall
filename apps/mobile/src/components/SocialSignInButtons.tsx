import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import { theme } from '../theme';

type Props = {
  onError: (message: string) => void;
};

// This exact URI is registered in Clerk's production mobile SSO allowlist.
// Passing it explicitly keeps Expo and Clerk from choosing different defaults
// as the app moves between development clients and Play-signed builds.
const googleRedirectUrl = AuthSession.makeRedirectUri({
  scheme: 'kall',
  path: 'sso-callback',
});
const appleSignInEnabled = Constants.expoConfig?.extra?.appleSignInEnabled === true;

/** Google sign-in shared by the login and registration screens. */
export default function SocialSignInButtons({ onError }: Props) {
  const { startSSOFlow } = useSSO();
  const [pending, setPending] = useState<'google' | 'apple' | null>(null);

  async function handleGoogle() {
    onError('');
    setPending('google');
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: googleRedirectUrl,
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch {
      onError('Google sign-in could not be completed. Please try again.');
    } finally {
      setPending(null);
    }
  }

  async function handleApple() {
    onError('');
    setPending('apple');
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_apple',
        redirectUrl: googleRedirectUrl,
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch {
      onError('Apple sign-in could not be completed. Please try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.dividerRow} accessibilityElementsHidden>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => void handleGoogle()}
        disabled={pending !== null}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        accessibilityHint="Opens Google sign-in in a secure browser"
        accessibilityState={{ disabled: pending !== null, busy: pending === 'google' }}
      >
        {pending === 'google' ? (
          <ActivityIndicator color={theme.text} />
        ) : (
          <Text style={styles.buttonText}>Continue with Google</Text>
        )}
      </Pressable>
      {Platform.OS === 'ios' && appleSignInEnabled ? (
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => void handleApple()}
          disabled={pending !== null}
          accessibilityRole="button"
          accessibilityLabel="Continue with Apple"
          accessibilityHint="Opens Apple sign-in in a secure browser"
          accessibilityState={{ disabled: pending !== null, busy: pending === 'apple' }}
        >
          {pending === 'apple' ? (
            <ActivityIndicator color={theme.text} />
          ) : (
            <Text style={styles.buttonText}>Continue with Apple</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 20 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border },
  dividerText: { color: theme.textMuted, marginHorizontal: 12, fontSize: 13 },
  button: {
    minHeight: 48,
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  buttonPressed: { opacity: 0.78 },
  buttonText: { color: theme.text, fontWeight: '600', fontSize: 16 },
});
