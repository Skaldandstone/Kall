import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchPipeline, type PipelineItem } from '../api/applications';
import { useAuth } from '../auth/AuthContext';
import { theme } from '../theme';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'Applications'>;

export default function ApplicationsScreen({ navigation }: Props) {
  const { signOut } = useAuth();
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
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Applications</Text>
          <Text style={styles.subtitle}>Review and approve what Kall has prepared.</Text>
        </View>
        <Pressable onPress={() => navigation.navigate('MorningBrief')}>
          <Text style={styles.headerLink}>Brief</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.text} />}
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>No applications yet. Start one from the Kall web app.</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => navigation.navigate('ApplicationDetail', { applicationId: item.id, company: item.company, role: item.role })}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.company}>{item.company}</Text>
              {item.match_score != null ? <Text style={styles.score}>{item.match_score}%</Text> : null}
            </View>
            <Text style={styles.role}>{item.role}</Text>
            <Text style={styles.stage}>{item.stage}</Text>
          </Pressable>
        )}
      />

      <Pressable onPress={() => void signOut()}>
        <Text style={styles.signOut}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background, paddingTop: 60, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title: { color: theme.text, fontSize: 26, fontWeight: '700' },
  subtitle: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  headerLink: { color: theme.accent, fontWeight: '600', fontSize: 14, paddingTop: 4 },
  error: { color: theme.danger, marginBottom: 12 },
  list: { paddingBottom: 24 },
  empty: { color: theme.textMuted, textAlign: 'center', marginTop: 60 },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  company: { color: theme.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  score: { color: theme.accent, fontWeight: '700' },
  role: { color: theme.text, fontSize: 17, fontWeight: '600', marginTop: 4 },
  stage: { color: theme.textSecondary, fontSize: 13, marginTop: 8, textTransform: 'capitalize' },
  signOut: { color: theme.textMuted, textAlign: 'center', paddingVertical: 16 },
});
