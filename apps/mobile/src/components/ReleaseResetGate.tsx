import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth, useClerk } from '@clerk/expo';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';

import { resetPurchaseSession } from './PurchaseBootstrap';
import { clearSessionTokenCache } from '../auth/sessionTokenCache';
import { theme } from '../theme';

const RELEASE_MARKER_KEY = 'kall.release.identity';

export function currentReleaseIdentity(): string {
  return [
    Application.applicationId ?? 'unknown-app',
    Application.nativeApplicationVersion ?? 'unknown-version',
    Application.nativeBuildVersion ?? 'unknown-build',
  ].join(':');
}

export default function ReleaseResetGate({ children }: PropsWithChildren) {
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const checkRelease = useCallback(async () => {
    setError('');
    setReady(false);
    if (Platform.OS === 'web') {
      setReady(true);
      return;
    }
    if (!isLoaded) return;
    try {
      const identity = currentReleaseIdentity();
      const previousIdentity = await SecureStore.getItemAsync(RELEASE_MARKER_KEY);

      const upgradedExistingInstall = previousIdentity === null && isSignedIn;
      if (upgradedExistingInstall || (previousIdentity && previousIdentity !== identity)) {
        // A native update is a security boundary. Clerk owns its encrypted
        // token cache, so signing out clears the persisted session correctly.
        // RevenueCat's app-owned customer cache is cleared separately.
        await clerk.signOut();
        await clearSessionTokenCache();
        await resetPurchaseSession();
      }

      await SecureStore.setItemAsync(RELEASE_MARKER_KEY, identity);
      setReady(true);
    } catch {
      setError(
        'Kall was updated, but the secure session refresh did not finish. Connect to the internet and try again.',
      );
    }
  }, [clerk, isLoaded, isSignedIn]);

  useEffect(() => {
    void checkRelease();
  }, [checkRelease]);

  if (ready) return children;

  return (
    <View style={styles.screen}>
      {error ? (
        <>
          <Text accessibilityRole="alert" style={styles.heading}>Refresh sign-in</Text>
          <Text style={styles.body}>{error}</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => void checkRelease()}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color={theme.accent} accessibilityLabel="Refreshing Kall after update" />
          <Text style={styles.body}>Refreshing Kall after the update…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: theme.background,
  },
  heading: { color: theme.text, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  body: { color: theme.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 14 },
  button: {
    minHeight: 48,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: theme.accent,
    marginTop: 22,
  },
  buttonText: { color: theme.accentInk, fontWeight: '700' },
});
