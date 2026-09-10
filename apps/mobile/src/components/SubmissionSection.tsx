import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError } from "../api/client";
import {
  attemptSubmission,
  confirmSubmission,
  downloadResume,
  fetchAutofillPack,
  listSubmissions,
  moveApplicationStage,
  prepareSubmission,
  type AutofillField,
  type AutofillPack,
  type PipelineStage,
  type Submission,
} from "../api/submissions";
import { safeFileName, saveAndShare } from "../lib/files";
import { theme } from "../theme";
import { FormActions, SwitchRow, formStyles } from "./form";

const AFTER_APPROVAL = new Set<PipelineStage | string>(["approved", "submitted", "interview"]);

const STAGE_OPTIONS: Array<{ value: PipelineStage; label: string; from: string[] }> = [
  { value: "submitted", label: "I submitted it", from: ["approved"] },
  { value: "interview", label: "Interview scheduled", from: ["approved", "submitted"] },
  { value: "submitted", label: "Back to submitted", from: ["interview"] },
  { value: "closed", label: "Closed", from: ["preparing", "review", "approved", "submitted", "interview", "rejected"] },
  { value: "rejected", label: "Rejected", from: ["submitted", "interview", "approved"] },
];

function displayValue(value: AutofillField["value"]) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function describeSubmission(submission: Submission | null) {
  if (!submission) return "No submission record yet.";
  switch (submission.status) {
    case "awaiting_confirmation": return "Record prepared. Confirm it while your approval is fresh (within 30 minutes).";
    case "confirmed": return "Confirmed. When you have pressed Submit on the employer's form, record it here.";
    case "submitted": return `Recorded as submitted${submission.submitted_at ? ` on ${new Date(submission.submitted_at).toLocaleString()}` : ""}.`;
    case "needs_manual_completion": return `Needs you to finish it on the employer's site: ${submission.failure_detail ?? "see the form"}.`;
    case "blocked": return `Blocked: ${submission.failure_detail ?? "the approval or documents changed"}. Approve again, then prepare a fresh record.`;
    default: return `Status: ${submission.status.replace(/_/g, " ")}.`;
  }
}

export default function SubmissionSection({ applicationId, company, role, stage, onStage }: {
  applicationId: number;
  company: string;
  role: string;
  stage: string;
  onStage: (stage: PipelineStage) => void;
}) {
  const afterApproval = AFTER_APPROVAL.has(stage);
  const [pack, setPack] = useState<AutofillPack | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!afterApproval) return;
    const [nextPack, submissions] = await Promise.all([
      fetchAutofillPack(applicationId).catch(() => null),
      listSubmissions().catch(() => [] as Submission[]),
    ]);
    setPack(nextPack);
    setSubmission(submissions.find((item) => item.application_id === applicationId) ?? null);
  }, [afterApproval, applicationId]);

  useEffect(() => { void load(); }, [load]);

  async function run(key: string, work: () => Promise<string | void>, fallback: string) {
    setBusy(key);
    setMessage("");
    try {
      const result = await work();
      if (result) setMessage(result);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  function shareResume() {
    if (!pack?.resume) return;
    const resume = pack.resume;
    void run("resume", async () => {
      const { bytes, mimeType } = await downloadResume(resume.resume_id);
      await saveAndShare(bytes, safeFileName(resume.filename), resume.mime_type || mimeType);
    }, "Unable to fetch the resume file.");
  }

  function prepare() {
    void run("prepare", async () => {
      setSubmission(await prepareSubmission(applicationId));
      return "Submission record prepared.";
    }, "Unable to prepare the submission record.");
  }

  function confirm() {
    if (!submission) return;
    void run("confirm", async () => {
      const next = await confirmSubmission(submission.id);
      setSubmission(next);
      return next.status === "confirmed" ? "Confirmed." : undefined;
    }, "Unable to confirm the submission record.");
  }

  function recordSubmitted() {
    if (!submission) return;
    void run("attempt", async () => {
      await attemptSubmission(submission.id);
      setSubmission({ ...submission, status: "submitted", submitted_at: new Date().toISOString() });
      onStage("submitted");
      return "Recorded as submitted.";
    }, "Unable to record the submission.");
  }

  function move(next: PipelineStage) {
    void run(`stage-${next}`, async () => {
      const result = await moveApplicationStage(applicationId, next);
      onStage(result.stage);
      return `Moved to ${next}.`;
    }, "Unable to update the stage.");
  }

  const auto = pack?.fields.filter((field) => !field.requires_confirmation) ?? [];
  const needsConfirmation = pack?.fields.filter((field) => field.requires_confirmation) ?? [];
  const stageOptions = STAGE_OPTIONS.filter((option) => option.from.includes(stage));

  return (
    <>
      {message ? <Text style={message.startsWith("Unable") ? formStyles.error : formStyles.success}>{message}</Text> : null}

      {afterApproval ? (
        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Apply on the employer's site</Text>
          <Text style={formStyles.body}>
            Kall pre-fills what it can and hands you the form. You press Submit yourself; Kall never submits on your behalf.
          </Text>
          {!pack ? (
            <Text style={[formStyles.muted, styles.spaced]}>Loading what Kall can fill in…</Text>
          ) : (
            <>
              <Text style={styles.subheading}>Filled automatically ({auto.length})</Text>
              {auto.length === 0 ? <Text style={formStyles.muted}>Nothing yet. Add details to your professional record and they appear here.</Text> : null}
              {auto.map((field) => (
                <View key={field.path} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  <Text style={styles.fieldValue} numberOfLines={2}>{displayValue(field.value)}</Text>
                </View>
              ))}
              {needsConfirmation.length > 0 ? (
                <>
                  <Text style={styles.subheading}>Only with your say-so ({needsConfirmation.filter((field) => confirmed[field.path]).length} of {needsConfirmation.length})</Text>
                  <Text style={formStyles.muted}>Self-identification and work-authorization answers stay blank unless you switch them on for this application.</Text>
                  {needsConfirmation.map((field) => (
                    <SwitchRow
                      key={field.path}
                      label={field.label}
                      detail={confirmed[field.path] ? displayValue(field.value) : "Prefer not to answer"}
                      value={Boolean(confirmed[field.path])}
                      onChange={(on) => setConfirmed((current) => ({ ...current, [field.path]: on }))}
                    />
                  ))}
                </>
              ) : null}
              {pack.omitted.length > 0 ? (
                <>
                  <Text style={styles.subheading}>You will type these ({pack.omitted.length})</Text>
                  {pack.omitted.map((row) => (
                    <View key={row.path} style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>{row.label}</Text>
                      <Text style={[formStyles.muted, styles.fieldValue]} numberOfLines={2}>{row.reason}</Text>
                    </View>
                  ))}
                </>
              ) : null}
              <FormActions>
                {pack.resume ? (
                  <Pressable accessibilityRole="button" accessibilityHint="Fetches the resume file and opens the share sheet" disabled={busy === "resume"} style={[formStyles.secondary, busy === "resume" && formStyles.disabled]} onPress={shareResume}>
                    {busy === "resume" ? <ActivityIndicator color={theme.text} /> : <Text style={formStyles.secondaryText}>Save resume file</Text>}
                  </Pressable>
                ) : null}
                {pack.job.url ? (
                  <Pressable accessibilityRole="link" style={formStyles.primary} onPress={() => void Linking.openURL(pack.job.url as string)}>
                    <Text style={formStyles.primaryText}>Open the application form</Text>
                  </Pressable>
                ) : null}
              </FormActions>
            </>
          )}
        </View>
      ) : null}

      {afterApproval ? (
        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Submission record</Text>
          <Text style={formStyles.body}>{describeSubmission(submission)}</Text>
          <FormActions>
            {!submission || submission.status === "blocked" || submission.status === "needs_manual_completion" || submission.status === "prepared" ? (
              <Pressable accessibilityRole="button" disabled={busy === "prepare"} style={[formStyles.secondary, busy === "prepare" && formStyles.disabled]} onPress={prepare}>
                {busy === "prepare" ? <ActivityIndicator color={theme.text} /> : <Text style={formStyles.secondaryText}>{submission ? "Prepare a fresh record" : "Prepare submission record"}</Text>}
              </Pressable>
            ) : null}
            {submission?.status === "awaiting_confirmation" ? (
              <Pressable accessibilityRole="button" disabled={busy === "confirm"} style={[formStyles.primary, busy === "confirm" && formStyles.disabled]} onPress={confirm}>
                {busy === "confirm" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Confirm record</Text>}
              </Pressable>
            ) : null}
            {submission?.status === "confirmed" ? (
              <Pressable accessibilityRole="button" disabled={busy === "attempt"} style={[formStyles.primary, busy === "attempt" && formStyles.disabled]} onPress={recordSubmitted}>
                {busy === "attempt" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>I pressed Submit</Text>}
              </Pressable>
            ) : null}
          </FormActions>
        </View>
      ) : null}

      {stageOptions.length > 0 ? (
        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Update stage</Text>
          <Text style={formStyles.body}>{role} at {company} is {stage.replace(/_/g, " ")}.</Text>
          <FormActions>
            {stageOptions.map((option) => (
              <Pressable
                key={`${option.value}-${option.label}`}
                accessibilityRole="button"
                disabled={busy === `stage-${option.value}`}
                style={[formStyles.secondary, busy === `stage-${option.value}` && formStyles.disabled]}
                onPress={() => move(option.value)}
              >
                {busy === `stage-${option.value}` ? <ActivityIndicator color={theme.text} /> : <Text style={option.value === "rejected" || option.value === "closed" ? formStyles.dangerText : formStyles.secondaryText}>{option.label}</Text>}
              </Pressable>
            ))}
          </FormActions>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  spaced: { marginTop: 10 },
  subheading: { color: theme.text, fontSize: 14, fontWeight: "700", marginTop: 14, marginBottom: 4 },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, minHeight: 30, paddingVertical: 4 },
  fieldLabel: { color: theme.textSecondary, fontSize: 13, flexShrink: 0 },
  fieldValue: { color: theme.text, fontSize: 13, fontWeight: "600", flex: 1, textAlign: "right" },
});
