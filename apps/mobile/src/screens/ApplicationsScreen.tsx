import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fetchPipeline, type PipelineItem } from '../api/applications';
import { theme } from '../theme';
import { EmptyState, PageHeader, SectionHeader, StagePill } from '../components/ui';
import type { ApplicationsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<ApplicationsStackParamList, 'ApplicationsHome'>;

function humanizeStage(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function ApplicationsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const pipeline = await fetchPipeline();
      setItems(pipeline.stages.flatMap((stage) => stage.items));
      setError('');
    } catch {
      setError('Unable to load your applications.');
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

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
      <View style={styles.header}>
        <PageHeader eyebrow="Pipeline" title="Applications" description="Every opportunity, organized around the next decision." />
      </View>

      {!loading && !error && items.length > 0 ? (
        <View style={styles.summary} accessible accessibilityLabel={`${items.length} applications in your pipeline`}>
          <View><Text style={styles.summaryValue}>{items.length}</Text><Text style={styles.summaryLabel}>Active</Text></View>
          <View style={styles.summaryLine} />
          <Text style={styles.summaryNote}>Tap any role to review Kall’s work and choose what happens next.</Text>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={items.length > 0 ? <SectionHeader title="Your pipeline" detail="Most recent activity first" /> : null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.text} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={theme.text} accessibilityLabel="Loading applications" style={styles.loader} />
          ) : error ? (
            <View accessibilityRole="alert" style={styles.stateCard}>
              <Text style={styles.stateTitle}>Applications are unavailable</Text>
              <Text style={styles.stateBody}>{error} Check your connection and try again.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading applications again"
                style={styles.retryButton}
                onPress={() => void load()}
              >
                <Text style={styles.retryButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <EmptyState
              title="No applications yet"
              description="Review a job match when you are ready. Kall will help prepare the application before anything is submitted."
              actionLabel="Find job matches"
              onAction={() => navigation.getParent()?.navigate('OpportunitiesTab' as never)}
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.role} at ${item.company}, ${humanizeStage(item.stage)}`}
            accessibilityHint="Opens application review"
            style={styles.card}
            onPress={() => navigation.navigate('ApplicationDetail', { applicationId: item.id, company: item.company, role: item.role, stage: item.stage })}
          >
            <View style={styles.cardBody}>
              <View style={styles.cardHeader}>
                <StagePill tone={item.stage.toLowerCase().includes('interview') ? 'success' : 'accent'}>{humanizeStage(item.stage)}</StagePill>
                {item.match_score != null ? <Text style={styles.score}>{item.match_score}% match</Text> : null}
              </View>
              <Text style={styles.role}>{item.role}</Text>
              <Text style={styles.company}>{item.company}</Text>
            </View>
            <View accessible={false} style={styles.chevron}><Ionicons name="chevron-forward" size={18} color={theme.textMuted} /></View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background, paddingHorizontal: 20 },
  header: { marginBottom: 0 },
  title: { color: theme.text, fontSize: 26, fontWeight: '700' },
  subtitle: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  list: { paddingBottom: 32, flexGrow: 1 },
  summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.accentWash, borderRadius: 18, padding: 16, marginBottom: 24 },
  summaryValue: { color: theme.accent, fontSize: 24, lineHeight: 27, fontWeight: '700' },
  summaryLabel: { color: theme.textMuted, fontSize: 11, marginTop: 2 },
  summaryLine: { width: 1, height: 38, backgroundColor: theme.borderStrong, marginHorizontal: 16 },
  summaryNote: { flex: 1, color: theme.textSecondary, fontSize: 13, lineHeight: 18 },
  loader: { marginTop: 48 },
  stateCard: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    marginTop: 24,
    alignItems: 'center',
  },
  stateTitle: { color: theme.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  stateBody: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  retryButton: {
    minHeight: 48,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: theme.accent,
    marginTop: 18,
    paddingHorizontal: 20,
  },
  retryButtonText: { color: theme.accentInk, fontSize: 15, fontWeight: '700' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 18,
    padding: 17,
    marginBottom: 10,
  },
  cardBody: { flex: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  company: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  score: { color: theme.textMuted, fontSize: 11, fontWeight: '600' },
  role: { color: theme.text, fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.2, marginTop: 13 },
  chevron: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.surfaceRaised, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
});
