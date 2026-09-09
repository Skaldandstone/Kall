import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  approveReview,
  confirmReview,
  fetchReview,
  saveAnswer,
  type ReviewData,
} from "../api/applications";
import { ApiError } from "../api/client";
import { theme } from "../theme";
import type { ApplicationsStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<
  ApplicationsStackParamList,
  "ApplicationDetail"
>;

function humanizeStatus(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function ApplicationDetailScreen({ route, navigation }: Props) {
  const { applicationId, company, role, stage } = route.params;
  const showInterviewPrep = stage === "submitted" || stage === "interview";
  const [review, setReview] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      const next = await fetchReview(applicationId);
      setReview(next);
      setAnswerDrafts(
        Object.fromEntries(
          next.answers.map((answer) => [answer.id, answer.value || ""]),
        ),
      );
    } catch {
      setMessage("Unable to load this application for review.");
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleApprove() {
    setBusy(true);
    setMessage("");
    try {
      await approveReview(applicationId);
      setMessage("Application approved.");
      await load();
    } catch (err) {
      setMessage(
        err instanceof ApiError
          ? err.message
          : "Complete every review item before approval.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveReview() {
    if (!review) return;
    setBusy(true);
    setMessage("");
    try {
      await Promise.all(
        review.answers.map((answer) =>
          saveAnswer(applicationId, answer.id, answerDrafts[answer.id] || ""),
        ),
      );
      await confirmReview(applicationId, {
        documents_confirmed: Boolean(review.review.documents_confirmed),
        answers_confirmed: Boolean(review.review.answers_confirmed),
        sensitive_fields_confirmed: Boolean(
          review.review.sensitive_fields_confirmed,
        ),
        attestations_confirmed: Boolean(review.review.attestations_confirmed),
      });
      setMessage("Review saved.");
      await load();
    } catch (err) {
      setMessage(
        err instanceof ApiError ? err.message : "Unable to save this review.",
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmApprove() {
    Alert.alert(
      "Approve application?",
      `Approve the prepared application for ${role} at ${company}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          style: "default",
          onPress: () => void handleApprove(),
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator
          color={theme.text}
          accessibilityLabel="Loading application review"
        />
      </View>
    );
  }

  const canApprove =
    review?.review.status === "ready" &&
    review.review.readiness_issues.length === 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{company}</Text>
      <Text style={styles.title}>{role}</Text>

      {review && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Readiness</Text>
          <Text style={styles.readiness}>{humanizeStatus(review.review.status)}</Text>
          {review.review.readiness_issues.length > 0 ? (
            review.review.readiness_issues.map((issue) => (
              <Text key={issue} style={styles.issue}>
                • {issue}
              </Text>
            ))
          ) : (
            <Text style={styles.issue}>
              All required review items are complete.
            </Text>
          )}
        </View>
      )}

      {review && review.questions.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Application answers</Text>
          {review.questions.map((question) => {
            const answer = review.answers.find(
              (item) => item.question_id === question.id,
            );
            if (!answer) return null;
            return (
              <View key={question.id} style={styles.answerField}>
                <Text style={styles.answerLabel}>
                  {question.prompt}
                  {question.required ? " *" : ""}
                </Text>
                <TextInput
                  accessibilityLabel={question.prompt}
                  multiline
                  style={styles.answerInput}
                  value={answerDrafts[answer.id] || ""}
                  onChangeText={(value) =>
                    setAnswerDrafts({ ...answerDrafts, [answer.id]: value })
                  }
                />
              </View>
            );
          })}
        </View>
      ) : null}

      {review ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Review checklist</Text>
          {(
            [
              ["documents_confirmed", "Documents reviewed"],
              ["answers_confirmed", "Answers reviewed"],
              ["sensitive_fields_confirmed", "Sensitive fields checked"],
              ["attestations_confirmed", "Attestations confirmed"],
            ] as const
          ).map(([key, label]) => (
            <View key={key} style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>{label}</Text>
              <Switch
                value={Boolean(review.review[key])}
                onValueChange={(value) =>
                  setReview({
                    ...review,
                    review: { ...review.review, [key]: value },
                  })
                }
                trackColor={{ false: theme.border, true: theme.accent }}
              />
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            style={styles.secondaryButton}
            disabled={busy}
            onPress={() => void saveReview()}
          >
            <Text style={styles.secondaryButtonText}>Save review</Text>
          </Pressable>
        </View>
      ) : null}

      {!canApprove ? (
        <Text style={styles.guidance} accessibilityRole="summary">
          Complete the review checklist and required answers. Detailed document
          editing remains available in the web workspace.
        </Text>
      ) : null}

      {showInterviewPrep && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Interview prep</Text>
          <Text style={styles.readiness}>
            {stage === "interview"
              ? "You're in the Interview stage."
              : "Get ahead of it before an interview is scheduled."}
          </Text>
          <Text style={styles.issue}>
            Company context, a scored practice quiz, and good questions to ask
            back.
          </Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={() =>
              navigation.navigate("InterviewPrep", {
                applicationId,
                company,
                role,
              })
            }
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Help prepare</Text>
          </Pressable>
        </View>
      )}

      {message ? (
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}

      <Pressable
        style={[styles.button, (!canApprove || busy) && styles.buttonDisabled]}
        onPress={confirmApprove}
        disabled={!canApprove || busy}
        accessibilityRole="button"
        accessibilityHint="Approves this package but does not submit it to the employer"
        accessibilityState={{ disabled: !canApprove || busy, busy }}
      >
        {busy ? (
          <ActivityIndicator color={theme.background} />
        ) : (
          <Text style={styles.buttonText}>Approve application package</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingTop: 24, paddingBottom: 40 },
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
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  cardLabel: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  readiness: {
    color: theme.text,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 6,
    marginBottom: 10,
    textTransform: "capitalize",
  },
  issue: { color: theme.textSecondary, fontSize: 14, marginTop: 4 },
  message: { color: theme.accent, marginBottom: 16 },
  guidance: {
    color: theme.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: theme.background, fontWeight: "700", fontSize: 16 },
  secondaryButton: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
    marginTop: 10,
  },
  secondaryButtonText: { color: theme.text, fontWeight: "600", fontSize: 13 },
  answerField: { marginTop: 14 },
  answerLabel: {
    color: theme.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  answerInput: {
    minHeight: 72,
    color: theme.text,
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    padding: 12,
    marginTop: 6,
    textAlignVertical: "top",
    fontWeight: "400",
  },
  confirmRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  confirmLabel: { flex: 1, color: theme.text, fontSize: 14, fontWeight: "600" },
});
