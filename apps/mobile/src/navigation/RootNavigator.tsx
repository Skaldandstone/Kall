import { ActivityIndicator, View } from 'react-native';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { theme } from '../theme';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ApplicationsScreen from '../screens/ApplicationsScreen';
import ApplicationDetailScreen from '../screens/ApplicationDetailScreen';
import MorningBriefScreen from '../screens/MorningBriefScreen';
import type { AppStackParamList, AuthStackParamList } from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.background,
    card: theme.surface,
    text: theme.text,
    border: theme.border,
    primary: theme.accent,
  },
};

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

function AppNavigator() {
  return (
    <AppStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        headerTitleStyle: { color: theme.text },
      }}
    >
      <AppStack.Screen name="Applications" component={ApplicationsScreen} options={{ headerShown: false }} />
      <AppStack.Screen
        name="ApplicationDetail"
        component={ApplicationDetailScreen}
        options={({ route }) => ({ title: route.params.role })}
      />
      <AppStack.Screen name="MorningBrief" component={MorningBriefScreen} options={{ title: 'Morning Brief' }} />
    </AppStack.Navigator>
  );
}

export default function RootNavigator() {
  const { isSignedIn, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.text} />
      </View>
    );
  }

  return <NavigationContainer theme={navTheme}>{isSignedIn ? <AppNavigator /> : <AuthNavigator />}</NavigationContainer>;
}
