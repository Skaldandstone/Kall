import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSSO } from '@clerk/expo';
import type { OAuthStrategy } from '@clerk/shared/types';
import { theme } from '../theme';

const PROVIDERS: { strategy: OAuthStrategy; label: string; iosOnly?: boolean }[] = [
  { strategy: 'oauth_google', label: 'Continue with Google' },
  // Apple requires this alongside any other third-party sign-in option on iOS.
  { strategy: 'oauth_apple', label: 'Continue with Apple', iosOnly: true },
];

type Props = {
  onError: (message: string) => void;
};

/** "Continue with <provider>" buttons shared by the login and register screens. */
export default function SocialSignInButtons({ onError }: Props) {
  const { startSSOFlow } = useSSO();
  const [pending, setPending] = useState<OAuthStrategy | null>(null);

  async function handlePress(strategy: OAuthStrategy) {
    onError('');
    setPending(strategy);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({ strategy });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch {
      onError('Unable to sign in. Please try again.');
    } finally {
      setPending(null);
    }
  }

  const providers = PROVIDERS.filter((provider) => !provider.iosOnly || Platform.OS === 'ios');

  return (
    <View style={styles.container}>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>
      {providers.map((provider) => (
        <Pressable
          key={provider.strategy}
          style={styles.button}
          onPress={() => void handlePress(provider.strategy)}
          disabled={pending !== null}
          accessibilityRole="button"
          accessibilityLabel={provider.label}
          accessibilityState={{ disabled: pending !== null, busy: pending === provider.strategy }}
        >
          {pending === provider.strategy ? (
            <ActivityIndicator color={theme.text} />
          ) : (
            <Text style={styles.buttonText}>{provider.label}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 20 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border },
  dividerText: { color: theme.textMuted, marginHorizontal: 12, fontSize: 13 },
  button: {
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: { color: theme.text, fontWeight: '600', fontSize: 16 },
});
