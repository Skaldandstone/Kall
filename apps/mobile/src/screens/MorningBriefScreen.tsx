import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { fetchBrief, type Brief } from "../api/brief";
import { theme } from "../theme";
import { BrandMark, Card, PageHeader, SectionHeader, StagePill, StatusMessage } from "../components/ui";
import type { AppTabParamList } from "../navigation/types";

type Props = BottomTabScreenProps<AppTabParamList, "BriefTab">;

// Routed on the focus's kind, not its web href -- the href is the web app's
// URL and "/onboarding" (define a profile) matched none of the substrings the
// old check sniffed for, so that card landed on the job feed.
function openFocus(navigation: Props["navigation"], kind: string) {
  const tabs = navigation as unknown as { navigate: (name: string, params?: object) => void };
  switch (kind) {
    case "autofill":
      tabs.navigate("ApplicationsTab");
      return;
    case "resume":
      tabs.navigate("ProfileTab", { screen: "Resumes" });
      return;
    case "profile":
      tabs.navigate("ProfileTab", { screen: "CareerProfiles" });
      return;
    default:
      tabs.navigate("OpportunitiesTab");
  }
}

export default function MorningBriefScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setBrief(await fetchBrief());
      setError("");
    } catch {
      setError("Unable to load your Morning Brief.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={theme.text} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={theme.text}
        />
      }
    >
      <View style={styles.masthead}><BrandMark compact /><Text style={styles.wordmark}>Kall</Text><View style={styles.mastheadSpacer} /><Text style={styles.dateLabel}>Today</Text></View>
      {error && !brief ? (
        <View accessibilityRole="alert" style={styles.errorCard}>
          <Text style={styles.errorTitle}>Your brief is unavailable</Text>
          <Text style={styles.errorBody}>
            {error} Check your connection and try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading today's brief again"
            style={styles.retryButton}
            onPress={() => void load()}
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {brief && (
        <>
          <PageHeader
            eyebrow="Your daily brief"
            title={`Good morning, ${brief.user.preferred_name}`}
            description="One clear move, then the rest of your search."
          />
          {error ? (
            <StatusMessage kind="error">
              We could not refresh this brief. Showing the last update.
            </StatusMessage>
          ) : null}
          <LinearGradient colors={['#263851', '#19283c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.focusCard}>
            <View style={styles.focusTopRow}><StagePill tone="accent">Next best action</StagePill><View accessible={false} style={styles.focusIcon}><Ionicons name="arrow-forward" size={18} color={theme.accentInk} /></View></View>
            <Text style={styles.focusTitle}>{brief.focus.title}</Text>
            <Text style={styles.focusDetail}>{brief.focus.detail}</Text>
            <Pressable
              accessibilityRole="button"
              style={styles.cardAction}
              onPress={() => openFocus(navigation, brief.focus.kind)}
            >
              <Text style={styles.cardActionText}>Start now</Text><Ionicons name="arrow-forward" size={16} color={theme.text} />
            </Pressable>
          </LinearGradient>

          <View style={styles.metrics}>
            <View style={styles.metric}><Text style={styles.metricValue}>{brief.career_health.score}<Text style={styles.metricSuffix}>%</Text></Text><Text style={styles.metricLabel}>Career health</Text></View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}><Text style={styles.metricValue}>{brief.applications.active}</Text><Text style={styles.metricLabel}>In progress</Text></View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}><Text style={styles.metricValue}>{brief.opportunities.length}</Text><Text style={styles.metricLabel}>Top matches</Text></View>
          </View>

          <Card style={styles.card}>
            <SectionHeader title="Career health" detail="Where your profile can get stronger" action={<Text accessibilityLabel={`${brief.career_health.score} percent`} style={styles.healthScore}>{brief.career_health.score}%</Text>} />
            {brief.career_health.dimensions.map((dimension) => (
              <View key={dimension.label} style={styles.dimensionBlock} accessible accessibilityLabel={`${dimension.label}, ${dimension.measured ? `${dimension.score} percent` : "not measured yet"}. ${dimension.explanation}`}>
                <View style={styles.dimensionRow}><Text style={styles.dimensionLabel}>{dimension.label}</Text><Text style={dimension.measured ? styles.dimensionScore : styles.dimensionUnmeasured}>{dimension.measured ? `${dimension.score}%` : "Not measured"}</Text></View>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${dimension.measured ? Math.max(2, Math.min(100, dimension.score)) : 0}%` }]} /></View>
                {!dimension.measured ? <Text style={styles.dimensionHint}>{dimension.explanation}</Text> : null}
              </View>
            ))}
          </Card>

          <Card style={styles.card}>
            <SectionHeader title="Applications" />
            <Text style={styles.focusDetail}>{brief.applications.active} active of {brief.applications.total} total.</Text>
            <Pressable
              accessibilityRole="button"
              style={styles.cardAction}
              onPress={() => navigation.navigate("ApplicationsTab")}
            >
              <Text style={styles.cardActionText}>View applications</Text>
            </Pressable>
          </Card>

          {brief.opportunities.length > 0 && (
            <Card style={styles.card}>
              <SectionHeader title="Top opportunities" detail="Selected for your active profile" />
              {brief.opportunities.map((opportunity) => (
                <Pressable
                  accessibilityRole="button"
                  key={opportunity.job_id}
                  style={styles.opportunityRow}
                  accessibilityLabel={`${opportunity.title} at ${opportunity.company}, ${opportunity.score} percent match`}
                  onPress={() => navigation.navigate("OpportunitiesTab")}
                >
                  <Text style={styles.opportunityTitle}>
                    {opportunity.title}
                  </Text>
                  <Text style={styles.dimensionLabel}>
                    {opportunity.company} · {opportunity.score}% match
                  </Text>
                </Pressable>
              ))}
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  masthead: { minHeight: 42, flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  wordmark: { color: theme.text, fontSize: 17, fontWeight: '700', marginLeft: 10, letterSpacing: -0.25 },
  mastheadSpacer: { flex: 1 },
  dateLabel: {
    color: theme.accent,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  title: {
    color: theme.text,
    fontSize: 24,
    fontWeight: "700",
    marginTop: 4,
    marginBottom: 18,
  },
  errorCard: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    marginTop: 16,
    alignItems: "center",
  },
  errorTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  errorBody: {
    color: theme.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 8,
  },
  retryButton: {
    minHeight: 48,
    minWidth: 140,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: theme.accent,
    marginTop: 18,
    paddingHorizontal: 20,
  },
  retryButtonText: { color: theme.accentInk, fontSize: 15, fontWeight: "700" },
  card: { marginBottom: 14 },
  focusCard: { marginBottom: 16, borderRadius: 24, padding: 20, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.26, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 6 },
  focusTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  focusIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  cardLabel: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  focusTitle: {
    color: theme.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    letterSpacing: -0.35,
    marginBottom: 7,
  },
  focusDetail: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  metrics: { flexDirection: "row", alignItems: 'center', backgroundColor: theme.backgroundSoft, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 8, marginBottom: 20 },
  metric: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: "center" },
  metricDivider: { width: 1, height: 32, backgroundColor: theme.border },
  metricValue: { color: theme.text, fontSize: 22, lineHeight: 27, fontWeight: "700" },
  metricSuffix: { color: theme.textMuted, fontSize: 13 },
  metricLabel: { color: theme.textMuted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  sectionHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { color: theme.text, fontSize: 17, fontWeight: "700", marginBottom: 10 },
  healthScore: {
    color: theme.accent,
    fontSize: 17,
    fontWeight: "800",
  },
  dimensionBlock: { marginBottom: 12 },
  dimensionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 6,
  },
  dimensionLabel: { color: theme.textSecondary, fontSize: 13 },
  dimensionScore: { color: theme.text, fontSize: 13, fontWeight: "600" },
  dimensionUnmeasured: { color: theme.textMuted, fontSize: 12, fontWeight: "600" },
  dimensionHint: { color: theme.textMuted, fontSize: 12, lineHeight: 16, marginTop: 5 },
  progressTrack: { height: 5, overflow: "hidden", borderRadius: 3, backgroundColor: theme.surfaceInteractive },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: theme.accent },
  opportunityRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  opportunityTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  cardAction: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(9, 17, 29, 0.42)',
  },
  cardActionText: { color: theme.text, fontWeight: "700", fontSize: 13 },
});
