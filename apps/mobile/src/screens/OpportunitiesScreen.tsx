import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
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
} from '../api/opportunities';
import { ApiError } from '../api/client';
import { theme } from '../theme';

function formatSalary(item: JobFeedItem): string {
  if (!item.salary_min && !item.salary_max) return 'Salary not listed';
  const low = item.salary_min || item.salary_max || 0;
  const high = item.salary_max || item.salary_min || 0;
  return `$${low.toLocaleString()}${high !== low ? `–$${high.toLocaleString()}` : ''}`;
}

export default function OpportunitiesScreen() {
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [feed, setFeed] = useState<JobFeedItem[]>([]);
  const [tracked, setTracked] = useState<TrackedOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const trackedByJobId = useMemo(() => {
    const map = new Map<number, TrackedOpportunity>();
    for (const item of tracked) map.set(item.job_id, item);
    return map;
  }, [tracked]);

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
      setMessage('');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to load opportunities.');
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
      setMessage('');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to load results for this profile.');
    } finally {
      setLoading(false);
    }
  }

  async function searchNow() {
    if (!profileId) return;
    setSearching(true);
    setMessage('Searching your configured company boards…');
    try {
      const result = await runDiscovery(profileId);
      await load(profileId);
      setMessage(`Search complete: ${result.jobs_collected} collected, ${result.matches_created} matched.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to run discovery.');
    } finally {
      setSearching(false);
    }
  }

  async function setState(item: JobFeedItem, state: OpportunityState) {
    const existing = trackedByJobId.get(item.job_id);
    if (!existing) {
      setMessage('This role has not been added to your tracked inbox yet -- run a search first.');
      return;
    }
    setPendingId(existing.id);
    try {
      await updateOpportunityState(existing.id, state);
      setTracked(await fetchOpportunities());
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to update this opportunity.');
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Opportunities</Text>
        <Text style={styles.subtitle}>Search the boards Kall watches for you.</Text>
      </View>

      {profiles.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
          {profiles.map((profile) => (
            <Pressable
              key={profile.id}
              style={[styles.chip, profile.id === profileId && styles.chipActive]}
              onPress={() => void selectProfile(profile.id)}
            >
              <Text style={[styles.chipText, profile.id === profileId && styles.chipTextActive]}>{profile.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {profiles.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No professional profile yet</Text>
          <Text style={styles.emptyBody}>Set up a professional profile in the Kall web app to start finding matches.</Text>
        </View>
      ) : (
        <>
          <Pressable style={styles.searchButton} onPress={searchNow} disabled={searching}>
            {searching ? <ActivityIndicator color={theme.background} /> : <Text style={styles.searchButtonText}>Search now</Text>}
          </Pressable>

          {message ? <Text style={styles.message}>{message}</Text> : null}

          <FlatList
            data={feed}
            keyExtractor={(item) => String(item.match_id)}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(profileId); }} tintColor={theme.text} />}
            ListEmptyComponent={<Text style={styles.empty}>No matches yet. Try Search now.</Text>}
            renderItem={({ item }) => {
              const trackedItem = trackedByJobId.get(item.job_id);
              const busy = pendingId === trackedItem?.id;
              return (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.score}>{item.score}% match</Text>
                    {trackedItem ? <Text style={styles.state}>{trackedItem.state.replace('_', ' ')}</Text> : null}
                  </View>
                  <Text style={styles.role}>{item.title}</Text>
                  <Text style={styles.company}>{item.company}</Text>
                  <Text style={styles.meta}>
                    {item.location || 'Location not listed'} · {item.work_type || 'Work type unknown'} · {formatSalary(item)}
                  </Text>
                  {item.strengths.length > 0 && <Text style={styles.detail}>Strengths: {item.strengths.slice(0, 3).join(' · ')}</Text>}

                  <View style={styles.actions}>
                    <Pressable style={styles.linkButton} onPress={() => Linking.openURL(item.url)}>
                      <Text style={styles.linkButtonText}>View role</Text>
                    </Pressable>
                    <Pressable style={styles.actionButton} disabled={busy} onPress={() => void setState(item, 'saved')}>
                      <Text style={styles.actionButtonText}>Save</Text>
                    </Pressable>
                    <Pressable style={styles.actionButtonPrimary} disabled={busy} onPress={() => void setState(item, 'apply')}>
                      {busy ? <ActivityIndicator color={theme.background} /> : <Text style={styles.actionButtonPrimaryText}>Apply</Text>}
                    </Pressable>
                    <Pressable style={styles.actionButtonGhost} disabled={busy} onPress={() => void setState(item, 'not_interested')}>
                      <Text style={styles.actionButtonGhostText}>Dismiss</Text>
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
  container: { flex: 1, backgroundColor: theme.background, paddingTop: 60 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 20, marginBottom: 12 },
  title: { color: theme.text, fontSize: 26, fontWeight: '700' },
  subtitle: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  chipRow: { marginBottom: 12 },
  chipRowContent: { paddingHorizontal: 20, gap: 8 },
  chip: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: theme.background },
  searchButton: {
    marginHorizontal: 20,
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  searchButtonText: { color: theme.background, fontWeight: '700' },
  message: { color: theme.textSecondary, paddingHorizontal: 20, marginBottom: 8, fontSize: 13 },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  empty: { color: theme.textMuted, textAlign: 'center', marginTop: 40 },
  emptyState: { paddingHorizontal: 20, marginTop: 20 },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyBody: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  score: { color: theme.accent, fontWeight: '700', fontSize: 13 },
  state: { color: theme.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  role: { color: theme.text, fontSize: 17, fontWeight: '700', marginTop: 8 },
  company: { color: theme.textSecondary, fontSize: 14, marginTop: 2 },
  meta: { color: theme.textMuted, fontSize: 12, marginTop: 8 },
  detail: { color: theme.textSecondary, fontSize: 13, marginTop: 8, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  linkButton: { borderColor: theme.border, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  linkButtonText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  actionButton: { borderColor: theme.border, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  actionButtonText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  actionButtonPrimary: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, minWidth: 60, alignItems: 'center' },
  actionButtonPrimaryText: { color: theme.background, fontSize: 13, fontWeight: '700' },
  actionButtonGhost: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  actionButtonGhostText: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
});
