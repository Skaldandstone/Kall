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
import { fetchBrief, type Brief } from "../api/brief";
import { theme } from "../theme";
import { Card, PageHeader, StatusMessage } from "../components/ui";
import type { AppTabParamList } from "../navigation/types";

type Props = BottomTabScreenProps<AppTabParamList, "BriefTab">;

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
      <Text style={styles.dateLabel}>Today</Text>
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
            title={`Welcome back, ${brief.user.preferred_name}.`}
            description="Here is the clearest next move in your search."
          />
          {error ? (
            <StatusMessage kind="error">
              We could not refresh this brief. Showing the last update.
            </StatusMessage>
          ) : null}
          <Card emphasized style={styles.focusCard}>
            <Text style={styles.cardLabel}>Your next move</Text>
            <Text style={styles.focusTitle}>{brief.focus.title}</Text>
            <Text style={styles.focusDetail}>{brief.focus.detail}</Text>
            <Pressable
              accessibilityRole="button"
              style={styles.cardAction}
              onPress={() =>
                navigation.navigate(
                  brief.focus.href.includes("application")
                    ? "ApplicationsTab"
                    : brief.focus.href.includes("profile") ||
                        brief.focus.href.includes("resume") ||
                        brief.focus.href.includes("setting")
                      ? "ProfileTab"
                      : "OpportunitiesTab",
                )
              }
            >
              <Text style={styles.cardActionText}>Continue this task</Text>
            </Pressable>
          </Card>

          <View style={styles.metrics}>
            <View style={styles.metric}><Text style={styles.metricValue}>{brief.career_health.score}</Text><Text style={styles.metricLabel}>Career health</Text></View>
            <View style={styles.metric}><Text style={styles.metricValue}>{brief.applications.active}</Text><Text style={styles.metricLabel}>Active applications</Text></View>
            <View style={styles.metric}><Text style={styles.metricValue}>{brief.opportunities.length}</Text><Text style={styles.metricLabel}>Top matches</Text></View>
          </View>

          <Card style={styles.card}>
            <View style={styles.sectionHeadingRow}><Text style={styles.sectionTitle}>Career health</Text><Text accessibilityLabel={`${brief.career_health.score} percent`} style={styles.healthScore}>{brief.career_health.score}%</Text></View>
            {brief.career_health.dimensions.map((dimension) => (
              <View key={dimension.label} style={styles.dimensionBlock} accessible accessibilityLabel={`${dimension.label}, ${dimension.score} percent. ${dimension.explanation}`}>
                <View style={styles.dimensionRow}><Text style={styles.dimensionLabel}>{dimension.label}</Text><Text style={styles.dimensionScore}>{dimension.score}%</Text></View>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(2, Math.min(100, dimension.score))}%` }]} /></View>
              </View>
            ))}
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Applications</Text>
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
              <Text style={styles.sectionTitle}>Top opportunities</Text>
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
  content: { padding: 20, paddingBottom: 48 },
  dateLabel: {
    color: theme.accent,
    fontSize: 12,
    fontWeight: "700",
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
  focusCard: { marginBottom: 14, borderColor: theme.accent },
  cardLabel: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  focusTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  focusDetail: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  metrics: { flexDirection: "row", gap: 8, marginBottom: 14 },
  metric: { flex: 1, minHeight: 88, justifyContent: "space-between", backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12 },
  metricValue: { color: theme.text, fontSize: 24, fontWeight: "800" },
  metricLabel: { color: theme.textSecondary, fontSize: 11, lineHeight: 15 },
  sectionHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { color: theme.text, fontSize: 17, fontWeight: "800", marginBottom: 10 },
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
    marginTop: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderColor: theme.border,
    borderWidth: 1,
  },
  cardActionText: { color: theme.text, fontWeight: "700", fontSize: 13 },
});
