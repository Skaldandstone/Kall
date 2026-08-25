import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import RootNavigator from './src/navigation/RootNavigator';

// Environment variables inside node_modules are not inlined during production
// builds, so Clerk requires the key be passed explicitly rather than read from
// process.env inside the SDK. app.config.js resolves it per environment.
const publishableKey = Constants.expoConfig?.extra?.clerkPublishableKey as string | undefined;

export default function App() {
  return (
    <SafeAreaProvider>
      {/* tokenCache is expo-secure-store backed on device and undefined on
          web, where Clerk falls back to its own storage. */}
      <ClerkProvider publishableKey={publishableKey ?? ''} tokenCache={tokenCache}>
        <RootNavigator />
      </ClerkProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
