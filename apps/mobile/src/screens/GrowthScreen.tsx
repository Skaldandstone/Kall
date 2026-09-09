import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  analyzeSkills,
  createGoal,
  fetchGrowthDashboard,
  generatePlan,
  importResource,
  pinResource,
  type Assessment,
  type Goal,
  type GrowthDashboard,
  type Plan,
} from '../api/growth';
import { ApiError } from '../api/client';
import { theme } from '../theme';
import { PageHeader, SectionHeader, StatusMessage } from '../components/ui';

const BUDGET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'free_or_low_cost', label: 'Free / low cost' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'premium', label: 'Premium' },
];

const STARTING_POINTS = [
  { icon: 'arrow-up-circle-outline' as const, title: 'Move up', detail: 'Prepare for your next level', goal: 'Move into a leadership role' },
  { icon: 'navigate-circle-outline' as const, title: 'Change direction', detail: 'Build a practical transition plan', goal: 'Transition into a new career' },
  { icon: 'flash-outline' as const, title: 'Sharpen skills', detail: 'Close a specific experience gap', goal: 'Strengthen my professional skills' },
];

export default function GrowthScreen() {
  const insets = useSafeAreaInsets();
  const [dashboard, setDashboard] = useState<GrowthDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');

  const [showNewGoal, setShowNewGoal] = useState(false);
  const [title, setTitle] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [targetIndustry, setTargetIndustry] = useState('');
  const [hoursPerWeek, setHoursPerWeek] = useState('5');
  const [budget, setBudget] = useState('free_or_low_cost');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setDashboard(await fetchGrowthDashboard());
      setMessage('');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to load your growth workspace.');
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

  async function submitNewGoal() {
    if (!title.trim() || !targetRole.trim()) {
      setMessage('Give the goal a name and a target role first.');
      return;
    }
    setCreating(true);
    setMessage('Building your plan…');
    try {
      const goal = await createGoal({
        title: title.trim(),
        target_role: targetRole.trim(),
        target_industry: targetIndustry.trim() || undefined,
        time_per_week_hours: Number(hoursPerWeek) || undefined,
        budget_preference: budget,
      });
      await generatePlan(goal.id, false);
      setTitle('');
      setTargetRole('');
      setTargetIndustry('');
      setHoursPerWeek('5');
      setBudget('free_or_low_cost');
      setShowNewGoal(false);
      await load();
      setMessage('Your growth plan is ready.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to create that goal.');
    } finally {
      setCreating(false);
    }
  }

  async function handleGenerate(goalId: number, regenerate: boolean) {
    setMessage(regenerate ? 'Regenerating your plan…' : 'Building your plan…');
    try {
      await generatePlan(goalId, regenerate);
      await load();
      setMessage(regenerate ? 'Growth plan regenerated.' : 'Growth plan created.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to generate that plan.');
    }
  }

  function startGoal(goal = '') {
    setTitle(goal);
    setShowNewGoal(true);
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={theme.text} />
      </View>
    );
  }

  const goals = dashboard?.goals ?? [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.text} />}
    >
      <View style={styles.header}>
        <PageHeader eyebrow="Career development" title="Grow with direction" description="A practical plan shaped around where you want to go next." />
      </View>

      {!showNewGoal && goals.length > 0 ? (
        <Pressable accessibilityRole="button" style={styles.newGoalButton} onPress={() => setShowNewGoal(true)}>
          <Ionicons name="add" size={18} color={theme.accentInk} /><Text style={styles.newGoalButtonText}>New career goal</Text>
        </Pressable>
      ) : showNewGoal ? (
        <View style={styles.card}>
          <SectionHeader title="Shape your goal" detail="Start with the role. Kall will help build the route." />
          <TextInput accessibilityLabel="Goal name" style={styles.input} value={title} onChangeText={setTitle} placeholder="Goal name, e.g. Move into game art" placeholderTextColor={theme.textMuted} />
          <TextInput accessibilityLabel="Target role" style={styles.input} value={targetRole} onChangeText={setTargetRole} placeholder="Target role, e.g. Environment Artist" placeholderTextColor={theme.textMuted} />
          <TextInput accessibilityLabel="Target industry, optional" style={styles.input} value={targetIndustry} onChangeText={setTargetIndustry} placeholder="Target industry (optional)" placeholderTextColor={theme.textMuted} />
          <TextInput accessibilityLabel="Hours per week" style={styles.input} value={hoursPerWeek} onChangeText={setHoursPerWeek} placeholder="Hours per week" placeholderTextColor={theme.textMuted} keyboardType="numeric" />
          <View style={styles.chipRow}>
            {BUDGET_OPTIONS.map((option) => (
              <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: budget === option.value }} style={[styles.chip, budget === option.value && styles.chipActive]} onPress={() => setBudget(option.value)}>
                <Text style={[styles.chipText, budget === option.value && styles.chipTextActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actionsRow}>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => setShowNewGoal(false)} disabled={creating}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: creating, busy: creating }} style={styles.button} onPress={() => void submitNewGoal()} disabled={creating}>
              {creating ? <ActivityIndicator color={theme.background} /> : <Text style={styles.buttonText}>Create goal and plan</Text>}
            </Pressable>
          </View>
        </View>
      ) : null}

      {message ? <StatusMessage kind={message.toLowerCase().includes('unable') || message.toLowerCase().includes('first') ? 'error' : 'neutral'}>{message}</StatusMessage> : null}

      {goals.length === 0 ? (
        <View style={styles.emptyState}>
          {!showNewGoal ? <>
            <View style={styles.emptyIllustration}><View style={styles.pathLine} /><View style={[styles.pathDot, styles.pathDotOne]} /><View style={[styles.pathDot, styles.pathDotTwo]} /><View style={[styles.pathDot, styles.pathDotThree]}><Ionicons name="flag" size={17} color={theme.accentInk} /></View></View>
            <Text accessibilityRole="header" style={styles.emptyTitle}>What are you working toward?</Text>
            <Text style={styles.emptyBody}>Choose a starting point. You can make it specific on the next step.</Text>
            <View style={styles.startingPoints}>
              {STARTING_POINTS.map((item) => <Pressable key={item.title} accessibilityRole="button" style={styles.startingPoint} onPress={() => startGoal(item.goal)}>
                <View style={styles.startIcon}><Ionicons name={item.icon} size={20} color={theme.accent} /></View>
                <View style={styles.startCopy}><Text style={styles.startTitle}>{item.title}</Text><Text style={styles.startDetail}>{item.detail}</Text></View>
                <Ionicons name="chevron-forward" size={17} color={theme.textMuted} />
              </Pressable>)}
            </View>
          </> : null}
        </View>
      ) : (
        goals.map(({ goal, plan }) => (
          <GoalCard key={goal.id} goal={goal} plan={plan} onGenerate={handleGenerate} onReload={load} onError={setMessage} />
        ))
      )}
    </ScrollView>
  );
}

function GoalCard({
  goal,
  plan,
  onGenerate,
  onReload,
  onError,
}: {
  goal: Goal;
  plan: Plan | null;
  onGenerate: (goalId: number, regenerate: boolean) => Promise<void>;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [answer, setAnswer] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [resourceUrl, setResourceUrl] = useState('');
  const [resourceTitle, setResourceTitle] = useState('');
  const [savingResource, setSavingResource] = useState(false);
  const [pendingResourceId, setPendingResourceId] = useState<number | null>(null);

  async function handleAnalyze() {
    if (answer.trim().length < 2) {
      onError('Describe your current skills or background first.');
      return;
    }
    setAnalyzing(true);
    try {
      await analyzeSkills(goal.id, answer.trim());
      setAnswer('');
      await onReload();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Unable to analyze your skills right now.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSaveResource() {
    if (!plan || !resourceUrl.trim() || !resourceTitle.trim()) {
      onError('Add both a URL and a title to save a resource.');
      return;
    }
    setSavingResource(true);
    try {
      await importResource(plan.plan.id, resourceUrl.trim(), resourceTitle.trim());
      setResourceUrl('');
      setResourceTitle('');
      await onReload();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Unable to save that resource.');
    } finally {
      setSavingResource(false);
    }
  }

  async function handlePin(resourceId: number, saved: boolean) {
    setPendingResourceId(resourceId);
    try {
      await pinResource(resourceId, saved);
      await onReload();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Unable to update that resource.');
    } finally {
      setPendingResourceId(null);
    }
  }

  const latestAssessment: Assessment | undefined = plan?.skill_assessments[0];
  const sortedResources = plan ? [...plan.resources].sort((a, b) => Number(b.saved) - Number(a.saved)) : [];

  return (
    <View style={styles.card}>
      <Text style={styles.pill}>{goal.status}</Text>
      <Text style={styles.goalTitle}>{goal.title}</Text>
      <Text style={styles.goalMeta}>
        {goal.target_role}
        {goal.target_industry ? ` · ${goal.target_industry}` : ''}
      </Text>

      {!plan ? (
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => void onGenerate(goal.id, false)}>
          <Text style={styles.buttonText}>Generate plan</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.summary}>{plan.plan.summary}</Text>
          <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => void onGenerate(goal.id, true)}>
            <Text style={styles.secondaryButtonText}>Regenerate plan</Text>
          </Pressable>

          {plan.plan.current_strengths.length > 0 && (
            <View style={styles.subsection}>
              <Text style={styles.sectionLabel}>Current strengths</Text>
              {plan.plan.current_strengths.map((item) => (
                <Text key={item} style={styles.bullet}>• {item}</Text>
              ))}
            </View>
          )}
          {plan.plan.skill_gaps.length > 0 && (
            <View style={styles.subsection}>
              <Text style={styles.sectionLabel}>Priority gaps</Text>
              {plan.plan.skill_gaps.map((item) => (
                <Text key={item} style={styles.bullet}>• {item}</Text>
              ))}
            </View>
          )}

          {plan.milestones.length > 0 && (
            <View style={styles.subsection}>
              <Text style={styles.sectionLabel}>Milestones</Text>
              {plan.milestones.map((item) => (
                <View key={item.id} style={styles.milestoneCard}>
                  <Text style={styles.milestonePhase}>{item.phase}</Text>
                  <Text style={styles.milestoneTitle}>{item.title}</Text>
                  <Text style={styles.milestoneDescription}>{item.description}</Text>
                  <Text style={styles.milestoneMeta}>
                    {item.estimated_hours ? `${item.estimated_hours} estimated hours` : 'Flexible timing'}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.subsection}>
            <Text style={styles.sectionLabel}>Analyze my skills</Text>
            <Text style={styles.sectionHint}>Describe your current skills, education, or vocational experience.</Text>
            <TextInput
              accessibilityLabel="Current skills and background"
              style={[styles.input, styles.multiline]}
              value={answer}
              onChangeText={setAnswer}
              placeholder="e.g. Three years building websites, plus a UX design certificate…"
              placeholderTextColor={theme.textMuted}
              multiline
              numberOfLines={4}
            />
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: analyzing, busy: analyzing }} style={styles.secondaryButton} onPress={() => void handleAnalyze()} disabled={analyzing}>
              {analyzing ? <ActivityIndicator color={theme.text} /> : <Text style={styles.secondaryButtonText}>AI Analyze</Text>}
            </Pressable>
            {latestAssessment && (
              <View style={styles.assessment}>
                <Text style={styles.readiness}>{latestAssessment.readiness_score}% readiness</Text>
                <Text style={styles.milestoneDescription}>{latestAssessment.narrative}</Text>
                {latestAssessment.applicable_skills.map((item) => (
                  <Text key={item.skill} style={styles.bullet}>
                    • <Text style={styles.bulletStrong}>{item.skill}:</Text> {item.how_it_applies}
                  </Text>
                ))}
                {latestAssessment.gaps.map((item) => (
                  <Text key={item} style={styles.bullet}>• {item}</Text>
                ))}
              </View>
            )}
          </View>

          <View style={styles.subsection}>
            <Text style={styles.sectionLabel}>Find learning resources</Text>
            {plan.searches.map((item) => (
              <Pressable key={item.id} accessibilityRole="link" accessibilityHint="Opens this search in your browser" style={styles.searchRow} onPress={() => Linking.openURL(item.search_url)}>
                <Text style={styles.searchQuery}>{item.query}</Text>
                <Text style={styles.searchRationale}>{item.rationale}</Text>
              </Pressable>
            ))}
            <Text style={styles.sectionHint}>Found something worth keeping? Save it below.</Text>
            <TextInput accessibilityLabel="Resource URL" style={styles.input} value={resourceUrl} onChangeText={setResourceUrl} placeholder="Resource URL" placeholderTextColor={theme.textMuted} autoCapitalize="none" keyboardType="url" />
            <TextInput accessibilityLabel="Resource title" style={styles.input} value={resourceTitle} onChangeText={setResourceTitle} placeholder="Title" placeholderTextColor={theme.textMuted} />
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: savingResource, busy: savingResource }} style={styles.secondaryButton} onPress={() => void handleSaveResource()} disabled={savingResource}>
              {savingResource ? <ActivityIndicator color={theme.text} /> : <Text style={styles.secondaryButtonText}>Save resource</Text>}
            </Pressable>
          </View>

          <View style={styles.subsection}>
            <Text style={styles.sectionLabel}>Resources</Text>
            {sortedResources.length === 0 && <Text style={styles.sectionHint}>Save resources above that look worthwhile.</Text>}
            {sortedResources.map((item) => (
              <View key={item.id} style={styles.resourceRow}>
                <View style={styles.resourceInfo}>
                  <Pressable accessibilityRole="link" onPress={() => Linking.openURL(item.url)}>
                    <Text style={styles.resourceTitle}>{item.title}</Text>
                  </Pressable>
                  {item.description ? <Text style={styles.milestoneMeta}>{item.description}</Text> : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: pendingResourceId === item.id, selected: item.saved }}
                  style={item.saved ? styles.button : styles.secondaryButton}
                  disabled={pendingResourceId === item.id}
                  onPress={() => void handlePin(item.id, !item.saved)}
                >
                  {pendingResourceId === item.id ? (
                    <ActivityIndicator color={item.saved ? theme.background : theme.text} />
                  ) : (
                    <Text style={item.saved ? styles.buttonText : styles.secondaryButtonText}>{item.saved ? 'Pinned' : 'Pin'}</Text>
                  )}
                </Pressable>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 48 },
  header: { marginBottom: 0 },
  title: { color: theme.text, fontSize: 26, fontWeight: '700' },
  subtitle: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  message: { color: theme.textSecondary, fontSize: 13, marginBottom: 12 },
  newGoalButton: {
    minHeight: 50,
    flexDirection: 'row',
    gap: 7,
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 16,
  },
  newGoalButtonText: { color: theme.accentInk, fontWeight: '700' },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
  },
  cardLabel: { color: theme.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 10 },
  input: {
    minHeight: 52,
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 14,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { minHeight: 44, justifyContent: 'center', borderColor: theme.border, borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: theme.background },
  actionsRow: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  button: { minHeight: 48, justifyContent: 'center', backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { color: theme.background, fontWeight: '700', fontSize: 13 },
  secondaryButton: { minHeight: 48, justifyContent: 'center', borderColor: theme.borderStrong, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', marginTop: 10 },
  secondaryButtonText: { color: theme.text, fontWeight: '600', fontSize: 13 },
  emptyState: { paddingTop: 10, paddingBottom: 24 },
  emptyIllustration: { height: 72, marginBottom: 22, justifyContent: 'center' },
  pathLine: { position: 'absolute', left: 22, right: 22, top: 35, height: 2, backgroundColor: theme.borderStrong },
  pathDot: { position: 'absolute', top: 28, width: 16, height: 16, borderRadius: 8, backgroundColor: theme.surfaceInteractive, borderWidth: 3, borderColor: theme.background },
  pathDotOne: { left: 18 },
  pathDotTwo: { left: '48%' },
  pathDotThree: { right: 14, top: 20, width: 32, height: 32, borderRadius: 16, borderWidth: 0, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: theme.text, fontSize: 22, lineHeight: 28, letterSpacing: -0.35, fontWeight: '700', marginBottom: 8 },
  emptyBody: { color: theme.textSecondary, fontSize: 14, lineHeight: 21, maxWidth: 330 },
  startingPoints: { gap: 9, marginTop: 22 },
  startingPoint: { minHeight: 68, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 17, padding: 13 },
  startIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center' },
  startCopy: { flex: 1, marginHorizontal: 12 },
  startTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
  startDetail: { color: theme.textMuted, fontSize: 12, marginTop: 3 },
  pill: { color: theme.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  goalTitle: { color: theme.text, fontSize: 20, fontWeight: '700', marginTop: 6 },
  goalMeta: { color: theme.textSecondary, fontSize: 13, marginTop: 2, marginBottom: 14 },
  summary: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  subsection: { marginTop: 18 },
  sectionLabel: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  sectionHint: { color: theme.textMuted, fontSize: 12, marginBottom: 8 },
  bullet: { color: theme.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 2 },
  bulletStrong: { color: theme.text, fontWeight: '700' },
  milestoneCard: {
    backgroundColor: theme.surfaceRaised,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  milestonePhase: { color: theme.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  milestoneTitle: { color: theme.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
  milestoneDescription: { color: theme.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  milestoneMeta: { color: theme.textMuted, fontSize: 12, marginTop: 6 },
  assessment: { marginTop: 12, backgroundColor: theme.surfaceRaised, borderRadius: 10, padding: 12 },
  readiness: { color: theme.accent, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  searchRow: { borderColor: theme.border, borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  searchQuery: { color: theme.text, fontWeight: '700', fontSize: 13 },
  searchRationale: { color: theme.textMuted, fontSize: 12, marginTop: 2 },
  resourceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 },
  resourceInfo: { flex: 1 },
  resourceTitle: { color: theme.text, fontWeight: '600', fontSize: 14 },
});
