import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import Ionicons from "@expo/vector-icons/Ionicons";
import { fetchAchievements, fetchReadiness, fetchRecords, type Readiness } from "../api/record";
import { RECORD_RESOURCES, RECORD_SCHEMAS } from "../lib/recordSchema";
import type { ProfileStackParamList } from "../navigation/types";
import { theme } from "../theme";
import { formStyles } from "../components/form";

type Props = NativeStackScreenProps<ProfileStackParamList, "Record">;

const SECTION_LABELS: Record<string, string> = {
  identity: "Personal details",
  professional_profiles: "Career profiles",
  resume_studio: "Resumes",
  education: "Education",
  skills: "Skills",
  work_authorization: "Work authorization",
  privacy: "Privacy settings",
};

export default function RecordScreen({ navigation }: Props) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [suggestedAchievements, setSuggestedAchievements] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [ready, achievements, ...lists] = await Promise.all([
        fetchReadiness().catch(() => null),
        fetchAchievements().catch(() => null),
        ...RECORD_RESOURCES.map((resource) => fetchRecords(resource).then((rows) => rows.length).catch(() => null)),
      ]);
      setReadiness(ready);
      setSuggestedAchievements(achievements ? achievements.filter((item) => item.verification_status === "suggested").length : null);
      setCounts(Object.fromEntries(RECORD_RESOURCES.map((resource, index) => [resource, lists[index]])));
      setMessage("");
    } catch {
      setMessage("Unable to load your professional record.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) {
    return <View style={[styles.container, styles.centered]}><ActivityIndicator color={theme.text} accessibilityLabel="Loading professional record" /></View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>The facts Kall can use when it tailors, fills, and matches. Nothing here is invented; add what you can prove.</Text>
      {message ? <Text style={formStyles.error}>{message}</Text> : null}

      {readiness ? (
        <View style={formStyles.card}>
          <View style={styles.readinessRow}>
            <View>
              <Text style={formStyles.cardLabel}>Record coverage</Text>
              <Text style={styles.readinessScore}>{readiness.overall}%</Text>
            </View>
            <View style={styles.readinessCopy}>
              <Text style={formStyles.body}>
                {readiness.missing.length
                  ? `Still thin: ${readiness.missing.map((key) => SECTION_LABELS[key] ?? key.replace(/_/g, " ")).join(", ")}.`
                  : "Every section has something in it."}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens achievements extracted from your resumes"
        style={styles.row}
        onPress={() => navigation.navigate("Achievements")}
      >
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>Achievements</Text>
          <Text style={styles.rowDetail}>
            {suggestedAchievements === null
              ? "Proof of work pulled from your resumes"
              : suggestedAchievements > 0
                ? `${suggestedAchievements} waiting for your review`
                : "Extract more from a resume, or review what is verified"}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </Pressable>

      <Text accessibilityRole="header" style={styles.sectionTitle}>Record sections</Text>
      {RECORD_RESOURCES.map((resource) => {
        const schema = RECORD_SCHEMAS[resource];
        const count = counts[resource];
        return (
          <Pressable
            key={resource}
            accessibilityRole="button"
            accessibilityLabel={`${schema.label}. ${count === null || count === undefined ? "" : `${count} saved.`}`}
            style={styles.row}
            onPress={() => navigation.navigate("RecordResource", { resource })}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{schema.label}</Text>
              <Text style={styles.rowDetail}>{schema.description}</Text>
            </View>
            {count !== null && count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 48 },
  subtitle: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  readinessRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  readinessScore: { color: theme.accent, fontSize: 30, fontWeight: "800" },
  readinessCopy: { flex: 1 },
  sectionTitle: { color: theme.text, fontSize: 17, fontWeight: "800", marginTop: 8, marginBottom: 10 },
  row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  rowCopy: { flex: 1 },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
  rowDetail: { color: theme.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 3 },
  count: { color: theme.accent, fontWeight: "700", fontSize: 14 },
});
