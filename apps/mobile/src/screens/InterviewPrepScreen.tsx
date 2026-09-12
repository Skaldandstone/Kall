import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  fetchInterviewPrep,
  gradeQuizAttempt,
  regenerateInterviewPrep,
  saveInterviewPrepNotes,
  type GradeResult,
  type InterviewPrep,
  type QuestionBankItem,
  type QuestionToAsk,
} from '../api/interviewPrep';
import { ApiError } from '../api/client';
import { theme } from '../theme';
import type { ApplicationsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<ApplicationsStackParamList, 'InterviewPrep'>;

const QUIZ_SIZE = 5;

function groupByStage(items: QuestionToAsk[]): [string, QuestionToAsk[]][] {
  const groups = new Map<string, QuestionToAsk[]>();
  for (const item of items) {
    const list = groups.get(item.stage) || [];
    list.push(item);
    groups.set(item.stage, list);
  }
  return Array.from(groups.entries());
}

// Retaking the quiz should feel different each time -- sample a fresh
// combination from the (deliberately larger) question bank instead of
// always asking the same fixed set in the same order. Mirrors the web
// implementation in apps/web/app/applications/[id]/InterviewPrepPanel.tsx.
function sampleQuestions(pool: QuestionBankItem[], count: number): QuestionBankItem[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

export default function InterviewPrepScreen({ route }: Props) {
  const { applicationId, company, role } = route.params;
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [quizQuestions, setQuizQuestions] = useState<QuestionBankItem[] | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<string[]>([]);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizResults, setQuizResults] = useState<GradeResult[] | null>(null);
  const [quizGraded, setQuizGraded] = useState(true);

  const load = useCallback(async () => {
    try {
      const body = await fetchInterviewPrep(applicationId);
      setPrep(body);
      setNotes(body.notes);
      setMessage('');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to load interview prep.');
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function saveNotes() {
    setSaving(true);
    try {
      await saveInterviewPrepNotes(applicationId, notes);
      setMessage('Notes saved.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to save notes.');
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    setRegenerating(true);
    setMessage('Generating fresh prep…');
    try {
      const body = await regenerateInterviewPrep(applicationId);
      setPrep(body);
      setNotes(body.notes);
      setMessage('Prep refreshed.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to regenerate prep.');
    } finally {
      setRegenerating(false);
    }
  }

  function startQuiz() {
    if (!prep) return;
    const count = Math.min(QUIZ_SIZE, prep.question_bank.length);
    setQuizQuestions(sampleQuestions(prep.question_bank, count));
    setQuizAnswers(new Array(count).fill(''));
    setQuizResults(null);
    setQuizGraded(true);
  }

  function exitQuiz() {
    setQuizQuestions(null);
    setQuizAnswers([]);
    setQuizResults(null);
  }

  async function submitQuiz() {
    if (!quizQuestions) return;
    setQuizSubmitting(true);
    setMessage('Grading your answers…');
    try {
      const body = await gradeQuizAttempt(
        applicationId,
        quizQuestions.map((item, index) => ({
          question: item.question,
          category: item.category,
          answer_prompt: item.answer_prompt,
          candidate_answer: quizAnswers[index] || '',
        })),
      );
      setQuizGraded(body.enabled);
      setQuizResults(body.enabled ? body.results : null);
      setMessage(body.enabled ? '' : 'AI grading is not available -- compare your answers against the guidance below instead.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to grade this attempt.');
    } finally {
      setQuizSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={theme.text} accessibilityLabel="Loading interview prep" />
      </View>
    );
  }

  if (!prep) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.message}>{message || 'Unable to load interview prep.'}</Text>
      </View>
    );
  }

  if (quizQuestions) {
    const submitted = quizResults !== null || !quizGraded;
    const average = quizResults ? Math.round(quizResults.reduce((sum, r) => sum + r.score_percent, 0) / quizResults.length) : null;
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>Practice quiz</Text>
        {average !== null && <Text style={styles.title}>{average}% average</Text>}
        {!submitted && <Text style={styles.hint}>Answer in your own words -- guidance is only shown after you submit.</Text>}

        {quizQuestions.map((item, index) => {
          const result = quizResults?.[index];
          return (
            <View style={styles.card} key={index}>
              <View style={styles.rowBetween}>
                <Text style={styles.pill}>{item.category}</Text>
                {result && <Text style={styles.scorePill}>{result.score_percent}%</Text>}
              </View>
              <Text style={styles.question}>{item.question}</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={quizAnswers[index] || ''}
                onChangeText={(text) => setQuizAnswers((current) => current.map((v, i) => (i === index ? text : v)))}
                placeholder="Type your answer here."
                placeholderTextColor={theme.textMuted}
                editable={!submitted}
                multiline
                numberOfLines={4}
              />
              {result && (
                <View style={styles.subsection}>
                  <Text style={styles.body}>{result.feedback}</Text>
                  {result.missed_points.length > 0 && (
                    <Text style={styles.bullet}><Text style={styles.bulletStrong}>What was missing: </Text>{result.missed_points.join(' · ')}</Text>
                  )}
                  {result.additional_resources.length > 0 && (
                    <Text style={styles.bullet}><Text style={styles.bulletStrong}>Worth reviewing: </Text>{result.additional_resources.join(' · ')}</Text>
                  )}
                </View>
              )}
              {submitted && !quizGraded && (
                <View style={styles.subsection}>
                  <Text style={styles.bullet}><Text style={styles.bulletStrong}>How to structure this: </Text>{item.answer_prompt}</Text>
                  {item.resources.length > 0 && (
                    <Text style={styles.bullet}><Text style={styles.bulletStrong}>Worth reviewing: </Text>{item.resources.join(' · ')}</Text>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {!submitted ? (
          <Pressable style={styles.button} onPress={() => void submitQuiz()} disabled={quizSubmitting}>
            {quizSubmitting ? <ActivityIndicator color={theme.background} /> : <Text style={styles.buttonText}>Submit quiz</Text>}
          </Pressable>
        ) : (
          <Pressable style={styles.button} onPress={startQuiz}>
            <Text style={styles.buttonText}>Retake quiz</Text>
          </Pressable>
        )}
        <Pressable style={styles.secondaryButton} onPress={exitQuiz}>
          <Text style={styles.secondaryButtonText}>Back to prep</Text>
        </Pressable>
        {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{company}</Text>
      <Text style={styles.title}>{role}</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Company context</Text>
        <Text style={styles.hint}>Kall's best inference from the job posting itself, not verified research -- look the company up yourself before relying on this.</Text>
        <Text style={styles.body}>{prep.company_context.summary}</Text>
        {prep.company_context.likely_product && prep.company_context.likely_product !== 'Not available' && (
          <Text style={[styles.body, styles.spaceTop]}><Text style={styles.bulletStrong}>Likely product: </Text>{prep.company_context.likely_product}</Text>
        )}
        {prep.company_context.likely_tools_or_systems.length > 0 && (
          <View style={styles.chipRow}>
            {prep.company_context.likely_tools_or_systems.map((tech) => (
              <View style={styles.chip} key={tech}>
                <Text style={styles.chipText}>{tech}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Practice quiz</Text>
        <Text style={styles.hint}>
          Answer {Math.min(QUIZ_SIZE, prep.question_bank.length)} questions in your own words and get scored feedback. Retake as
          many times as you like -- each attempt draws a different combination from the {prep.question_bank.length}-question bank.
        </Text>
        <Pressable style={styles.button} onPress={startQuiz}>
          <Text style={styles.buttonText}>Take the practice quiz</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => void regenerate()} disabled={regenerating}>
          {regenerating ? <ActivityIndicator color={theme.text} /> : <Text style={styles.secondaryButtonText}>Refresh prep</Text>}
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Study the question bank</Text>
        <Text style={styles.hint}>Guidance stays hidden until you ask for it -- try recalling an answer yourself first.</Text>
        {prep.question_bank.map((item, index) => (
          <View style={styles.questionRow} key={index}>
            <Text style={styles.pill}>{item.category}</Text>
            <Text style={styles.question}>{item.question}</Text>
            {expanded === index ? (
              <>
                <Text style={styles.bullet}><Text style={styles.bulletStrong}>How to structure this: </Text>{item.answer_prompt}</Text>
                {item.resources.length > 0 && (
                  <Text style={styles.bullet}><Text style={styles.bulletStrong}>Worth reviewing: </Text>{item.resources.join(' · ')}</Text>
                )}
                <Pressable style={styles.linkButton} onPress={() => setExpanded(null)}>
                  <Text style={styles.linkButtonText}>Hide guidance</Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={styles.linkButton} onPress={() => setExpanded(index)}>
                <Text style={styles.linkButtonText}>Show guidance</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Good questions to ask</Text>
        {groupByStage(prep.questions_to_ask).map(([stage, items]) => (
          <View style={styles.subsection} key={stage}>
            <Text style={styles.stageLabel}>{stage}</Text>
            {items.map((item, index) => (
              <Text key={index} style={styles.bullet}>• {item.question}</Text>
            ))}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Your notes</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Talking points, your own research, follow-up items…"
          placeholderTextColor={theme.textMuted}
          multiline
          numberOfLines={5}
        />
        <Pressable style={styles.secondaryButton} onPress={() => void saveNotes()} disabled={saving}>
          {saving ? <ActivityIndicator color={theme.text} /> : <Text style={styles.secondaryButtonText}>Save notes</Text>}
        </Pressable>
      </View>

      {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingTop: 24, paddingBottom: 40 },
  eyebrow: { color: theme.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { color: theme.text, fontSize: 22, fontWeight: '700', marginTop: 4, marginBottom: 16 },
  hint: { color: theme.textMuted, fontSize: 12, marginTop: 6, marginBottom: 8, lineHeight: 17 },
  body: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  spaceTop: { marginTop: 8 },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardLabel: { color: theme.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { borderColor: theme.border, borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: theme.textSecondary, fontSize: 12, fontWeight: '600' },
  questionRow: { marginTop: 14, paddingTop: 14, borderTopColor: theme.border, borderTopWidth: 1 },
  pill: { color: theme.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  scorePill: { color: theme.accent, fontSize: 13, fontWeight: '700' },
  question: { color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 6, marginBottom: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subsection: { marginTop: 14 },
  stageLabel: { color: theme.text, fontSize: 13, fontWeight: '700', textTransform: 'capitalize', marginBottom: 6 },
  bullet: { color: theme.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  bulletStrong: { color: theme.text, fontWeight: '700' },
  linkButton: { marginTop: 8, alignSelf: 'flex-start' },
  linkButtonText: { color: theme.accent, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    marginBottom: 10,
    fontSize: 14,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  button: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: theme.background, fontWeight: '700', fontSize: 15 },
  secondaryButton: { borderColor: theme.border, borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', marginTop: 10 },
  secondaryButtonText: { color: theme.text, fontWeight: '600', fontSize: 13 },
  message: { color: theme.accent, marginTop: 16, textAlign: 'center' },
});
