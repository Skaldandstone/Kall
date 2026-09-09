import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  fetchCareerProfiles,
  fetchJobsFeed,
  fetchOpportunities,
  runDiscovery,
  updateOpportunityState,
  type CareerProfile,
  type JobFeedItem,
  type OpportunityState,
  type TrackedOpportunity,
} from "../api/opportunities";
import { ApiError } from "../api/client";
import OpportunityTrackSwitch from "../components/OpportunityTrackSwitch";
import { theme } from "../theme";
import { EmptyState, PageHeader, StatusMessage } from "../components/ui";
import type { OpportunitiesStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<
  OpportunitiesStackParamList,
  "OpportunitiesHome"
>;

function formatSalary(item: JobFeedItem): string {
  if (!item.salary_min && !item.salary_max) return "Salary not listed";
  const low = item.salary_min || item.salary_max || 0;
  const high = item.salary_max || item.salary_min || 0;
  return `$${low.toLocaleString()}${high !== low ? `–$${high.toLocaleString()}` : ""}`;
}

export default function OpportunitiesScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [feed, setFeed] = useState<JobFeedItem[]>([]);
  const [tracked, setTracked] = useState<TrackedOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  const trackedByJobId = useMemo(() => {
    const map = new Map<number, TrackedOpportunity>();
    for (const item of tracked) {
      if (item.professional_profile_id === profileId)
        map.set(item.job_id, item);
    }
    return map;
  }, [profileId, tracked]);

  const trackedById = useMemo(() => {
    const map = new Map<number, TrackedOpportunity>();
    for (const item of tracked) map.set(item.id, item);
    return map;
  }, [tracked]);

  const trackedOpportunity = useCallback(
    (item: JobFeedItem) =>
      (item.opportunity_id
        ? trackedById.get(item.opportunity_id)
        : undefined) ?? trackedByJobId.get(item.job_id),
    [trackedById, trackedByJobId],
  );

  const load = useCallback(async (currentProfileId: number | null) => {
    try {
      const { profiles: fetchedProfiles } = await fetchCareerProfiles();
      setProfiles(fetchedProfiles);
      const activeId = currentProfileId ?? fetchedProfiles[0]?.id ?? null;
      setProfileId(activeId);

      const trackedList = await fetchOpportunities();
      setTracked(trackedList);

      if (activeId) {
        setFeed(await fetchJobsFeed(activeId));
      } else {
        setFeed([]);
      }
      setMessage("");
    } catch (err) {
      setMessage(
        err instanceof ApiError ? err.message : "Unable to load opportunities.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(profileId);
      // Deliberately excludes `profileId` -- this should only re-run on
      // screen focus (e.g. returning from another tab), not every time the
      // user switches the profile chip, which already reloads the feed itself.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  async function selectProfile(id: number) {
    setProfileId(id);
    setLoading(true);
    try {
      setFeed(await fetchJobsFeed(id));
      setMessage("");
    } catch (err) {
      setMessage(
        err instanceof ApiError
          ? err.message
          : "Unable to load results for this profile.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function searchNow() {
    if (!profileId) return;
    setSearching(true);
    setMessage("Searching your configured company boards…");
    try {
      const result = await runDiscovery(profileId);
      await load(profileId);
      setMessage(
        `Search complete: ${result.jobs_collected} collected, ${result.matches_created} matched.`,
      );
    } catch (err) {
      setMessage(
        err instanceof ApiError ? err.message : "Unable to run discovery.",
      );
    } finally {
      setSearching(false);
    }
  }

  async function setState(item: JobFeedItem, state: OpportunityState) {
    const opportunityId = item.opportunity_id ?? trackedOpportunity(item)?.id;
    if (!opportunityId) {
      setMessage(
        "This role has not been added to your tracked inbox yet -- run a search first.",
      );
      return;
    }
    setPendingId(opportunityId);
    try {
      await updateOpportunityState(opportunityId, state);
      setTracked(await fetchOpportunities());
    } catch (err) {
      setMessage(
        err instanceof ApiError
          ? err.message
          : "Unable to update this opportunity.",
      );
    } finally {
      setPendingId(null);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={theme.text} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <OpportunityTrackSwitch
          active="jobs"
          onSelect={(track) => {
            if (track === "consulting") navigation.navigate("Consulting");
          }}
        />
        <View style={styles.pageTitle}><PageHeader eyebrow="Work" title="Job search" description="Search the boards Kall watches for you." /></View>
      </View>

      {profiles.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}
        >
          {profiles.map((profile) => (
            <Pressable
              key={profile.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: profile.id === profileId }}
              style={[
                styles.chip,
                profile.id === profileId && styles.chipActive,
              ]}
              onPress={() => void selectProfile(profile.id)}
            >
              <Text
                style={[
                  styles.chipText,
                  profile.id === profileId && styles.chipTextActive,
                ]}
              >
                {profile.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {profiles.length === 0 ? (
        <View style={styles.emptyState}><EmptyState
            title="Build your search direction first"
            description="Create a career profile so Kall knows which roles, companies, and working style to search for."
            actionLabel="Create career profile"
            onAction={() => {
              const tabs = navigation.getParent() as
                | { navigate: (name: string, params: object) => void }
                | undefined;
              tabs?.navigate("ProfileTab", { screen: "CareerProfiles" });
            }}
          /></View>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search for new job matches"
            accessibilityState={{ disabled: searching, busy: searching }}
            style={styles.searchButton}
            onPress={searchNow}
            disabled={searching}
          >
            {searching ? (
              <ActivityIndicator color={theme.background} />
            ) : (
              <Text style={styles.searchButtonText}>Search now</Text>
            )}
          </Pressable>

          {message ? <View style={styles.message}><StatusMessage kind={message.toLowerCase().includes("unable") ? "error" : "neutral"}>{message}</StatusMessage></View> : null}

          <FlatList
            data={feed}
            keyExtractor={(item) => String(item.match_id)}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void load(profileId);
                }}
                tintColor={theme.text}
              />
            }
            ListEmptyComponent={
              <Text style={styles.empty}>No matches yet. Try Search now.</Text>
            }
            renderItem={({ item }) => {
              const trackedItem = trackedOpportunity(item);
              const busy =
                pendingId === (item.opportunity_id ?? trackedItem?.id);
              return (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.score}>{item.score}% match</Text>
                    {trackedItem ? (
                      <Text style={styles.state}>
                        {trackedItem.state.replace("_", " ")}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.role}>{item.title}</Text>
                  <Text style={styles.company}>{item.company}</Text>
                  <Text style={styles.meta}>
                    {item.location || "Location not listed"} ·{" "}
                    {item.work_type || "Work type unknown"} ·{" "}
                    {formatSalary(item)}
                  </Text>
                  {item.strengths.length > 0 && (
                    <Text style={styles.detail}>
                      Strengths: {item.strengths.slice(0, 3).join(" · ")}
                    </Text>
                  )}

                  <View style={styles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Review ${item.title} at ${item.company}, ${item.score} percent match`}
                      style={styles.actionButtonPrimary}
                      onPress={() =>
                        navigation.navigate("OpportunityDetail", {
                          item,
                          profileId: profileId!,
                          opportunityId: item.opportunity_id ?? trackedItem?.id,
                          state: trackedItem?.state,
                        })
                      }
                    >
                      <Text style={styles.actionButtonPrimaryText}>
                        Review match
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: busy }}
                      style={styles.actionButton}
                      disabled={busy}
                      onPress={() => void setState(item, "saved")}
                    >
                      <Text style={styles.actionButtonText}>Save</Text>
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 20, marginBottom: 12 },
  pageTitle: { marginTop: 20 },
  subtitle: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  chipRow: { marginBottom: 12 },
  chipRowContent: { paddingHorizontal: 20, gap: 8 },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: theme.background },
  searchButton: {
    minHeight: 48,
    justifyContent: "center",
    marginHorizontal: 20,
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  searchButtonText: { color: theme.background, fontWeight: "700" },
  message: {
    paddingHorizontal: 20,
  },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  empty: { color: theme.textMuted, textAlign: "center", marginTop: 40 },
  emptyState: { paddingHorizontal: 20, marginTop: 20 },
  emptyTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptyBody: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  emptyButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.accent,
    borderRadius: 10,
    marginTop: 18,
  },
  emptyButtonText: { color: theme.accentInk, fontWeight: "700" },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  score: { color: theme.accent, fontWeight: "700", fontSize: 13 },
  state: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  role: { color: theme.text, fontSize: 17, fontWeight: "700", marginTop: 8 },
  company: { color: theme.textSecondary, fontSize: 14, marginTop: 2 },
  meta: { color: theme.textMuted, fontSize: 12, marginTop: 8 },
  detail: {
    color: theme.textSecondary,
    fontSize: 13,
    marginTop: 8,
    lineHeight: 18,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  actionButton: {
    minHeight: 44,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  actionButtonText: { color: theme.text, fontSize: 13, fontWeight: "600" },
  actionButtonPrimary: {
    minHeight: 44,
    flex: 1,
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonPrimaryText: {
    color: theme.background,
    fontSize: 13,
    fontWeight: "700",
  },
});
