import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError } from "../api/client";
import { downloadResume, fetchAutofillPack, type AutofillField, type AutofillPack } from "../api/submissions";
import {
  downloadDocument,
  fetchApplication,
  fetchCoverLetter,
  fetchDocument,
  fetchProposal,
  type ApplicationRecord,
  type Artifact,
  type CoverLetterChange,
  type DocumentDetail,
  type TailoringChange,
} from "../api/tailoring";
import { fetchResumeStudio } from "../api/workspace";
import { safeFileName, saveAndShare } from "../lib/files";
import { theme } from "../theme";

const UTI_BY_FORMAT: Record<string, string> = {
  pdf: "com.adobe.pdf",
  docx: "org.openxmlformats.wordprocessingml.document",
};

type Props = {
  applicationId: number;
  company: string;
  onOpenTailoring: () => void;
  onOpenSensitiveDetails: () => void;
  /** True once every requested document exists in its final form, i.e. there
   * is something concrete on screen for "Documents reviewed" to attest to. */
  onDocumentsReady: (ready: boolean) => void;
};

function displayValue(value: AutofillField["value"]) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value ?? "").trim();
  return text || "—";
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Shows the concrete package an application will be submitted with — the
 * resume (original or tailored), the final rendered text, the cover letter,
 * and every profile field autofill will send — so the review checklist has
 * something real to confirm rather than four blind toggles. */
export default function PackageReview({ applicationId, company, onOpenTailoring, onOpenSensitiveDetails, onDocumentsReady }: Props) {
  const [record, setRecord] = useState<ApplicationRecord | null>(null);
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [changes, setChanges] = useState<TailoringChange[] | null>(null);
  const [tailoringStatus, setTailoringStatus] = useState<string | null>(null);
  const [letter, setLetter] = useState<{ status: string; changes: CoverLetterChange[] } | null>(null);
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [pack, setPack] = useState<AutofillPack | null>(null);
  const [showResumeText, setShowResumeText] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const application = await fetchApplication(applicationId);
      setRecord(application);
      const payload = application.prepared_payload;
      const [studio, proposal, coverLetter, generated, autofill] = await Promise.all([
        application.base_resume_id ? fetchResumeStudio().catch(() => null) : Promise.resolve(null),
        payload.tailoring_proposal_id ? fetchProposal(payload.tailoring_proposal_id).catch(() => null) : Promise.resolve(null),
        payload.cover_letter_proposal_id ? fetchCoverLetter(payload.cover_letter_proposal_id).catch(() => null) : Promise.resolve(null),
        payload.generated_document_id ? fetchDocument(payload.generated_document_id).catch(() => null) : Promise.resolve(null),
        fetchAutofillPack(applicationId).catch(() => null),
      ]);
      setResumeName(studio?.resumes.find((item) => item.id === application.base_resume_id)?.name ?? null);
      setChanges(proposal?.changes ?? null);
      setTailoringStatus(proposal?.proposal.status ?? null);
      setLetter(coverLetter ? { status: coverLetter.proposal.status, changes: coverLetter.changes } : null);
      setDocument(generated);
      setPack(autofill);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to load the application package.");
    } finally {
      setLoaded(true);
    }
  }, [applicationId]);

  useEffect(() => { void load(); }, [load]);

  const payload = record?.prepared_payload;
  const customized = Boolean(payload?.customize_resume);
  const wantsLetter = Boolean(payload?.generate_cover_letter);
  const nothingRequested = !customized && !wantsLetter;
  const tailoringDone = nothingRequested ? true : !payload?.tailoring_proposal_id ? false : tailoringStatus === "finalized";
  const letterDone = !wantsLetter ? true : letter?.status === "finalized";
  const documentReady = document !== null;
  const documentsReady = loaded && (nothingRequested || (tailoringDone && letterDone && documentReady));

  useEffect(() => { onDocumentsReady(documentsReady); }, [documentsReady, onDocumentsReady]);

  async function run(key: string, work: () => Promise<void>, fallback: string) {
    setBusy(key);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof ApiError || error instanceof Error ? error.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  function shareArtifact(artifact: Artifact) {
    if (!document) return;
    void run(`doc-${artifact.format}`, async () => {
      const { bytes, mimeType } = await downloadDocument(document.document.id, artifact.format);
      await saveAndShare(bytes, `kall-resume-${safeFileName(company)}.${artifact.format}`, artifact.mime_type || mimeType, UTI_BY_FORMAT[artifact.format]);
    }, "Unable to open that file.");
  }

  function shareOriginalResume() {
    if (!record?.base_resume_id) return;
    const resumeId = record.base_resume_id;
    void run("original", async () => {
      const { bytes, mimeType } = await downloadResume(resumeId);
      const extension = mimeType.includes("pdf") ? "pdf" : mimeType.includes("word") ? "docx" : "txt";
      await saveAndShare(bytes, `${safeFileName(resumeName || "resume")}.${extension}`, mimeType, UTI_BY_FORMAT[extension]);
    }, "Unable to open your resume.");
  }

  if (!loaded || !record) return null;

  const pendingChanges = changes?.filter((change) => change.status === "pending").length ?? 0;
  const acceptedChanges = changes?.filter((change) => change.status === "accepted" || change.status === "edited").length ?? 0;
  const rejectedChanges = changes?.filter((change) => change.status === "rejected").length ?? 0;
  const letterParagraphs = (letter?.changes ?? [])
    .filter((change) => change.status !== "rejected")
    .sort((a, b) => a.position - b.position);
  const sections = document?.document.content_json?.sections ?? [];
  const alwaysFields = pack?.fields.filter((field) => field.tier === "always") ?? [];
  const optInFields = pack?.fields.filter((field) => field.tier === "opt_in") ?? [];
  const attestationFields = pack?.fields.filter((field) => field.tier === "always_confirm") ?? [];

  return (
    <View>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Resume</Text>
        <Text style={styles.heading}>{resumeName ?? (record.base_resume_id ? "Your resume" : "No resume attached")}</Text>
        {nothingRequested ? (
          <>
            <Text style={styles.copy}>Sent exactly as you uploaded it. No AI changes were requested for this application.</Text>
            {record.base_resume_id ? (
              <Pressable accessibilityRole="button" disabled={busy !== null} style={styles.secondary} onPress={shareOriginalResume}>
                <Text style={styles.secondaryText}>{busy === "original" ? "Opening…" : "Open resume"}</Text>
              </Pressable>
            ) : null}
          </>
        ) : !payload?.tailoring_proposal_id ? (
          <Text style={styles.copy}>Kall has not proposed changes yet. Open the tailored resume to start.</Text>
        ) : tailoringStatus === "finalized" ? (
          <Text style={styles.copy}>
            Tailoring finalized: {acceptedChanges} change{acceptedChanges === 1 ? "" : "s"} kept
            {rejectedChanges ? `, ${rejectedChanges} rejected` : ""}.
          </Text>
        ) : (
          <Text style={styles.warning}>
            {pendingChanges > 0
              ? `${pendingChanges} proposed change${pendingChanges === 1 ? "" : "s"} still need${pendingChanges === 1 ? "s" : ""} your decision.`
              : "Every change is decided — finalize the tailoring to lock the text."}
          </Text>
        )}

        {!nothingRequested && document ? (
          <>
            <Text style={styles.subheading}>Final resume text</Text>
            {sections.length === 0 ? (
              <Text style={styles.copy}>Generated as {document.document.template_key} layout.</Text>
            ) : (
              <>
                <Pressable accessibilityRole="button" onPress={() => setShowResumeText((value) => !value)} style={styles.link}>
                  <Text style={styles.linkText}>{showResumeText ? "Hide the full text" : `Read all ${sections.length} sections`}</Text>
                </Pressable>
                {(showResumeText ? sections : sections.slice(0, 1)).map((section, index) => (
                  <View key={`${section.section}-${index}`} style={styles.section}>
                    <Text style={styles.sectionTitle}>{humanize(section.section)}</Text>
                    <Text style={styles.sectionText} numberOfLines={showResumeText ? undefined : 6}>{section.text}</Text>
                  </View>
                ))}
              </>
            )}
            <View style={styles.row}>
              {document.artifacts.filter((artifact) => artifact.format !== "txt").map((artifact) => (
                <Pressable
                  key={artifact.format}
                  accessibilityRole="button"
                  disabled={busy !== null}
                  style={styles.secondary}
                  onPress={() => shareArtifact(artifact)}
                >
                  <Text style={styles.secondaryText}>{busy === `doc-${artifact.format}` ? "Opening…" : `Open ${artifact.format.toUpperCase()}`}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : !nothingRequested && tailoringDone && letterDone ? (
          <Text style={styles.warning}>The final resume file has not been generated yet.</Text>
        ) : null}

        {!nothingRequested ? (
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={onOpenTailoring}>
            <Text style={styles.secondaryText}>{documentsReady ? "Open tailored resume" : "Finish the tailored resume"}</Text>
          </Pressable>
        ) : null}
      </View>

      {wantsLetter ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Cover letter</Text>
          {!letter ? (
            <Text style={styles.warning}>Not drafted yet. Draft it from the tailored resume screen.</Text>
          ) : (
            <>
              <Text style={styles.heading}>{letter.status === "finalized" ? "Finalized" : "Still in review"}</Text>
              {letterParagraphs.map((paragraph) => (
                <Text key={paragraph.id} style={[styles.sectionText, paragraph.status === "pending" && styles.pendingText]}>
                  {paragraph.edited_text || paragraph.proposed_text}
                  {paragraph.status === "pending" ? "  (undecided)" : ""}
                </Text>
              ))}
              {letterParagraphs.length === 0 ? <Text style={styles.copy}>Every paragraph was rejected.</Text> : null}
            </>
          )}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Details Kall will fill in</Text>
        {!pack ? (
          <Text style={styles.copy}>Unable to load the profile fields for this application.</Text>
        ) : (
          <>
            {pack.job.url ? <Text style={styles.copy}>Employer form: {pack.job.url}</Text> : null}
            {alwaysFields.map((field) => (
              <View key={field.path} style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <Text style={styles.fieldValue}>{displayValue(field.value)}</Text>
              </View>
            ))}
            {optInFields.length > 0 ? (
              <>
                <Text style={styles.subheading}>Sensitive fields you have allowed</Text>
                {optInFields.map((field) => (
                  <View key={field.path} style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldValue}>{displayValue(field.value)}</Text>
                  </View>
                ))}
              </>
            ) : null}
            {pack.omitted.length > 0 ? (
              <>
                <Text style={styles.subheading}>Left blank on purpose</Text>
                {pack.omitted.map((item) => (
                  <Text key={item.path} style={styles.copy}>{item.label}: {item.reason}</Text>
                ))}
              </>
            ) : null}
            <Text style={styles.subheading}>Attestations you confirm yourself</Text>
            {attestationFields.length === 0 ? (
              <Text style={styles.copy}>No work-authorization or self-identification answers are on file, so nothing will be attested for you.</Text>
            ) : (
              attestationFields.map((field) => (
                <View key={field.path} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  <Text style={styles.fieldValue}>{displayValue(field.value)}</Text>
                </View>
              ))
            )}
            <Text style={styles.copy}>Kall never answers legal or self-identification questions silently; these values are only used after you confirm them below.</Text>
            <Pressable accessibilityRole="button" style={styles.secondary} onPress={onOpenSensitiveDetails}>
              <Text style={styles.secondaryText}>Edit sensitive details</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 20 },
  cardLabel: { color: theme.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  heading: { color: theme.text, fontSize: 18, fontWeight: "700", marginTop: 6 },
  subheading: { color: theme.textSecondary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginTop: 16, marginBottom: 4 },
  copy: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 6 },
  warning: { color: theme.warning, fontSize: 14, lineHeight: 20, marginTop: 6 },
  error: { color: theme.warning, marginBottom: 12 },
  section: { marginTop: 10 },
  sectionTitle: { color: theme.text, fontSize: 13, fontWeight: "700" },
  sectionText: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 },
  pendingText: { fontStyle: "italic" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  link: { marginTop: 8 },
  linkText: { color: theme.accent, fontWeight: "600" },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  fieldLabel: { flex: 1, color: theme.textSecondary, fontSize: 13 },
  fieldValue: { flex: 1, color: theme.text, fontSize: 13, fontWeight: "600", textAlign: "right" },
  secondary: { borderColor: theme.border, borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", marginTop: 12 },
  secondaryText: { color: theme.text, fontWeight: "600", fontSize: 13 },
});
