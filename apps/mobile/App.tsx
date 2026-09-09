import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import * as Sentry from '@sentry/react-native';
import RootNavigator from './src/navigation/RootNavigator';
import UpdatePrompt from './src/components/UpdatePrompt';
import PurchaseBootstrap from './src/components/PurchaseBootstrap';

// Complete Clerk's browser handoff once Google returns to the kall:// scheme.
WebBrowser.maybeCompleteAuthSession();

// Environment variables inside node_modules are not inlined during production
// builds, so Clerk requires the key be passed explicitly rather than read from
// process.env inside the SDK. app.config.js resolves it per environment.
const publishableKey = Constants.expoConfig?.extra?.clerkPublishableKey as string | undefined;
const sentryDsn = Constants.expoConfig?.extra?.sentryDsn as string | undefined;

Sentry.init({
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  environment: __DEV__ ? 'development' : 'production',
  sendDefaultPii: false,
  tracesSampleRate: __DEV__ ? 0 : 0.1,
});

function App() {
  return (
    <SafeAreaProvider>
      {/* tokenCache is expo-secure-store backed on device and undefined on
          web, where Clerk falls back to its own storage. */}
      <ClerkProvider publishableKey={publishableKey ?? ''} tokenCache={tokenCache}>
        <PurchaseBootstrap />
        <RootNavigator />
      </ClerkProvider>
      <UpdatePrompt />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(App);
