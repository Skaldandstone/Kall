import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSSO } from '@clerk/expo';
import { theme } from '../theme';

type Props = {
  onError: (message: string) => void;
};

/** Google sign-in shared by the login and registration screens. */
export default function SocialSignInButtons({ onError }: Props) {
  const { startSSOFlow } = useSSO();
  const [pending, setPending] = useState(false);

  async function handleGoogle() {
    onError('');
    setPending(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({ strategy: 'oauth_google' });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch {
      onError('Google sign-in could not be completed. Please try again.');
    } finally {
      setPending(false);
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
        disabled={pending}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        accessibilityHint="Opens Google sign-in in a secure browser"
        accessibilityState={{ disabled: pending, busy: pending }}
      >
        {pending ? (
          <ActivityIndicator color={theme.text} />
        ) : (
          <Text style={styles.buttonText}>Continue with Google</Text>
        )}
      </Pressable>
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
  },
  buttonPressed: { opacity: 0.78 },
  buttonText: { color: theme.text, fontWeight: '600', fontSize: 16 },
});
