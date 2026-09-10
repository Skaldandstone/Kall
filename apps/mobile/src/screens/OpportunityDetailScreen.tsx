import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { prepareApplication } from "../api/applications";
import { ApiError } from "../api/client";
import {
  updateOpportunityState,
  type OpportunityState,
} from "../api/opportunities";
import { fetchResumeStudio, type Resume } from "../api/workspace";
import { rankResumes, selectResume, type JobIntelligence, type ResumeScore } from "../api/intelligence";
import type { OpportunitiesStackParamList } from "../navigation/types";
import { theme } from "../theme";

type Props = NativeStackScreenProps<
  OpportunitiesStackParamList,
  "OpportunityDetail"
>;

const COVERAGE_LABELS: Record<string, string> = {
  required_skill: "Required skills",
  preferred_skill: "Preferred skills",
  ats_keyword: "ATS keywords",
  leadership: "Leadership signals",
  education: "Education",
  certification: "Certifications",
};

export default function OpportunityDetailScreen({ route, navigation }: Props) {
  const { item, profileId, opportunityId } = route.params;
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumeId, setResumeId] = useState<number | null>(null);
  const [intelligence, setIntelligence] = useState<JobIntelligence | null>(null);
  const [ranking, setRanking] = useState(false);
  const [customize, setCustomize] = useState(true);
  const [cover, setCover] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetchResumeStudio()
      .then(async (studio) => {
        if (cancelled) return;
        setResumes(studio.resumes);
        const preferred =
          studio.resumes.find((r) => r.is_default) || studio.resumes[0];
        setResumeId(preferred?.id ?? null);
        if (!studio.resumes.length) return;
        // Rank every resume against this posting's actual requirements --
        // the same evidence the web job-intelligence page shows -- and
        // preselect whichever one Kall recommends (or the user already chose).
        setRanking(true);
        try {
          const result = await rankResumes(item.job_id, profileId);
          if (cancelled) return;
          setIntelligence(result);
          const chosen = result.selection?.selected_resume_id
            ?? result.selection?.recommended_resume_id
            ?? result.scores[0]?.resume_id;
          if (chosen && studio.resumes.some((r) => r.id === chosen)) setResumeId(chosen);
        } catch {
          // Ranking is advice; the plain resume list still works without it.
        } finally {
          if (!cancelled) setRanking(false);
        }
      })
      .catch(() =>
        setMessage(
          "Resume choices are unavailable. You can still prepare without one.",
        ),
      );
    return () => { cancelled = true; };
  }, [item.job_id, profileId]);

  function chooseResume(id: number) {
    setResumeId(id);
    if (intelligence) {
      // Recorded server-side so the prepared application and the web app
      // honor the same choice; a failure here only loses the memo, not the pick.
      selectResume(item.job_id, profileId, id).catch(() => undefined);
    }
  }

  const scoresByResume = new Map<number, ResumeScore>(
    (intelligence?.scores ?? []).map((score) => [score.resume_id, score]),
  );
  const rankedResumes = [...resumes].sort(
    (a, b) => (scoresByResume.get(b.id)?.total_score ?? -1) - (scoresByResume.get(a.id)?.total_score ?? -1),
  );
  const coverageRows = Object.entries(intelligence?.coverage ?? {}).filter(([, value]) => value.total > 0);
  async function track(state: OpportunityState) {
    if (!opportunityId) {
      setMessage("Run a search to add this role to your tracked inbox first.");
      return;
    }
    setBusy(true);
    try {
      await updateOpportunityState(opportunityId, state);
      setMessage(
        state === "saved" ? "Saved for later." : "Removed from your job list.",
      );
    } catch (e) {
      setMessage(
        e instanceof ApiError ? e.message : "Unable to update this role.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    setBusy(true);
    setMessage("Preparing your application...");
    try {
      const app = await prepareApplication({
        job_id: item.job_id,
        professional_profile_id: profileId,
        resume_id: resumeId,
        customize_resume: customize,
        generate_cover_letter: cover,
        application_mode: "assisted",
      });
      Alert.alert(
        "Application ready",
        "Kall prepared the application package. Open Applications to review it before approval.",
        [
          { text: "Stay here" },
          {
            text: "Open Applications",
            onPress: () => {
              const tabs = navigation.getParent() as
                | { navigate: (name: string, params: object) => void }
                | undefined;
              tabs?.navigate("ApplicationsTab", {
                screen: "ApplicationDetail",
                params: {
                  applicationId: app.id,
                  company: item.company,
                  role: item.title,
                  stage: app.status,
                },
              });
            },
          },
        ],
      );
      setMessage("Application prepared for review.");
    } catch (e) {
      setMessage(
        e instanceof ApiError
          ? e.message
          : "Unable to prepare this application.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.scoreRow}>
        <Text style={styles.score}>{item.score}% match</Text>
        <Text style={styles.recommendation}>{item.recommendation}</Text>
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.company}>{item.company}</Text>
      <Text style={styles.meta}>
        {item.location || "Location not listed"} ·{" "}
        {item.work_type || "Work type unknown"}
      </Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Why it matches</Text>
        {item.strengths.length ? (
          item.strengths.map((v) => (
            <Text key={v} style={styles.bullet}>
              ✓ {v}
            </Text>
          ))
        ) : (
          <Text style={styles.body}>
            Kall has not listed specific strengths yet.
          </Text>
        )}
        {item.gaps.length ? (
          <>
            <Text style={[styles.cardTitle, { marginTop: 16 }]}>
              Check before applying
            </Text>
            {item.gaps.map((v) => (
              <Text key={v} style={styles.gap}>
                • {v}
              </Text>
            ))}
          </>
        ) : null}
      </View>
      {coverageRows.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What the posting asks for</Text>
          {coverageRows.map(([key, value]) => (
            <View key={key} style={styles.coverageRow}>
              <Text style={styles.coverageLabel}>{COVERAGE_LABELS[key] ?? key.replace(/_/g, " ")}</Text>
              <Text style={styles.coverageValue}>{value.covered} of {value.total} covered</Text>
            </View>
          ))}
          <Text style={styles.body}>Coverage is measured against your best-matching resume.</Text>
        </View>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{intelligence ? "Which resume fits best" : "Application setup"}</Text>
        {ranking ? (
          <View style={styles.rankingRow}>
            <ActivityIndicator color={theme.text} />
            <Text style={styles.body}>Ranking your resumes against this posting…</Text>
          </View>
        ) : null}
        {resumes.length ? (
          <View style={styles.chips}>
            {rankedResumes.map((r, index) => {
              const score = scoresByResume.get(r.id);
              const selected = resumeId === r.id;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={score ? `${r.name}, ${score.total_score} percent fit` : r.name}
                  key={r.id}
                  style={[styles.resumeCard, selected && styles.resumeCardActive]}
                  onPress={() => chooseResume(r.id)}
                >
                  <View style={styles.resumeTop}>
                    <Text numberOfLines={1} style={[styles.resumeName, selected && styles.resumeNameActive]}>
                      {r.name}
                    </Text>
                    {score ? (
                      <Text style={[styles.resumeScore, selected && styles.resumeNameActive]}>
                        {score.total_score}%{index === 0 ? " · best fit" : ""}
                      </Text>
                    ) : null}
                  </View>
                  {score?.explanation[0] ? (
                    <Text style={[styles.resumeDetail, selected && styles.resumeDetailActive]} numberOfLines={2}>{score.explanation[0]}</Text>
                  ) : null}
                  {score?.gaps[0] ? (
                    <Text style={[styles.resumeGap, selected && styles.resumeDetailActive]} numberOfLines={2}>Gap: {score.gaps[0]}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={styles.body}>
            No resume selected. You can prepare the application and add
            documents later.
          </Text>
        )}
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Tailor resume</Text>
          <Switch
            value={customize}
            onValueChange={setCustomize}
            trackColor={{ false: theme.border, true: theme.accent }}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Draft cover letter</Text>
          <Switch
            value={cover}
            onValueChange={setCover}
            trackColor={{ false: theme.border, true: theme.accent }}
          />
        </View>
      </View>
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={message.startsWith("Unable") ? styles.error : styles.message}
        >
          {message}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Prepares drafts for your review and does not submit to the employer"
        style={[styles.primary, busy && styles.disabled]}
        disabled={busy}
        onPress={() => void prepare()}
      >
        {busy ? (
          <ActivityIndicator color={theme.accentInk} />
        ) : (
          <Text style={styles.primaryText}>Prepare application</Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="link"
        style={styles.secondary}
        onPress={() => void Linking.openURL(item.url)}
      >
        <Text style={styles.secondaryText}>Open original listing</Text>
      </Pressable>
      <View style={styles.footerActions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void track("saved")}
        >
          <Text style={styles.linkText}>Save for later</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void track("not_interested")}
        >
          <Text style={styles.dismissText}>Not interested</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingBottom: 50 },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  score: { color: theme.accent, fontWeight: "700" },
  recommendation: { color: theme.textMuted, textTransform: "capitalize" },
  title: { color: theme.text, fontSize: 25, fontWeight: "700", marginTop: 10 },
  company: { color: theme.textSecondary, fontSize: 16, marginTop: 4 },
  meta: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 8,
    marginBottom: 20,
  },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  bullet: { color: theme.textSecondary, lineHeight: 21 },
  gap: { color: theme.warning, lineHeight: 21 },
  body: { color: theme.textSecondary, lineHeight: 20 },
  chips: { gap: 8, marginBottom: 10 },
  rankingRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  coverageRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, minHeight: 28, alignItems: "center" },
  coverageLabel: { color: theme.textSecondary, fontSize: 14 },
  coverageValue: { color: theme.text, fontSize: 14, fontWeight: "600" },
  resumeCard: {
    minHeight: 48,
    justifyContent: "center",
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resumeCardActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  resumeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  resumeName: { flex: 1, color: theme.text, fontWeight: "600" },
  resumeNameActive: { color: theme.accentInk, fontWeight: "700" },
  resumeScore: { color: theme.accent, fontWeight: "700", fontSize: 13 },
  resumeDetail: { color: theme.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 },
  resumeDetailActive: { color: theme.accentInk },
  resumeGap: { color: theme.warning, fontSize: 12, lineHeight: 17, marginTop: 2 },
  switchRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchLabel: { color: theme.text, fontWeight: "600" },
  message: { color: theme.success, marginBottom: 12 },
  error: { color: theme.danger, marginBottom: 12 },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.accent,
    borderRadius: 10,
  },
  primaryText: { color: theme.accentInk, fontWeight: "700", fontSize: 16 },
  secondary: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 10,
  },
  secondaryText: { color: theme.text, fontWeight: "700" },
  disabled: { opacity: 0.55 },
  footerActions: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  linkText: { color: theme.textSecondary, fontWeight: "600" },
  dismissText: { color: theme.danger, fontWeight: "600" },
});
