import { useEffect, useRef } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { compareVersions } from './UpdatePrompt';

const API_BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'http://10.0.2.2:8000/api';
const PLAY_TEST_URL = 'https://play.google.com/apps/testing/com.skaldandstone.kall';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.skaldandstone.kall';
const TRUSTED_UPDATE_URLS = new Set([PLAY_TEST_URL, PLAY_STORE_URL]);

type MobileRelease = {
  platform: 'android';
  latestVersion: string;
  updateUrl: string;
};

function isRelease(value: unknown): value is MobileRelease {
  if (!value || typeof value !== 'object') return false;
  const release = value as Partial<MobileRelease>;
  return (
    release.platform === 'android' &&
    typeof release.latestVersion === 'string' &&
    /^\d+\.\d+\.\d+$/.test(release.latestVersion) &&
    typeof release.updateUrl === 'string' &&
    TRUSTED_UPDATE_URLS.has(release.updateUrl)
  );
}

export default function UpdatePrompt() {
  const activeCheck = useRef(false);
  const promptedVersion = useRef('');

  useEffect(() => {
    const installedVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '';
    if (!installedVersion) return;
    let disposed = false;
    let controller: AbortController | null = null;

    async function checkForUpdate() {
      if (activeCheck.current) return;
      activeCheck.current = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 5000);
      try {
        const response = await fetch(`${API_BASE_URL}/mobile-release?installed=${encodeURIComponent(installedVersion)}&t=${Date.now()}`, {
          headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
          signal: controller.signal,
        });
        if (!response.ok) return;

        const release: unknown = await response.json();
        if (disposed || !isRelease(release) || compareVersions(installedVersion, release.latestVersion) >= 0 || promptedVersion.current === release.latestVersion) {
          return;
        }
        promptedVersion.current = release.latestVersion;

        Alert.alert(
          'Kall update available',
          `Version ${release.latestVersion} is ready. Update through Google Play to get the latest fixes.`,
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Update', onPress: () => void Linking.openURL(release.updateUrl) },
          ],
          { cancelable: true },
        );
      } catch {
        // Advisory only: an unavailable check must never block the app.
      } finally {
        clearTimeout(timeout);
        activeCheck.current = false;
      }
    }

    void checkForUpdate();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkForUpdate();
    });
    return () => {
      disposed = true;
      subscription.remove();
      controller?.abort();
    };
  }, []);

  return null;
}
