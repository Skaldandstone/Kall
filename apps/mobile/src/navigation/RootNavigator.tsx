import { ActivityIndicator, View, useWindowDimensions } from "react-native";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useAuth } from "@clerk/expo";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";
import NavigationIcon from "../components/NavigationIcon";
import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import ApplicationsScreen from "../screens/ApplicationsScreen";
import ApplicationDetailScreen from "../screens/ApplicationDetailScreen";
import InterviewPrepScreen from "../screens/InterviewPrepScreen";
import TailoringScreen from "../screens/TailoringScreen";
import OpportunitiesScreen from "../screens/OpportunitiesScreen";
import OpportunityDetailScreen from "../screens/OpportunityDetailScreen";
import GrowthScreen from "../screens/GrowthScreen";
import MorningBriefScreen from "../screens/MorningBriefScreen";
import WorkspaceScreen from "../screens/WorkspaceScreen";
import IdentityScreen from "../screens/IdentityScreen";
import CareerProfilesScreen from "../screens/CareerProfilesScreen";
import ResumesScreen from "../screens/ResumesScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import ConsultingScreen from "../screens/ConsultingScreen";
import BillingScreen from "../screens/BillingScreen";
import RecordScreen from "../screens/RecordScreen";
import RecordResourceScreen from "../screens/RecordResourceScreen";
import AchievementsScreen from "../screens/AchievementsScreen";
import SensitiveDetailsScreen from "../screens/SensitiveDetailsScreen";
import SourcesScreen from "../screens/SourcesScreen";
import CareerPageScreen from "../screens/CareerPageScreen";
import TestimonialsScreen from "../screens/TestimonialsScreen";
import DocumentsScreen from "../screens/DocumentsScreen";
import DeleteAccountScreen from "../screens/DeleteAccountScreen";
import { RECORD_SCHEMAS } from "../lib/recordSchema";
import type {
  ApplicationsStackParamList,
  AppTabParamList,
  AuthStackParamList,
  OpportunitiesStackParamList,
  ProfileStackParamList,
} from "./types";

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const ApplicationsStack =
  createNativeStackNavigator<ApplicationsStackParamList>();
const OpportunitiesStack =
  createNativeStackNavigator<OpportunitiesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const Tab = createBottomTabNavigator<AppTabParamList>();
const allowRegistration =
  Constants.expoConfig?.extra?.allowRegistration === true;

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
      {allowRegistration ? (
        <AuthStack.Screen name="Register" component={RegisterScreen} />
      ) : null}
    </AuthStack.Navigator>
  );
}

function ApplicationsNavigator() {
  return (
    <ApplicationsStack.Navigator screenOptions={stackScreenOptions}>
      <ApplicationsStack.Screen
        name="ApplicationsHome"
        component={ApplicationsScreen}
        options={{ headerShown: false }}
      />
      <ApplicationsStack.Screen
        name="ApplicationDetail"
        component={ApplicationDetailScreen}
        options={({ route }) => ({ title: route.params.role })}
      />
      <ApplicationsStack.Screen
        name="InterviewPrep"
        component={InterviewPrepScreen}
        options={{ title: "Interview prep", presentation: "modal" }}
      />
      <ApplicationsStack.Screen
        name="Tailoring"
        component={TailoringScreen}
        options={{ title: "Tailored resume" }}
      />
    </ApplicationsStack.Navigator>
  );
}

function OpportunitiesNavigator() {
  return (
    <OpportunitiesStack.Navigator screenOptions={stackScreenOptions}>
      <OpportunitiesStack.Screen
        name="OpportunitiesHome"
        component={OpportunitiesScreen}
        options={{ headerShown: false }}
      />
      <OpportunitiesStack.Screen
        name="OpportunityDetail"
        component={OpportunityDetailScreen}
        options={{ title: "Job match" }}
      />
      <OpportunitiesStack.Screen
        name="Consulting"
        component={ConsultingScreen}
        options={{ headerShown: false }}
      />
    </OpportunitiesStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={stackScreenOptions}>
      <ProfileStack.Screen
        name="WorkspaceHome"
        component={WorkspaceScreen}
        options={{ headerShown: false }}
      />
      <ProfileStack.Screen
        name="Identity"
        component={IdentityScreen}
        options={{ title: "Personal details" }}
      />
      <ProfileStack.Screen
        name="CareerProfiles"
        component={CareerProfilesScreen}
        options={{ title: "Career profiles" }}
      />
      <ProfileStack.Screen
        name="Resumes"
        component={ResumesScreen}
        options={{ title: "Resumes" }}
      />
      <ProfileStack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: "Notifications" }}
      />
      <ProfileStack.Screen
        name="Billing"
        component={BillingScreen}
        options={{ title: "Plan and billing" }}
      />
      <ProfileStack.Screen
        name="Record"
        component={RecordScreen}
        options={{ title: "Professional record" }}
      />
      <ProfileStack.Screen
        name="RecordResource"
        component={RecordResourceScreen}
        options={({ route }) => ({ title: RECORD_SCHEMAS[route.params.resource]?.label ?? "Record" })}
      />
      <ProfileStack.Screen
        name="Achievements"
        component={AchievementsScreen}
        options={{ title: "Achievements" }}
      />
      <ProfileStack.Screen
        name="SensitiveDetails"
        component={SensitiveDetailsScreen}
        options={{ title: "Sensitive details" }}
      />
      <ProfileStack.Screen
        name="Sources"
        component={SourcesScreen}
        options={{ title: "Boards and monitoring" }}
      />
      <ProfileStack.Screen
        name="CareerPage"
        component={CareerPageScreen}
        options={{ title: "Public career page" }}
      />
      <ProfileStack.Screen
        name="Testimonials"
        component={TestimonialsScreen}
        options={{ title: "Testimonials" }}
      />
      <ProfileStack.Screen
        name="Documents"
        component={DocumentsScreen}
        options={{ title: "Generated documents" }}
      />
      <ProfileStack.Screen
        name="DeleteAccount"
        component={DeleteAccountScreen}
        options={{ title: "Delete account" }}
      />
    </ProfileStack.Navigator>
  );
}

function tabIcon(name: "today" | "work" | "apply" | "growth" | "profile") {
  return ({ color }: { color: string }) => (
    <NavigationIcon name={name} color={color} />
  );
}

function AppNavigator() {
  const { fontScale, width } = useWindowDimensions();
  const compact = width < 390 || fontScale > 1.1;
  // Edge-to-edge Android draws the system navigation bar over the app, and
  // on tablets with three-button navigation that bar is tall enough to
  // cover the tab labels entirely. Grow the bar by the bottom inset so the
  // tabs sit above it instead of under it.
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      initialRouteName="BriefTab"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.backgroundSoft,
          borderTopColor: theme.border,
          borderTopWidth: 0,
          height: (compact ? 70 : 76) + insets.bottom,
          paddingTop: 9,
          paddingBottom: 8 + insets.bottom,
          shadowColor: "#000000",
          shadowOpacity: 0.24,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: -5 },
          elevation: 10,
        },
        tabBarItemStyle: { minHeight: 52 },
        tabBarLabelStyle: { fontSize: compact ? 10 : 11, fontWeight: "600", letterSpacing: 0.05 },
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
      }}
    >
      <Tab.Screen
        name="BriefTab"
        component={MorningBriefScreen}
        options={{
          title: "Today",
          tabBarAccessibilityLabel: "Today",
          tabBarIcon: tabIcon("today"),
        }}
      />
      <Tab.Screen
        name="OpportunitiesTab"
        component={OpportunitiesNavigator}
        options={{
          title: "Work",
          tabBarAccessibilityLabel: "Job search and consulting",
          tabBarIcon: tabIcon("work"),
          popToTopOnBlur: true,
        }}
      />
      <Tab.Screen
        name="ApplicationsTab"
        component={ApplicationsNavigator}
        options={{
          title: "Apply",
          tabBarAccessibilityLabel: "Applications",
          tabBarIcon: tabIcon("apply"),
          popToTopOnBlur: true,
        }}
      />
      <Tab.Screen
        name="GrowthTab"
        component={GrowthScreen}
        options={{
          title: "Growth",
          tabBarAccessibilityLabel: "Growth",
          tabBarIcon: tabIcon("growth"),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileNavigator}
        options={{
          title: "Profile",
          tabBarAccessibilityLabel: "Profile",
          tabBarIcon: tabIcon("profile"),
          popToTopOnBlur: true,
        }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator
          color={theme.text}
          accessibilityLabel="Loading Kall"
        />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {isSignedIn ? <AppNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
