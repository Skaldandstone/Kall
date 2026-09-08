import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@clerk/expo';
import Constants from 'expo-constants';
import Purchases from 'react-native-purchases';

let configuredUserId: string | null = null;

function platformApiKey(): string | undefined {
  if (Platform.OS === 'android') {
    return Constants.expoConfig?.extra?.revenueCatAndroidApiKey as string | undefined;
  }
  if (Platform.OS === 'ios') {
    return Constants.expoConfig?.extra?.revenueCatAppleApiKey as string | undefined;
  }
  return undefined;
}

export function mobilePurchasesEnabled(): boolean {
  return Constants.expoConfig?.extra?.purchasesEnabled === true && Boolean(platformApiKey());
}

export default function PurchaseBootstrap() {
  const { isLoaded, userId } = useAuth();

  useEffect(() => {
    if (!isLoaded || !userId || !mobilePurchasesEnabled()) return;
    const apiKey = platformApiKey();
    if (!apiKey) return;
    if (configuredUserId === null) {
      Purchases.configure({ apiKey, appUserID: userId });
      configuredUserId = userId;
    } else if (configuredUserId !== userId) {
      void Purchases.logIn(userId).then(() => {
        configuredUserId = userId;
      }).catch(() => {
        // The billing screen reports actionable provider failures. Authentication
        // and the rest of the app must remain available while RevenueCat retries.
      });
    }
  }, [isLoaded, userId]);

  return null;
}
