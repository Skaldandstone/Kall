import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ApiError } from "../api/client";
import { cacheImage, safeFileName, saveAndShare } from "../lib/files";
import {
  RESUME_TEMPLATES,
  ROLE_SECTION_PREFIX,
  createCoverLetter,
  decideChange,
  decideCoverLetterChange,
  downloadDocument,
  fetchApplication,
  fetchCoverLetter,
  fetchAtsCheck,
  fetchDocument,
  fetchDocumentPreview,
  fetchProposal,
  fetchTemplatePreview,
  finalizeCoverLetter,
  finalizeProposal,
  generateDocument,
  linkGeneratedDocuments,
  restartTailoring,
  reviewAllChanges,
  saveDocumentToProfile,
  type ApplicationRecord,
  type Artifact,
  type ArtifactFormat,
  type AtsReport,
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
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [finalPreview, setFinalPreview] = useState<string | null>(null);
  const [savedResume, setSavedResume] = useState<string | null>(null);
  const [ats, setAts] = useState<AtsReport | null>(null);
  const [showAnswered, setShowAnswered] = useState(false);
  const { width } = useWindowDimensions();

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

  // Once the text is final, show each layout as the person's own first page
  // so the choice is between real documents rather than descriptions.
  const finalizedForPreviews = proposal?.status === "finalized" && !document;
  useEffect(() => {
    if (!proposal || !finalizedForPreviews) return;
    let cancelled = false;
    const proposalId = proposal.id;
    (async () => {
      for (const template of RESUME_TEMPLATES) {
        if (cancelled) return;
        try {
          const { bytes } = await fetchTemplatePreview(proposalId, template.key);
          const uri = cacheImage(bytes, `preview-${proposalId}-${template.key}.png`);
          if (!cancelled) setPreviews((current) => ({ ...current, [template.key]: uri }));
        } catch {
          // A missing thumbnail leaves the text card; the choice still works.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [proposal, finalizedForPreviews]);

  useEffect(() => {
    if (!document) { setFinalPreview(null); setAts(null); return; }
    let cancelled = false;
    const documentId = document.document.id;
    fetchDocumentPreview(documentId)
      .then(({ bytes }) => { if (!cancelled) setFinalPreview(cacheImage(bytes, `document-${documentId}.png`)); })
      .catch(() => undefined);
    fetchAtsCheck(documentId)
      .then((report) => { if (!cancelled) setAts(report); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [document]);

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

  function reviewAll(status: "accepted" | "rejected", sectionPrefix?: string) {
    if (!proposal) return;
    void run(`all-${status}`, async () => {
      const result = await reviewAllChanges(proposal.id, status, sectionPrefix);
      setChanges((current) => current.map((item) => result.changes.find((updated) => updated.id === item.id) ?? item));
      setMessage(status === "accepted" ? `Approved ${result.reviewed} suggestion${result.reviewed === 1 ? "" : "s"}.` : `Skipped ${result.reviewed} suggestion${result.reviewed === 1 ? "" : "s"}.`);
    }, "Unable to update those suggestions.");
  }

  function restart() {
    Alert.alert(
      "Start over?",
      "Your current answers, cover letter, and generated resume for this application will be replaced with a fresh draft. Nothing you already saved to your resume library is affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Start over",
          style: "destructive",
          onPress: () => void run("restart", async () => {
            await restartTailoring(applicationId);
            setProposal(null);
            setChanges([]);
            setDrafts({});
            setDocument(null);
            setCoverLetter(null);
            setPreviews({});
            setFinalPreview(null);
            setSavedResume(null);
            setAts(null);
            setShowAnswered(false);
            await load();
            setMessage("Starting over with a fresh draft.");
          }, "Unable to start over."),
        },
      ],
    );
  }

  function saveToProfile() {
    if (!document) return;
    void run("save-profile", async () => {
      const { resume } = await saveDocumentToProfile(document.document.id);
      setSavedResume(resume.name);
      setMessage(`Saved to your resumes as ${resume.name}.`);
    }, "Unable to save this resume to your profile.");
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
  // One question at a time: every job's gaps first (the posting's asks,
  // role by role), then the opening summary, then verified achievements.
  const rank = (change: TailoringChange) => (change.section.startsWith(ROLE_SECTION_PREFIX) ? 0 : change.section === "summary" ? 1 : 2);
  const ordered = [...changes].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  const decided = ordered.filter((change) => change.status !== "pending");
  const answered = decided.length;
  const current = ordered.find((change) => change.status === "pending") ?? null;
  const currentKind = current ? (current.section.startsWith(ROLE_SECTION_PREFIX) ? "role" : current.section === "summary" ? "summary" : current.section === "experience_bullet" ? "experience_bullet" : "achievement") : null;

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
          <Pressable accessibilityRole="button" disabled={busy !== null} style={[styles.textButton, styles.restartButton]} onPress={restart}>
            <Text style={styles.textButtonText}>Not happy with this? Start over</Text>
          </Pressable>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>{finalized ? "Your answers are in" : "Step 1 of 3 · Answer what's missing"}</Text>
            <Text style={styles.body}>
              {finalized
                ? "Choose how the resume should look, then build it."
                : `${changes.length - pending} of ${changes.length} answered. Nothing is written into your resume until you approve it; dates and figures are never changed.`}
            </Text>
            {proposal.unsupported_requirements.length > 0 ? (
              <View style={styles.unsupported}>
                <Text style={styles.unsupportedTitle}>Requirements your resume does not show</Text>
                {proposal.unsupported_requirements.map((item) => <Text key={item} style={styles.unsupportedItem}>• {item}</Text>)}
              </View>
            ) : null}
          </View>

          {!finalized && current ? (
            <View style={styles.card}>
              <View style={styles.changeTop}>
                <Text style={styles.pill}>Question {answered + 1} of {changes.length}</Text>
                <Text style={styles.status}>{currentKind === "role" ? String(current.evidence[0]?.requirement ?? "Requirement") : currentKind === "summary" ? "Opening summary" : currentKind === "experience_bullet" ? "Experience wording" : "Verified achievement"}</Text>
              </View>
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round((answered / Math.max(1, changes.length)) * 100)}%` }]} /></View>
              {currentKind === "role" ? (
                <>
                  <Text style={styles.wizardContext}>{String(current.evidence[0]?.title ?? "This role")}{current.evidence[0]?.employer ? ` at ${String(current.evidence[0].employer)}` : ""}</Text>
                  <Text style={styles.reason}>{current.reason}</Text>
                  <Text style={styles.sectionLabel}>If yes, here is a bullet you could add — edit it so it is true and specific</Text>
                </>
              ) : currentKind === "summary" ? (
                <>
                  <Text style={styles.reason}>Kall can align your opening summary with this posting without adding claims.</Text>
                  {current.original_text ? (<><Text style={styles.sectionLabel}>Your current summary</Text><Text style={styles.original}>{current.original_text}</Text></>) : null}
                  <Text style={styles.sectionLabel}>Proposed summary — edit freely</Text>
                </>
              ) : currentKind === "experience_bullet" ? (
                <>
                  <Text style={styles.reason}>{current.reason}</Text>
                  {current.original_text ? (<><Text style={styles.sectionLabel}>Your current wording</Text><Text style={styles.original}>{current.original_text}</Text></>) : null}
                  <Text style={styles.sectionLabel}>Proposed wording — edit freely</Text>
                </>
              ) : (
                <>
                  <Text style={styles.reason}>{current.reason}</Text>
                  <Text style={styles.sectionLabel}>Include this achievement?</Text>
                </>
              )}
              <TextInput
                accessibilityLabel={currentKind === "role" ? "Suggested bullet" : currentKind === "summary" ? "Proposed summary" : currentKind === "experience_bullet" ? "Proposed wording" : "Achievement text"}
                multiline
                style={styles.editor}
                value={drafts[current.id] ?? ""}
                onChangeText={(value) => setDrafts((prev) => ({ ...prev, [current.id]: value }))}
                editable={busy === null}
              />
              {current.evidence.some((item) => item.text) ? (
                <Text style={styles.evidence}>Evidence: {current.evidence.map((item) => item.text).filter(Boolean).join(" · ")}</Text>
              ) : null}
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" disabled={busy !== null} style={[styles.button, busy !== null && styles.disabled]} onPress={() => decide(current, (drafts[current.id] ?? "").trim() !== current.proposed_text ? "edited" : "accepted")}>
                  {busy === `change-${current.id}` ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>{currentKind === "role" ? "Yes, add it" : currentKind === "summary" ? "Use this summary" : currentKind === "experience_bullet" ? "Use this wording" : "Keep it"}</Text>}
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy !== null} style={[styles.secondaryButton, busy !== null && styles.disabled]} onPress={() => decide(current, "rejected")}>
                  <Text style={styles.rejectText}>{currentKind === "role" ? "Not in this role" : currentKind === "summary" ? "Keep my original" : currentKind === "experience_bullet" ? "Keep my original wording" : "Leave it out"}</Text>
                </Pressable>
              </View>
              {pending > 1 ? (
                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" disabled={busy !== null} style={styles.textButton} onPress={() => reviewAll("accepted")}>
                    <Text style={styles.textButtonText}>{busy === "all-accepted" ? "Approving…" : `Approve the remaining ${pending}`}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={busy !== null} style={styles.textButton} onPress={() => reviewAll("rejected")}>
                    <Text style={styles.textButtonText}>Skip the rest</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {!finalized && answered > 0 ? (
            <View style={styles.card}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAnswered }} style={styles.changeTop} onPress={() => setShowAnswered((value) => !value)}>
                <Text style={styles.cardLabel}>Answered ({answered})</Text>
                <Text style={styles.textButtonText}>{showAnswered ? "Hide" : "Show"}</Text>
              </Pressable>
              {showAnswered ? decided.map((change) => (
                <View key={change.id} style={styles.answeredRow}>
                  <Text style={styles.answeredLabel} numberOfLines={2}>
                    {change.section.startsWith(ROLE_SECTION_PREFIX) ? `${String(change.evidence[0]?.requirement ?? "Requirement")} · ${String(change.evidence[0]?.employer ?? "")}` : change.section === "summary" ? "Opening summary" : change.section === "experience_bullet" ? "Experience wording" : "Achievement"}
                  </Text>
                  <Text style={[styles.status, change.status === "rejected" ? styles.statusRejected : styles.statusAccepted]}>{change.status === "rejected" ? "Skipped" : "Approved"}</Text>
                </View>
              )) : null}
            </View>
          ) : null}

          {finalized ? (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Approved changes</Text>
              <Text style={styles.body}>
                {changes.filter((change) => change.status !== "rejected").length} approved, {changes.filter((change) => change.status === "rejected").length} skipped. The files are built from those answers.
              </Text>
            </View>
          ) : null}

          {!finalized ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pending > 0 || busy === "finalize", busy: busy === "finalize" }}
              style={[styles.button, styles.primary, (pending > 0 || busy === "finalize") && styles.disabled]}
              disabled={pending > 0 || busy === "finalize"}
              onPress={finalize}
            >
              {busy === "finalize" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>{pending > 0 ? `${pending} question${pending === 1 ? "" : "s"} left` : "Continue to pick a look"}</Text>}
            </Pressable>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>{document ? "Step 3 of 3 · Your new resume" : "Step 2 of 3 · Pick a look"}</Text>
                {!document ? (
                  <>
                    <Text style={styles.body}>Each sample is your own resume, with the approved changes, in that layout. All are single column and ATS-readable.</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewRow}>
                      {RESUME_TEMPLATES.map((template) => {
                        const active = templateKey === template.key;
                        return (
                          <Pressable
                            key={template.key}
                            accessibilityRole="radio"
                            accessibilityLabel={`${template.label}. ${template.use}`}
                            accessibilityState={{ checked: active }}
                            style={[styles.previewCard, active && styles.previewCardActive, { width: Math.min(220, width * 0.62) }]}
                            onPress={() => setTemplateKey(template.key)}
                          >
                            {previews[template.key] ? (
                              <Image source={{ uri: previews[template.key] }} style={styles.previewImage} resizeMode="cover" accessibilityIgnoresInvertColors />
                            ) : (
                              <View style={[styles.previewImage, styles.previewPlaceholder]}><ActivityIndicator color={theme.textMuted} /></View>
                            )}
                            <Text style={[styles.templateTitle, active && styles.templateTitleActive]}>{template.label}</Text>
                            <Text style={styles.templateUse} numberOfLines={2}>{template.use}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    <Pressable accessibilityRole="button" disabled={busy === "generate"} style={[styles.button, styles.primary, busy === "generate" && styles.disabled]} onPress={generate}>
                      {busy === "generate" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>Build my resume in this look</Text>}
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.body}>
                      {RESUME_TEMPLATES.find((template) => template.key === document.document.template_key)?.label ?? label(document.document.template_key)} layout.
                      {document.coverage ? ` Covers ${document.coverage.required_percent}% of required and ${document.coverage.preferred_percent}% of preferred requirements.` : ""}
                    </Text>
                    {finalPreview ? (
                      <Image source={{ uri: finalPreview }} style={styles.finalPreview} resizeMode="contain" accessibilityLabel="First page of your new resume" accessibilityIgnoresInvertColors />
                    ) : null}
                    {ats ? (
                      <View style={styles.atsBox} accessible accessibilityLabel={`ATS check: ${ats.passed} of ${ats.total} passed`}>
                        <Text style={[styles.atsTitle, ats.passed === ats.total ? styles.statusAccepted : styles.atsWarn]}>ATS check · {ats.passed} of {ats.total} passed</Text>
                        <Text style={styles.evidence}>Run against the PDF itself: the text is extracted back out the way an applicant tracking system reads it.</Text>
                        {ats.checks.map((check) => (
                          <View key={check.key} style={styles.atsRow}>
                            <Text style={[styles.atsMark, check.passed ? styles.statusAccepted : styles.atsWarn]}>{check.passed ? "✓" : "!"}</Text>
                            <View style={styles.atsCopy}>
                              <Text style={styles.atsLabel}>{check.label}</Text>
                              {!check.passed ? <Text style={styles.atsDetail}>{check.detail}</Text> : null}
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.actions}>
                      {document.artifacts.filter((artifact) => artifact.format !== "txt").map((artifact) => (
                        <Pressable
                          key={artifact.format}
                          accessibilityRole="button"
                          accessibilityHint="Downloads the file and opens the share sheet to save or send it"
                          disabled={busy === `download-${artifact.format}`}
                          style={[styles.secondaryButton, busy === `download-${artifact.format}` && styles.disabled]}
                          onPress={() => share(artifact)}
                        >
                          {busy === `download-${artifact.format}` ? <ActivityIndicator color={theme.text} /> : <Text style={styles.secondaryButtonText}>Export {artifact.format === "docx" ? "Word" : artifact.format.toUpperCase()}</Text>}
                        </Pressable>
                      ))}
                      <Pressable accessibilityRole="button" disabled={busy === "save-profile" || savedResume !== null} style={[styles.button, (busy === "save-profile" || savedResume !== null) && styles.disabled]} onPress={saveToProfile}>
                        {busy === "save-profile" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>{savedResume ? "Saved to my resumes" : "Save to my resumes"}</Text>}
                      </Pressable>
                    </View>
                    <Pressable accessibilityRole="button" style={styles.textButton} onPress={() => { setDocument(null); setSavedResume(null); }}>
                      <Text style={styles.textButtonText}>Try a different look</Text>
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
  restartButton: { alignSelf: "flex-end", marginTop: 0, marginBottom: 4 },
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
  suggestion: { marginTop: 4 },
  suggestionDivider: { borderTopColor: theme.border, borderTopWidth: 1, marginTop: 14, paddingTop: 12 },
  previewRow: { gap: 12, paddingVertical: 12 },
  previewCard: { borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 10, backgroundColor: theme.background },
  previewCardActive: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  previewImage: { width: "100%", aspectRatio: 0.773, borderRadius: 6, backgroundColor: "#FFFFFF", marginBottom: 8 },
  previewPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceRaised },
  finalPreview: { width: "100%", aspectRatio: 0.773, borderRadius: 8, backgroundColor: "#FFFFFF", marginTop: 12, borderColor: theme.border, borderWidth: 1 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: theme.border, marginTop: 10, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: theme.accent },
  wizardContext: { color: theme.textSecondary, fontSize: 13, fontWeight: "600", marginTop: 12 },
  answeredRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 8, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
  answeredLabel: { flex: 1, color: theme.textSecondary, fontSize: 13 },
  atsBox: { marginTop: 14, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceRaised },
  atsTitle: { fontSize: 15, fontWeight: "800" },
  atsWarn: { color: theme.warning },
  atsRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  atsMark: { width: 16, fontWeight: "800", fontSize: 14 },
  atsCopy: { flex: 1 },
  atsLabel: { color: theme.text, fontSize: 13 },
  atsDetail: { color: theme.textMuted, fontSize: 12, marginTop: 2 },
});
