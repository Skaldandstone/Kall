import { ActivityIndicator, Text, View } from 'react-native';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '@clerk/expo';
import Constants from 'expo-constants';
import { theme } from '../theme';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ApplicationsScreen from '../screens/ApplicationsScreen';
import ApplicationDetailScreen from '../screens/ApplicationDetailScreen';
import InterviewPrepScreen from '../screens/InterviewPrepScreen';
import OpportunitiesScreen from '../screens/OpportunitiesScreen';
import GrowthScreen from '../screens/GrowthScreen';
import MorningBriefScreen from '../screens/MorningBriefScreen';
import ProfileScreen from '../screens/ProfileScreen';
import type { ApplicationsStackParamList, AppTabParamList, AuthStackParamList, OpportunitiesStackParamList } from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const ApplicationsStack = createNativeStackNavigator<ApplicationsStackParamList>();
const OpportunitiesStack = createNativeStackNavigator<OpportunitiesStackParamList>();
const Tab = createBottomTabNavigator<AppTabParamList>();
const allowRegistration = Constants.expoConfig?.extra?.allowRegistration === true;

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

const stackScreenOptions = {
  headerStyle: { backgroundColor: theme.surface },
  headerTintColor: theme.text,
  headerTitleStyle: { color: theme.text },
} as const;

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      {allowRegistration ? <AuthStack.Screen name="Register" component={RegisterScreen} /> : null}
    </AuthStack.Navigator>
  );
}

function ApplicationsNavigator() {
  return (
    <ApplicationsStack.Navigator screenOptions={stackScreenOptions}>
      <ApplicationsStack.Screen name="ApplicationsHome" component={ApplicationsScreen} options={{ headerShown: false }} />
      <ApplicationsStack.Screen
        name="ApplicationDetail"
        component={ApplicationDetailScreen}
        options={({ route }) => ({ title: route.params.role })}
      />
      <ApplicationsStack.Screen
        name="InterviewPrep"
        component={InterviewPrepScreen}
        options={{ title: 'Interview prep', presentation: 'modal' }}
      />
    </ApplicationsStack.Navigator>
  );
}

function OpportunitiesNavigator() {
  return (
    <OpportunitiesStack.Navigator screenOptions={stackScreenOptions}>
      <OpportunitiesStack.Screen name="OpportunitiesHome" component={OpportunitiesScreen} options={{ headerShown: false }} />
    </OpportunitiesStack.Navigator>
  );
}

function tabIcon(symbol: string) {
  return ({ color }: { color: string }) => <Text style={{ color, fontSize: 18 }}>{symbol}</Text>;
}

function AppNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
      }}
    >
      <Tab.Screen
        name="ApplicationsTab"
        component={ApplicationsNavigator}
        options={{ title: 'Applications', tabBarIcon: tabIcon('✓') }}
      />
      <Tab.Screen
        name="OpportunitiesTab"
        component={OpportunitiesNavigator}
        options={{ title: 'Opportunities', tabBarIcon: tabIcon('☀') }}
      />
      <Tab.Screen
        name="GrowthTab"
        component={GrowthScreen}
        options={{ title: 'Growth', tabBarIcon: tabIcon('↑') }}
      />
      <Tab.Screen
        name="BriefTab"
        component={MorningBriefScreen}
        options={{ title: 'Brief', tabBarIcon: tabIcon('☆') }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{ title: 'Profile', tabBarIcon: tabIcon('●') }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.text} accessibilityLabel="Loading Kall" />
      </View>
    );
  }

  return <NavigationContainer theme={navTheme}>{isSignedIn ? <AppNavigator /> : <AuthNavigator />}</NavigationContainer>;
}
