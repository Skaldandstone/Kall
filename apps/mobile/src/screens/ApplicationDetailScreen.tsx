import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { approveReview, confirmReview, fetchReview, type ReviewData } from '../api/applications';
import { ApiError } from '../api/client';
import { theme } from '../theme';
import type { ApplicationsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<ApplicationsStackParamList, 'ApplicationDetail'>;

export default function ApplicationDetailScreen({ route }: Props) {
  const { applicationId, company, role } = route.params;
  const [review, setReview] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      setReview(await fetchReview(applicationId));
    } catch {
      setMessage('Unable to load this application for review.');
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleConfirm() {
    setBusy(true);
    setMessage('');
    try {
      await confirmReview(applicationId);
      setMessage('Review confirmations saved.');
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to save confirmations.');
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    setBusy(true);
    setMessage('');
    try {
      await approveReview(applicationId);
      setMessage('Application approved.');
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Complete every review item before approval.');
    } finally {
      setBusy(false);
    }
  }

  function confirmApprove() {
    Alert.alert('Approve application?', `Approve the prepared application for ${role} at ${company}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', style: 'default', onPress: () => void handleApprove() },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={theme.text} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{company}</Text>
      <Text style={styles.title}>{role}</Text>

      {review && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Readiness</Text>
          <Text style={styles.readiness}>{review.review.status}</Text>
          {review.review.readiness_issues.length > 0 ? (
            review.review.readiness_issues.map((issue) => (
              <Text key={issue} style={styles.issue}>
                • {issue}
              </Text>
            ))
          ) : (
            <Text style={styles.issue}>All required review items are complete.</Text>
          )}
        </View>
      )}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Pressable style={styles.secondaryButton} onPress={handleConfirm} disabled={busy}>
        <Text style={styles.secondaryButtonText}>Confirm review items</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={confirmApprove} disabled={busy}>
        {busy ? <ActivityIndicator color={theme.background} /> : <Text style={styles.buttonText}>Approve application package</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingTop: 60 },
  eyebrow: { color: theme.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { color: theme.text, fontSize: 24, fontWeight: '700', marginTop: 4, marginBottom: 20 },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  cardLabel: { color: theme.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  readiness: { color: theme.text, fontSize: 20, fontWeight: '700', marginTop: 6, marginBottom: 10, textTransform: 'capitalize' },
  issue: { color: theme.textSecondary, fontSize: 14, marginTop: 4 },
  message: { color: theme.accent, marginBottom: 16 },
  secondaryButton: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryButtonText: { color: theme.text, fontWeight: '600' },
  button: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: theme.background, fontWeight: '700', fontSize: 16 },
});
