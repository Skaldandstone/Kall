import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import { fetchAchievements, parseResume, updateAchievement, type Achievement } from "../api/record";
import { fetchResumeStudio, type Resume } from "../api/workspace";
import { FormActions, formStyles } from "../components/form";
import { theme } from "../theme";

const ORDER = ["suggested", "verified", "rejected"];

export default function AchievementsScreen() {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [rows, studio] = await Promise.all([fetchAchievements(), fetchResumeStudio().catch(() => ({ resumes: [] as Resume[], profiles: [] }))]);
      setAchievements(rows);
      setResumes(studio.resumes);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to load achievements.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function extract(resume: Resume) {
    setBusy(`parse-${resume.id}`);
    setMessage("");
    try {
      const parse = await parseResume(resume.id);
      await load();
      setMessage(parse.warnings.length
        ? `Extracted from ${resume.name}. ${parse.warnings.length} part${parse.warnings.length === 1 ? "" : "s"} could not be read cleanly.`
        : `Extracted from ${resume.name}. Review each one below.`);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to read that resume.");
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(item: Achievement, status: "verified" | "rejected" | "suggested") {
    setBusy(`item-${item.id}`);
    try {
      const updated = await updateAchievement(item.id, { verification_status: status });
      setAchievements((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to update that achievement.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <View style={[styles.container, styles.centered]}><ActivityIndicator color={theme.text} accessibilityLabel="Loading achievements" /></View>;
  }

  const sorted = [...achievements].sort((a, b) => ORDER.indexOf(a.verification_status) - ORDER.indexOf(b.verification_status));
  const suggested = achievements.filter((item) => item.verification_status === "suggested").length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>
        Kall pulls concrete accomplishments out of your resumes. Verify the ones that are true; only verified achievements count toward resume ranking.
      </Text>
      {message ? <Text style={message.startsWith("Unable") ? formStyles.error : formStyles.success}>{message}</Text> : null}

      <View style={formStyles.card}>
        <Text style={formStyles.cardLabel}>Extract from a resume</Text>
        {resumes.length === 0 ? (
          <Text style={formStyles.body}>Upload a resume first, then Kall can read achievements out of it.</Text>
        ) : (
          resumes.map((resume) => (
            <Pressable
              key={resume.id}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy !== null, busy: busy === `parse-${resume.id}` }}
              disabled={busy !== null}
              style={[styles.resumeRow, busy !== null && formStyles.disabled]}
              onPress={() => void extract(resume)}
            >
              <Text style={styles.resumeName}>{resume.name}</Text>
              {busy === `parse-${resume.id}` ? <ActivityIndicator color={theme.text} /> : <Text style={styles.resumeAction}>Read</Text>}
            </Pressable>
          ))
        )}
      </View>

      {achievements.length === 0 ? (
        <View style={formStyles.card}><Text style={formStyles.body}>No achievements yet. Read a resume above to start.</Text></View>
      ) : (
        <Text accessibilityRole="header" style={styles.sectionTitle}>{suggested > 0 ? `${suggested} to review` : "All reviewed"}</Text>
      )}
      {sorted.map((item) => {
        const working = busy === `item-${item.id}`;
        return (
          <View key={item.id} style={formStyles.card}>
            <View style={styles.cardTop}>
              <Text style={[styles.status, item.verification_status === "verified" && styles.statusVerified, item.verification_status === "rejected" && styles.statusRejected]}>
                {item.verification_status}
              </Text>
              {item.role_title || item.employer ? <Text style={formStyles.muted}>{[item.role_title, item.employer].filter(Boolean).join(" · ")}</Text> : null}
            </View>
            <Text style={styles.text}>{item.achievement_text}</Text>
            {item.metrics.length ? <Text style={formStyles.muted}>Metrics: {item.metrics.join(" · ")}</Text> : null}
            {item.skills.length ? <Text style={formStyles.muted}>Skills: {item.skills.join(" · ")}</Text> : null}
            <FormActions>
              {item.verification_status !== "verified" ? (
                <Pressable accessibilityRole="button" disabled={working} style={[formStyles.primary, working && formStyles.disabled]} onPress={() => void setStatus(item, "verified")}>
                  {working ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>This is true</Text>}
                </Pressable>
              ) : null}
              {item.verification_status !== "rejected" ? (
                <Pressable accessibilityRole="button" disabled={working} style={[formStyles.secondary, working && formStyles.disabled]} onPress={() => void setStatus(item, "rejected")}>
                  <Text style={formStyles.dangerText}>Not accurate</Text>
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" disabled={working} style={[formStyles.secondary, working && formStyles.disabled]} onPress={() => void setStatus(item, "suggested")}>
                  <Text style={formStyles.secondaryText}>Reconsider</Text>
                </Pressable>
              )}
            </FormActions>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 48 },
  subtitle: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  resumeRow: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 8, marginTop: 8 },
  resumeName: { flex: 1, color: theme.text, fontWeight: "600" },
  resumeAction: { color: theme.accent, fontWeight: "700" },
  sectionTitle: { color: theme.text, fontSize: 17, fontWeight: "800", marginBottom: 10 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 },
  status: { color: theme.accent, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  statusVerified: { color: theme.success },
  statusRejected: { color: theme.textMuted },
  text: { color: theme.text, fontSize: 15, lineHeight: 22, marginBottom: 6 },
});
