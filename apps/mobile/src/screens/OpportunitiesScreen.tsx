import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { EmptyState, PageHeader, SectionHeader, StagePill, StatusMessage } from "../components/ui";
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
  const [extraTerms, setExtraTerms] = useState("");
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
    setMessage("Searching job boards and company career sites for this profile…");
    try {
      const result = await runDiscovery(profileId, extraTerms);
      await load(profileId);
      if (result.jobs_collected === 0) {
        setMessage(
          result.errors.length
            ? "The search could not reach the job sites. Try again in a moment."
            : "No open roles matched this profile right now. Broaden the target titles, or add terms above and search again.",
        );
      } else {
        setMessage(
          `Found ${result.jobs_collected} open ${result.jobs_collected === 1 ? "role" : "roles"}, ${result.matches_created} new for this profile.`,
        );
      }
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
        <View style={styles.pageTitle}><PageHeader eyebrow="Opportunity desk" title="Find your next role" description="Kall scans your sources and brings the strongest matches here." /></View>
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
          <TextInput
            accessibilityLabel="Extra search terms"
            style={styles.termsInput}
            value={extraTerms}
            onChangeText={setExtraTerms}
            placeholder="Add titles or keywords to this search (optional)"
            placeholderTextColor={theme.textMuted}
            returnKeyType="search"
            onSubmitEditing={() => void searchNow()}
            editable={!searching}
          />
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
              <><Ionicons name="sparkles-outline" size={18} color={theme.accentInk} /><Text style={styles.searchButtonText}>Find fresh matches</Text></>
            )}
          </Pressable>

          {message ? <View style={styles.message}><StatusMessage kind={message.toLowerCase().includes("unable") ? "error" : "neutral"}>{message}</StatusMessage></View> : null}

          <FlatList
            data={feed}
            keyExtractor={(item) => String(item.match_id)}
            contentContainerStyle={styles.list}
            ListHeaderComponent={feed.length > 0 ? <SectionHeader title="Recommended for you" detail={`${feed.length} matches for this career profile`} /> : null}
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
              <Text style={styles.empty}>No matches yet. Tap Find fresh matches to search job boards and company career sites for this profile.</Text>
            }
            renderItem={({ item }) => {
              const trackedItem = trackedOpportunity(item);
              const busy =
                pendingId === (item.opportunity_id ?? trackedItem?.id);
              return (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <StagePill tone="accent">{item.score}% match</StagePill>
                    {trackedItem ? (
                      <Text style={styles.state}>
                        {trackedItem.state.replace("_", " ")}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.role}>{item.title}</Text>
                  <Text style={styles.company}>{item.company}</Text>
                  <View style={styles.metaRow}><Ionicons name="location-outline" size={14} color={theme.textMuted} /><Text style={styles.meta}>{item.location || "Location not listed"}</Text></View>
                  <View style={styles.metaRow}><Ionicons name="wallet-outline" size={14} color={theme.textMuted} /><Text style={styles.meta}>{formatSalary(item)}</Text></View>
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
                        View fit
                      </Text>
                      <Ionicons name="arrow-forward" size={16} color={theme.accentInk} />
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
  header: { paddingHorizontal: 20, marginBottom: 14 },
  pageTitle: { marginTop: 20 },
  subtitle: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  chipRow: { marginBottom: 12 },
  chipRowContent: { paddingHorizontal: 20, gap: 8 },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: theme.surface,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  chipActive: { backgroundColor: theme.accent },
  chipText: { color: theme.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: theme.background },
  termsInput: {
    minHeight: 48,
    marginHorizontal: 20,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    backgroundColor: theme.surfaceRaised,
    color: theme.text,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  searchButton: {
    minHeight: 48,
    justifyContent: "center",
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 20,
    backgroundColor: theme.accent,
    borderRadius: 15,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 18,
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
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  state: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  role: { color: theme.text, fontSize: 19, lineHeight: 24, letterSpacing: -0.25, fontWeight: "700", marginTop: 15 },
  company: { color: theme.textSecondary, fontSize: 14, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  meta: { color: theme.textMuted, fontSize: 12 },
  detail: {
    color: theme.textSecondary,
    fontSize: 13,
    marginTop: 8,
    lineHeight: 18,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  actionButton: {
    minHeight: 44,
    backgroundColor: theme.surfaceRaised,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  actionButtonText: { color: theme.text, fontSize: 13, fontWeight: "600" },
  actionButtonPrimary: {
    minHeight: 44,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    backgroundColor: theme.accent,
    borderRadius: 12,
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
