import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useClerk } from "@clerk/expo";
import Constants from "expo-constants";
import {
  fetchAccount,
  fetchCareerProfiles,
  fetchResumeStudio,
} from "../api/workspace";
import type { ProfileStackParamList } from "../navigation/types";
import { WEB_BASE_URL } from "../lib/web";
import { theme } from "../theme";
import { Card, PageHeader, StatusMessage } from "../components/ui";

type Props = NativeStackScreenProps<ProfileStackParamList, "WorkspaceHome">;

export default function WorkspaceScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { signOut } = useClerk();
  const [summary, setSummary] = useState<{
    name: string;
    email: string;
    profiles: number;
    resumes: number;
  } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [account, profiles, studio] = await Promise.all([
        fetchAccount(),
        fetchCareerProfiles(),
        fetchResumeStudio(),
      ]);
      setSummary({
        name: account.full_name,
        email: account.email,
        profiles: profiles.profiles.length,
        resumes: studio.resumes.length,
      });
      setError("");
    } catch {
      setError("Unable to refresh your workspace.");
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const rows: Array<{
    title: string;
    detail: string;
    screen: keyof ProfileStackParamList;
  }> = [
    {
      title: "Personal details",
      detail: "Contact details and professional summary",
      screen: "Identity",
    },
    {
      title: "Career profiles",
      detail: `${summary?.profiles ?? 0} search direction${summary?.profiles === 1 ? "" : "s"}`,
      screen: "CareerProfiles",
    },
    {
      title: "Resumes",
      detail: `${summary?.resumes ?? 0} document${summary?.resumes === 1 ? "" : "s"} in your library`,
      screen: "Resumes",
    },
    {
      title: "Professional record",
      detail: "Employment, education, skills, achievements, references",
      screen: "Record",
    },
    {
      title: "Sensitive details",
      detail: "Work authorization, self-identification, autofill consent",
      screen: "SensitiveDetails",
    },
    {
      title: "Boards and monitoring",
      detail: "Company job boards, scheduled searches, hidden results",
      screen: "Sources",
    },
    {
      title: "Public career page",
      detail: "The page you can share instead of a resume",
      screen: "CareerPage",
    },
    {
      title: "Testimonials",
      detail: "Ask people to vouch for you; choose where it shows",
      screen: "Testimonials",
    },
    {
      title: "Generated documents",
      detail: "Every tailored resume Kall has produced",
      screen: "Documents",
    },
    {
      title: "Notifications",
      detail: "Brief and opportunity email preferences",
      screen: "Notifications",
    },
    {
      title: "Plan and billing",
      detail: "Subscription, upgrades, and purchase restoration",
      screen: "Billing",
    },
  ];
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
      contentInsetAdjustmentBehavior="automatic"
    >
      <PageHeader eyebrow="Workspace" title={summary?.name || "Your profile"} description={summary?.email} />
      {!summary ? <ActivityIndicator color={theme.text} accessibilityLabel="Loading profile" /> : null}
      {error ? (
        <StatusMessage kind="error">{error}</StatusMessage>
      ) : null}
      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}><Text style={styles.summaryValue}>{summary?.profiles ?? 0}</Text><Text style={styles.summaryLabel}>Search directions</Text></Card>
        <Card style={styles.summaryCard}><Text style={styles.summaryValue}>{summary?.resumes ?? 0}</Text><Text style={styles.summaryLabel}>Documents</Text></Card>
      </View>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Manage your workspace</Text>
      <View style={styles.list}>
        {rows.map((row) => (
          <Pressable
            key={row.title}
            accessibilityRole="button"
            accessibilityLabel={`${row.title}. ${row.detail}`}
            accessibilityHint="Opens this workspace setting"
            style={styles.row}
            onPress={() => navigation.navigate(row.screen as never)}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowDetail}>{row.detail}</Text>
            </View>
            <Text accessible={false} style={styles.chevron}>
              ›
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Sign-in and security. Email address, password, two-step verification, connected accounts"
        accessibilityHint="Opens your Kall account settings in your browser"
        style={styles.row}
        onPress={() => void Linking.openURL(`${WEB_BASE_URL}/account`).catch(() => undefined)}
      >
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>Sign-in and security</Text>
          <Text style={styles.rowDetail}>Email, password, two-step verification, connected accounts</Text>
        </View>
        <Text accessible={false} style={styles.chevron}>
          ↗
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Get help. Email support, privacy requests, and security reports"
        accessibilityHint="Opens Kall support in your browser"
        style={styles.row}
        onPress={() => void Linking.openURL(`${WEB_BASE_URL}/support`).catch(() => undefined)}
      >
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>Get help</Text>
          <Text style={styles.rowDetail}>Email support, privacy requests, security reports</Text>
        </View>
        <Text accessible={false} style={styles.chevron}>
          ↗
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.signOut}
        onPress={() => void signOut()}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the account deletion screen"
        style={styles.deleteLink}
        onPress={() => navigation.navigate("DeleteAccount")}
      >
        <Text style={styles.deleteLinkText}>Delete my account</Text>
      </Pressable>
      <Text style={styles.about}>
        Kall by Skald and Stone LLC · Version {Constants.expoConfig?.version ?? "unknown"}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingBottom: 48 },
  eyebrow: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: { color: theme.text, fontSize: 26, fontWeight: "700", marginTop: 4 },
  email: { color: theme.textSecondary, marginTop: 5 },
  error: { color: theme.danger, marginTop: 12 },
  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  summaryCard: { flex: 1, padding: 14 },
  summaryValue: { color: theme.accent, fontSize: 24, fontWeight: "800" },
  summaryLabel: { color: theme.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 },
  sectionTitle: { color: theme.text, fontSize: 17, fontWeight: "800" },
  list: { marginTop: 12, gap: 10 },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  rowCopy: { flex: 1 },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
  rowDetail: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  chevron: { color: theme.textMuted, fontSize: 28, marginLeft: 12 },
  signOut: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 24,
  },
  signOutText: { color: theme.text, fontWeight: "700" },
  deleteLink: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  deleteLinkText: { color: theme.danger, fontWeight: "600", fontSize: 13 },
  about: {
    color: theme.textMuted,
    textAlign: "center",
    fontSize: 12,
    marginTop: 24,
  },
});
