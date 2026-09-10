import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ApiError } from "../api/client";
import { safeFileName, saveAndShare } from "../lib/files";
import {
  RESUME_TEMPLATES,
  createCoverLetter,
  decideChange,
  decideCoverLetterChange,
  downloadDocument,
  fetchApplication,
  fetchCoverLetter,
  fetchDocument,
  fetchProposal,
  finalizeCoverLetter,
  finalizeProposal,
  generateDocument,
  linkGeneratedDocuments,
  type ApplicationRecord,
  type Artifact,
  type ArtifactFormat,
  type CoverLetterChange,
  type CoverLetterProposal,
  type DocumentDetail,
  type TailoringChange,
  type TailoringProposal,
} from "../api/tailoring";
import { theme } from "../theme";
import type { ApplicationsStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<ApplicationsStackParamList, "Tailoring">;

const UTI_BY_FORMAT: Record<ArtifactFormat, string> = {
  pdf: "com.adobe.pdf",
  docx: "org.openxmlformats.wordprocessingml.document",
  txt: "public.plain-text",
};

const COVER_LETTER_OPTIONS = {
  emphasis: ["balanced", "executive", "technical"],
  tone: ["formal", "conversational"],
  length: ["standard", "concise"],
} as const;

function label(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function TailoringScreen({ route }: Props) {
  const { applicationId, company, role } = route.params;
  const [application, setApplication] = useState<ApplicationRecord | null>(null);
  const [proposal, setProposal] = useState<TailoringProposal | null>(null);
  const [changes, setChanges] = useState<TailoringChange[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [templateKey, setTemplateKey] = useState<string>("standard");
  const [coverLetter, setCoverLetter] = useState<{ proposal: CoverLetterProposal; changes: CoverLetterChange[] } | null>(null);
  const [letterOptions, setLetterOptions] = useState({ emphasis: "balanced", tone: "formal", length: "standard" });
  const [companyNotes, setCompanyNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const record = await fetchApplication(applicationId);
      setApplication(record);
      const proposalId = record.prepared_payload.tailoring_proposal_id;
      if (proposalId) {
        const detail = await fetchProposal(proposalId);
        setProposal(detail.proposal);
        setChanges(detail.changes);
        setDrafts(Object.fromEntries(detail.changes.map((change) => [change.id, change.edited_text || change.proposed_text])));
      }
      const documentId = record.prepared_payload.generated_document_id;
      if (documentId) setDocument(await fetchDocument(documentId));
      const letterId = record.prepared_payload.cover_letter_proposal_id;
      if (letterId) setCoverLetter(await fetchCoverLetter(letterId));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to load the tailored resume.");
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

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

  function decide(change: TailoringChange, status: "accepted" | "edited" | "rejected") {
    const edited = status === "edited" ? drafts[change.id]?.trim() : undefined;
    if (status === "edited" && !edited) {
      setMessage("Write the edited text before saving it.");
      return;
    }
    void run(`change-${change.id}`, async () => {
      const updated = await decideChange(change.id, status, edited);
      setChanges((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    }, "Unable to save that decision.");
  }

  function finalize() {
    if (!proposal) return;
    void run("finalize", async () => {
      setProposal(await finalizeProposal(proposal.id));
      setMessage("Resume changes finalized. Choose a layout to generate the files.");
    }, "Unable to finalize the proposal.");
  }

  function generate() {
    if (!proposal) return;
    void run("generate", async () => {
      const generated = await generateDocument(proposal.id, templateKey);
      const detail = await fetchDocument(generated.id);
      setDocument(detail);
      await linkGeneratedDocuments(applicationId, { generated_document_id: generated.id });
      setMessage("Resume files are ready.");
    }, "Unable to generate the resume files.");
  }

  function share(artifact: Artifact) {
    if (!document) return;
    void run(`download-${artifact.format}`, async () => {
      const { bytes, mimeType } = await downloadDocument(document.document.id, artifact.format);
      await saveAndShare(bytes, `kall-resume-${safeFileName(company)}.${artifact.format}`, artifact.mime_type || mimeType, UTI_BY_FORMAT[artifact.format]);
    }, "Unable to save that file.");
  }

  function draftLetter() {
    if (!proposal) return;
    void run("letter", async () => {
      const created = await createCoverLetter(proposal.id, { ...letterOptions, company_interest_notes: companyNotes.trim() || null });
      setCoverLetter(await fetchCoverLetter(created.id));
      await linkGeneratedDocuments(applicationId, { cover_letter_proposal_id: created.id });
      setMessage("Cover letter draft is ready for review.");
    }, "Unable to draft the cover letter.");
  }

  function decideParagraph(change: CoverLetterChange, decision: "accepted" | "rejected") {
    void run(`letter-${change.id}`, async () => {
      const updated = await decideCoverLetterChange(change.id, decision);
      setCoverLetter((current) => current && { ...current, changes: current.changes.map((item) => (item.id === updated.id ? updated : item)) });
    }, "Unable to save that decision.");
  }

  function finalizeLetter() {
    if (!coverLetter) return;
    void run("finalize-letter", async () => {
      const finalized = await finalizeCoverLetter(coverLetter.proposal.id);
      setCoverLetter((current) => current && { ...current, proposal: finalized });
      setMessage("Cover letter finalized.");
    }, "Unable to finalize the cover letter.");
  }

  function shareLetterText() {
    if (!coverLetter) return;
    const text = coverLetter.changes
      .filter((change) => change.status !== "rejected")
      .sort((a, b) => a.position - b.position)
      .map((change) => change.edited_text || change.proposed_text)
      .join("\n\n");
    void Share.share({ title: `Cover letter - ${company}`, message: text }).catch(() => undefined);
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={theme.text} accessibilityLabel="Loading tailored resume" />
      </View>
    );
  }

  const pending = changes.filter((change) => change.status === "pending").length;
  const finalized = proposal?.status === "finalized";
  const letterPending = coverLetter?.changes.filter((change) => change.status === "pending").length ?? 0;
  const letterFinalized = coverLetter?.proposal.status === "finalized";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <Text style={styles.eyebrow}>{company}</Text>
      <Text style={styles.title}>{role}</Text>

      {message ? <Text accessibilityLiveRegion="polite" style={message.startsWith("Unable") || message.includes("before") ? styles.error : styles.message}>{message}</Text> : null}

      {!proposal ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>No tailored resume yet</Text>
          <Text style={styles.body}>
            {application?.base_resume_id
              ? "Resume tailoring was switched off when this application was prepared."
              : "No resume was attached when this application was prepared, so there is nothing to tailor."}
            {" "}Prepare the role again from the job with a resume selected and tailoring on.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Proposed changes</Text>
            <Text style={styles.body}>
              {finalized
                ? "Every change has been reviewed and the resume text is final."
                : `${changes.length - pending} of ${changes.length} reviewed. Kall only proposes wording it can back with evidence from your resume; dates and figures are never changed.`}
            </Text>
            {proposal.unsupported_requirements.length > 0 ? (
              <View style={styles.unsupported}>
                <Text style={styles.unsupportedTitle}>Requirements your resume does not show</Text>
                {proposal.unsupported_requirements.map((item) => <Text key={item} style={styles.unsupportedItem}>• {item}</Text>)}
              </View>
            ) : null}
          </View>

          {changes.map((change) => {
            const working = busy === `change-${change.id}`;
            return (
              <View key={change.id} style={styles.card}>
                <View style={styles.changeTop}>
                  <Text style={styles.pill}>{label(change.section)}</Text>
                  <Text style={[styles.status, change.status === "rejected" && styles.statusRejected, (change.status === "accepted" || change.status === "edited") && styles.statusAccepted]}>{label(change.status)}</Text>
                </View>
                <Text style={styles.reason}>{change.reason}</Text>
                <Text style={styles.sectionLabel}>Original</Text>
                <Text style={styles.original}>{change.original_text}</Text>
                <Text style={styles.sectionLabel}>Proposed</Text>
                {finalized || change.status === "rejected" ? (
                  <Text style={styles.proposed}>{change.edited_text || change.proposed_text}</Text>
                ) : (
                  <TextInput
                    accessibilityLabel={`Proposed text for ${label(change.section)}`}
                    multiline
                    style={styles.editor}
                    value={drafts[change.id] ?? ""}
                    onChangeText={(value) => setDrafts((current) => ({ ...current, [change.id]: value }))}
                    editable={!working}
                  />
                )}
                {change.evidence.length > 0 ? (
                  <Text style={styles.evidence}>Evidence: {change.evidence.map((item) => item.text).join(" · ")}</Text>
                ) : null}
                {!finalized ? (
                  <View style={styles.actions}>
                    <Pressable accessibilityRole="button" disabled={working} style={[styles.button, working && styles.disabled]} onPress={() => decide(change, "accepted")}>
                      {working ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>Accept</Text>}
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={working} style={[styles.secondaryButton, working && styles.disabled]} onPress={() => decide(change, "edited")}>
                      <Text style={styles.secondaryButtonText}>Save edit</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={working} style={[styles.secondaryButton, working && styles.disabled]} onPress={() => decide(change, "rejected")}>
                      <Text style={styles.rejectText}>Reject</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}

          {!finalized ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pending > 0 || busy === "finalize", busy: busy === "finalize" }}
              style={[styles.button, styles.primary, (pending > 0 || busy === "finalize") && styles.disabled]}
              disabled={pending > 0 || busy === "finalize"}
              onPress={finalize}
            >
              {busy === "finalize" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>{pending > 0 ? `Review ${pending} more to finalize` : "Finalize resume changes"}</Text>}
            </Pressable>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Resume files</Text>
                {!document ? (
                  <>
                    <Text style={styles.body}>Choose an ATS-readable layout. Single column, standard headings, selectable text.</Text>
                    <View style={styles.templates}>
                      {RESUME_TEMPLATES.map((template) => (
                        <Pressable
                          key={template.key}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: templateKey === template.key }}
                          style={[styles.template, templateKey === template.key && styles.templateActive]}
                          onPress={() => setTemplateKey(template.key)}
                        >
                          <Text style={[styles.templateTitle, templateKey === template.key && styles.templateTitleActive]}>{template.label}</Text>
                          <Text style={styles.templateUse}>{template.use}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Pressable accessibilityRole="button" disabled={busy === "generate"} style={[styles.button, styles.primary, busy === "generate" && styles.disabled]} onPress={generate}>
                      {busy === "generate" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>Generate files</Text>}
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.body}>
                      {RESUME_TEMPLATES.find((template) => template.key === document.document.template_key)?.label ?? label(document.document.template_key)} layout.
                      {document.coverage ? ` Covers ${document.coverage.required_percent}% of required and ${document.coverage.preferred_percent}% of preferred requirements.` : ""}
                    </Text>
                    <View style={styles.actions}>
                      {document.artifacts.map((artifact) => (
                        <Pressable
                          key={artifact.format}
                          accessibilityRole="button"
                          accessibilityHint="Downloads the file and opens the share sheet to save or send it"
                          disabled={busy === `download-${artifact.format}`}
                          style={[styles.secondaryButton, busy === `download-${artifact.format}` && styles.disabled]}
                          onPress={() => share(artifact)}
                        >
                          {busy === `download-${artifact.format}` ? <ActivityIndicator color={theme.text} /> : <Text style={styles.secondaryButtonText}>Save {artifact.format.toUpperCase()}</Text>}
                        </Pressable>
                      ))}
                    </View>
                    <Pressable accessibilityRole="button" style={styles.textButton} onPress={() => setDocument(null)}>
                      <Text style={styles.textButtonText}>Generate with a different layout</Text>
                    </Pressable>
                  </>
                )}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardLabel}>Cover letter</Text>
                {!coverLetter ? (
                  <>
                    <Text style={styles.body}>Drafted from the finalized resume and this posting. Every paragraph needs your review.</Text>
                    {(Object.keys(COVER_LETTER_OPTIONS) as Array<keyof typeof COVER_LETTER_OPTIONS>).map((option) => (
                      <View key={option} style={styles.optionRow}>
                        <Text style={styles.sectionLabel}>{label(option)}</Text>
                        <View style={styles.chips}>
                          {COVER_LETTER_OPTIONS[option].map((value) => (
                            <Pressable
                              key={value}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: letterOptions[option] === value }}
                              style={[styles.chip, letterOptions[option] === value && styles.chipActive]}
                              onPress={() => setLetterOptions((current) => ({ ...current, [option]: value }))}
                            >
                              <Text style={[styles.chipText, letterOptions[option] === value && styles.chipTextActive]}>{label(value)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ))}
                    <Text style={styles.sectionLabel}>Why this company (optional)</Text>
                    <TextInput
                      accessibilityLabel="Why this company"
                      multiline
                      style={styles.editor}
                      value={companyNotes}
                      onChangeText={setCompanyNotes}
                      placeholder="Something specific that drew you to them"
                      placeholderTextColor={theme.textMuted}
                    />
                    <Pressable accessibilityRole="button" disabled={busy === "letter"} style={[styles.button, styles.primary, busy === "letter" && styles.disabled]} onPress={draftLetter}>
                      {busy === "letter" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>Draft cover letter</Text>}
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.body}>
                      {letterFinalized ? "Finalized. Share the text to paste it into the employer's form." : `${coverLetter.changes.length - letterPending} of ${coverLetter.changes.length} paragraphs reviewed.`}
                    </Text>
                    {coverLetter.changes.map((change) => {
                      const working = busy === `letter-${change.id}`;
                      return (
                        <View key={change.id} style={styles.paragraph}>
                          <View style={styles.changeTop}>
                            <Text style={styles.pill}>Paragraph {change.position + 1}</Text>
                            <Text style={[styles.status, change.status === "rejected" && styles.statusRejected, change.status === "accepted" && styles.statusAccepted]}>{label(change.status)}</Text>
                          </View>
                          <Text style={[styles.proposed, change.status === "rejected" && styles.struck]}>{change.edited_text || change.proposed_text}</Text>
                          {!letterFinalized ? (
                            <View style={styles.actions}>
                              <Pressable accessibilityRole="button" disabled={working} style={[styles.button, working && styles.disabled]} onPress={() => decideParagraph(change, "accepted")}>
                                {working ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>Keep</Text>}
                              </Pressable>
                              <Pressable accessibilityRole="button" disabled={working} style={[styles.secondaryButton, working && styles.disabled]} onPress={() => decideParagraph(change, "rejected")}>
                                <Text style={styles.rejectText}>Drop</Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                    {!letterFinalized ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={letterPending > 0 || busy === "finalize-letter"}
                        style={[styles.button, styles.primary, (letterPending > 0 || busy === "finalize-letter") && styles.disabled]}
                        onPress={finalizeLetter}
                      >
                        {busy === "finalize-letter" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>{letterPending > 0 ? `Review ${letterPending} more to finalize` : "Finalize cover letter"}</Text>}
                      </Pressable>
                    ) : (
                      <Pressable accessibilityRole="button" style={[styles.button, styles.primary]} onPress={shareLetterText}>
                        <Text style={styles.buttonText}>Share cover letter text</Text>
                      </Pressable>
                    )}
                  </>
                )}
              </View>
            </>
          )}
        </>
      )}
      <Text style={styles.footer}>Kall never submits anything. Files stay private to your account until you send them.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingTop: 24, paddingBottom: 48 },
  eyebrow: { color: theme.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  title: { color: theme.text, fontSize: 24, fontWeight: "700", marginTop: 4, marginBottom: 18 },
  message: { color: theme.success, marginBottom: 14, lineHeight: 20 },
  error: { color: theme.danger, marginBottom: 14, lineHeight: 20 },
  card: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 14 },
  cardLabel: { color: theme.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 8 },
  body: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  unsupported: { marginTop: 12, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 12 },
  unsupportedTitle: { color: theme.text, fontWeight: "700", marginBottom: 4 },
  unsupportedItem: { color: theme.warning, lineHeight: 20 },
  changeTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  pill: { color: theme.accent, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  status: { color: theme.textMuted, fontSize: 12, fontWeight: "700" },
  statusAccepted: { color: theme.success },
  statusRejected: { color: theme.danger },
  reason: { color: theme.text, fontSize: 16, fontWeight: "700", marginTop: 8 },
  sectionLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: "700", marginTop: 12, marginBottom: 4 },
  original: { color: theme.textMuted, fontSize: 14, lineHeight: 20 },
  proposed: { color: theme.text, fontSize: 15, lineHeight: 22 },
  struck: { textDecorationLine: "line-through", color: theme.textMuted },
  editor: { minHeight: 96, color: theme.text, backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderWidth: 1, borderRadius: 9, padding: 12, textAlignVertical: "top", fontSize: 15, lineHeight: 22 },
  evidence: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  button: { minHeight: 46, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent, borderRadius: 10, paddingHorizontal: 16 },
  primary: { marginBottom: 14 },
  buttonText: { color: theme.accentInk, fontWeight: "700", fontSize: 14 },
  secondaryButton: { minHeight: 46, alignItems: "center", justifyContent: "center", borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14 },
  secondaryButtonText: { color: theme.text, fontWeight: "700", fontSize: 14 },
  rejectText: { color: theme.danger, fontWeight: "700", fontSize: 14 },
  textButton: { minHeight: 44, justifyContent: "center", marginTop: 6 },
  textButtonText: { color: theme.accent, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  templates: { gap: 8, marginTop: 12, marginBottom: 14 },
  template: { borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 12, backgroundColor: theme.background },
  templateActive: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  templateTitle: { color: theme.text, fontWeight: "700" },
  templateTitleActive: { color: theme.accentHover },
  templateUse: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  optionRow: { marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, justifyContent: "center", borderColor: theme.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 13 },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: theme.accentInk },
  paragraph: { borderTopColor: theme.border, borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  footer: { color: theme.textMuted, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 8 },
});
