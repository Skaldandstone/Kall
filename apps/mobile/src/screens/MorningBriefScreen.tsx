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
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { fetchBrief, type Brief } from "../api/brief";
import { theme } from "../theme";
import type { AppTabParamList } from "../navigation/types";

type Props = BottomTabScreenProps<AppTabParamList, "BriefTab">;

export default function MorningBriefScreen({ navigation }: Props) {
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
      contentContainerStyle={styles.content}
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
      <Text style={styles.eyebrow}>Today</Text>
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
          <Text style={styles.title}>
            Welcome back, {brief.user.preferred_name}.
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={styles.refreshError}>
              We could not refresh this brief. Showing the last update.
            </Text>
          ) : null}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Daily focus</Text>
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
              <Text style={styles.cardActionText}>Continue</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Career health</Text>
            <Text style={styles.healthScore}>{brief.career_health.score}</Text>
            {brief.career_health.dimensions.map((dimension) => (
              <View key={dimension.label} style={styles.dimensionRow}>
                <Text style={styles.dimensionLabel}>{dimension.label}</Text>
                <Text style={styles.dimensionScore}>{dimension.score}%</Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Applications</Text>
            <Text style={styles.focusDetail}>
              {brief.applications.active} active of {brief.applications.total}{" "}
              total.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.cardAction}
              onPress={() => navigation.navigate("ApplicationsTab")}
            >
              <Text style={styles.cardActionText}>View applications</Text>
            </Pressable>
          </View>

          {brief.opportunities.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Top opportunities</Text>
              {brief.opportunities.map((opportunity) => (
                <Pressable
                  accessibilityRole="button"
                  key={opportunity.job_id}
                  style={styles.opportunityRow}
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
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  eyebrow: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: {
    color: theme.text,
    fontSize: 24,
    fontWeight: "700",
    marginTop: 4,
    marginBottom: 20,
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
  refreshError: { color: theme.danger, marginBottom: 12 },
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
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
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
  healthScore: {
    color: theme.accent,
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 8,
  },
  dimensionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  dimensionLabel: { color: theme.textSecondary, fontSize: 13 },
  dimensionScore: { color: theme.text, fontSize: 13, fontWeight: "600" },
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
