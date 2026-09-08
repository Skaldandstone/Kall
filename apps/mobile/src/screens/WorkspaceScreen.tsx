import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useClerk } from "@clerk/expo";
import {
  fetchAccount,
  fetchCareerProfiles,
  fetchResumeStudio,
} from "../api/workspace";
import type { ProfileStackParamList } from "../navigation/types";
import { theme } from "../theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "WorkspaceHome">;

export default function WorkspaceScreen({ navigation }: Props) {
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
      title: "Notifications",
      detail: "Brief and opportunity email preferences",
      screen: "Notifications",
    },
  ];
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.eyebrow}>Workspace</Text>
      <Text style={styles.title}>{summary?.name || "Your profile"}</Text>
      {summary ? (
        <Text selectable style={styles.email}>
          {summary.email}
        </Text>
      ) : (
        <ActivityIndicator color={theme.text} />
      )}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <View style={styles.list}>
        {rows.map((row) => (
          <Pressable
            key={row.title}
            accessibilityRole="button"
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
        accessibilityRole="button"
        style={styles.signOut}
        onPress={() => void signOut()}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
      <Text style={styles.about}>
        Kall by Skald and Stone LLC · Version 1.0.4
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  eyebrow: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: { color: theme.text, fontSize: 26, fontWeight: "700", marginTop: 4 },
  email: { color: theme.textSecondary, marginTop: 5 },
  error: { color: theme.danger, marginTop: 12 },
  list: { marginTop: 24, gap: 10 },
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
  about: {
    color: theme.textMuted,
    textAlign: "center",
    fontSize: 12,
    marginTop: 24,
  },
});
