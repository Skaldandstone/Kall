import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import {
  createCareerProfile,
  fetchCareerProfiles,
  fetchResumeStudio,
  saveCareerProfile,
  suggestCareerStrategy,
  type CareerProfile,
  type Resume,
} from "../api/workspace";
import { theme } from "../theme";

const csv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const text = (items: string[]) => items.join(", ");
const numberOrNull = (value: string) => {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
};

type Draft = {
  name: string;
  target_titles: string;
  industries: string;
  include_keywords: string;
  work_types: string;
  countries: string;
  states_regions: string;
  minimum_base: string;
  target_base: string;
  default_resume_id: number | null;
  is_active: boolean;
};

const blank: Draft = {
  name: "", target_titles: "", industries: "", include_keywords: "",
  work_types: "remote", countries: "United States", states_regions: "",
  minimum_base: "", target_base: "", default_resume_id: null, is_active: true,
};

const QUESTIONS = [
  { module: "Direction", key: "name", title: "What should we call this career direction?", help: "Use a short label you will recognize, such as Quality Leadership or Product Design.", placeholder: "Quality leadership" },
  { module: "Direction", key: "target_titles", title: "Which roles should Kall look for?", help: "Add close title variants that accurately reflect your experience. Separate them with commas.", placeholder: "QA Director, Head of Quality" },
  { module: "Direction", key: "industries", title: "Which industries fit this direction?", help: "Choose fields where you want to work. You can leave this open if the role matters more than the industry.", placeholder: "SaaS, games, financial services" },
  { module: "Evidence", key: "include_keywords", title: "What strengths should a matching role need?", help: "List skills and specialties your resume can support. Kall will use these as matching evidence, not invent them.", placeholder: "Quality strategy, test automation, team leadership" },
  { module: "Work fit", key: "work_types", title: "How do you want to work?", help: "Use remote, hybrid, onsite, or a combination separated by commas.", placeholder: "remote, hybrid" },
  { module: "Work fit", key: "location", title: "Where are you willing to work?", help: "A country and state or region is enough. Leave uncertain details open instead of guessing." },
  { module: "Compensation", key: "compensation", title: "What base salary range should Kall use?", help: "Enter your own annual minimum and target. Resume suggestions are only starting points for your review." },
] as const;

function profileDraft(profile: CareerProfile): Draft {
  return {
    name: profile.name,
    target_titles: text(profile.target_titles),
    industries: text(profile.industries),
    include_keywords: text(profile.include_keywords),
    work_types: text(profile.work_types),
    countries: text(profile.countries),
    states_regions: text(profile.states_regions),
    minimum_base: profile.minimum_base?.toString() || "",
    target_base: profile.target_base?.toString() || "",
    default_resume_id: profile.default_resume_id || null,
    is_active: profile.is_active,
  };
}

export default function CareerProfilesScreen() {
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [editing, setEditing] = useState<CareerProfile | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [step, setStep] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [profileData, resumeData] = await Promise.all([fetchCareerProfiles(), fetchResumeStudio()]);
      setProfiles(profileData.profiles);
      setResumes(resumeData.resumes);
      setMessage("");
    } catch {
      setMessage("Unable to load your career profile workspace.");
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function begin(profile?: CareerProfile) {
    setEditing(profile || null);
    setDraft(profile ? profileDraft(profile) : { ...blank });
    setStep(0);
    setMessage(profile ? "Review each answer. Kall keeps anything unfinished visible." : "Start with a resume for suggestions, or answer one question at a time.");
  }

  async function suggestFromResume(resume: Resume) {
    setSuggesting(true);
    setMessage("Reading your resume and preparing suggestions for review.");
    try {
      const { suggestion } = await suggestCareerStrategy(resume.id);
      setDraft((current) => ({
        ...current,
        name: suggestion?.profile_name || current.name,
        target_titles: suggestion?.target_titles?.join(", ") || current.target_titles,
        industries: suggestion?.industries?.join(", ") || current.industries,
        include_keywords: suggestion?.keywords?.join(", ") || current.include_keywords,
        work_types: suggestion?.work_types?.join(", ") || current.work_types,
        minimum_base: suggestion?.suggested_salary_min?.toString() || current.minimum_base,
        target_base: suggestion?.suggested_salary_max?.toString() || current.target_base,
        default_resume_id: resume.id,
      }));
      setMessage(suggestion ? "Suggestions are ready. Confirm or change every answer before saving." : "That resume did not provide enough detail, so the questions remain open.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Kall could not prepare suggestions from that resume.");
    } finally {
      setSuggesting(false);
    }
  }

  const unknowns = useMemo(() => [
    !draft.name.trim() && "career direction name",
    !csv(draft.target_titles).length && "target roles",
    !csv(draft.industries).length && "industries",
    !csv(draft.include_keywords).length && "evidence-backed strengths",
    !csv(draft.work_types).length && "work arrangement",
    !csv(draft.countries).length && !csv(draft.states_regions).length && "location",
    !draft.target_base.trim() && "target compensation",
  ].filter(Boolean) as string[], [draft]);

  async function save() {
    if (!draft.name.trim() || !csv(draft.target_titles).length) {
      setStep(!draft.name.trim() ? 0 : 1);
      setMessage("A profile needs a name and at least one target role.");
      return;
    }
    const body = {
      name: draft.name.trim(), target_titles: csv(draft.target_titles), industries: csv(draft.industries),
      include_keywords: csv(draft.include_keywords), countries: csv(draft.countries),
      states_regions: csv(draft.states_regions), work_types: csv(draft.work_types),
      minimum_base: numberOrNull(draft.minimum_base), target_base: numberOrNull(draft.target_base),
      default_resume_id: draft.default_resume_id,
      ...(editing ? { is_active: draft.is_active } : {}),
    };
    setSaving(true);
    setMessage("Saving only the answers shown in your review.");
    try {
      if (editing) await saveCareerProfile(editing.id, body);
      else await createCareerProfile(body);
      await load();
      setStep(null);
      setEditing(null);
      setDraft({ ...blank });
      setMessage("Career profile saved.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to save this career profile.");
    } finally {
      setSaving(false);
    }
  }

  function leaveOpen() {
    if (!question || step == null) return;
    if (question.key === "location") {
      setDraft({ ...draft, countries: "", states_regions: "" });
    } else if (question.key === "compensation") {
      setDraft({ ...draft, minimum_base: "", target_base: "" });
    } else {
      setDraft({ ...draft, [question.key]: "" });
    }
    setStep(step + 1);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: theme.background }} color={theme.text} />;
  const atReview = step === QUESTIONS.length;
  const question = step != null && !atReview ? QUESTIONS[step] : null;
  const answered = QUESTIONS.length - unknowns.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <Text style={styles.title}>Career profiles</Text>
      <Text style={styles.subtitle}>Tell Kall what a good next role looks like. Kall will guide the questions, use only facts you confirm, and show what still needs an answer.</Text>
      {step == null ? <>
        <View style={styles.guideCard}>
          <Text style={styles.eyebrow}>GUIDED PROFILE</Text>
          <Text style={styles.guideTitle}>Build a direction with Kall</Text>
          <Text style={styles.cardBody}>Seven short questions cover direction, evidence, work fit, and compensation. A resume can provide suggestions for you to review.</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => begin()}><Text style={styles.buttonText}>Start guided profile</Text></Pressable>
        </View>
        {profiles.map((profile) => <Pressable accessibilityRole="button" accessibilityHint="Opens the guided profile editor" key={profile.id} style={styles.card} onPress={() => begin(profile)}>
          <View style={styles.cardTop}><Text style={styles.cardTitle}>{profile.name}</Text><Text style={styles.score}>{profile.completeness.score}%</Text></View>
          <Text style={styles.cardBody}>{profile.target_titles.join(" · ") || "Target roles still needed"}</Text>
          <Text style={styles.meta}>{profile.match_count} matches{profile.best_match_score != null ? ` · best ${profile.best_match_score}%` : ""}</Text>
        </Pressable>)}
      </> : <View style={styles.guide}>
        <View style={styles.progressRow}>
          <View><Text style={styles.eyebrow}>{atReview ? "FINAL REVIEW" : question?.module.toUpperCase()}</Text><Text style={styles.progressText}>{atReview ? `${answered} answered · ${unknowns.length} still open` : `Question ${step + 1} of ${QUESTIONS.length}`}</Text></View>
          <Pressable accessibilityRole="button" style={styles.closeButton} onPress={() => setStep(null)}><Text style={styles.closeButtonText}>Close</Text></Pressable>
        </View>
        {step === 0 && resumes.length ? <View style={styles.resumeBox}>
          <Text style={styles.sectionTitle}>Start with a resume</Text><Text style={styles.cardBody}>Kall can suggest answers. Nothing is saved until your final review.</Text>
          {resumes.map((resume) => <Pressable accessibilityRole="button" key={resume.id} disabled={suggesting} style={styles.resumeChoice} onPress={() => void suggestFromResume(resume)}><Text style={styles.resumeChoiceText}>{draft.default_resume_id === resume.id ? "✓ " : ""}Use {resume.name}</Text></Pressable>)}
        </View> : null}
        {question ? <View style={styles.question}>
          <Text style={styles.questionTitle}>{question.title}</Text><Text style={styles.questionHelp}>{question.help}</Text>
          {question.key === "location" ? <>
            <Text style={styles.label}>Countries</Text><TextInput accessibilityLabel="Countries" style={styles.input} value={draft.countries} onChangeText={(countries) => setDraft({ ...draft, countries })} placeholder="United States" placeholderTextColor={theme.textMuted} />
            <Text style={styles.label}>States or regions</Text><TextInput accessibilityLabel="States or regions" style={styles.input} value={draft.states_regions} onChangeText={(states_regions) => setDraft({ ...draft, states_regions })} placeholder="Washington, Oregon" placeholderTextColor={theme.textMuted} />
          </> : question.key === "compensation" ? <>
            <Text style={styles.label}>Minimum annual base</Text><TextInput accessibilityLabel="Minimum annual base" keyboardType="number-pad" style={styles.input} value={draft.minimum_base} onChangeText={(minimum_base) => setDraft({ ...draft, minimum_base })} placeholder="120000" placeholderTextColor={theme.textMuted} />
            <Text style={styles.label}>Target annual base</Text><TextInput accessibilityLabel="Target annual base" keyboardType="number-pad" style={styles.input} value={draft.target_base} onChangeText={(target_base) => setDraft({ ...draft, target_base })} placeholder="150000" placeholderTextColor={theme.textMuted} />
          </> : <TextInput accessibilityLabel={question.title} autoFocus style={styles.input} value={draft[question.key]} onChangeText={(value) => setDraft({ ...draft, [question.key]: value })} placeholder={question.placeholder} placeholderTextColor={theme.textMuted} />}
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => setStep(step + 1)}><Text style={styles.buttonText}>Keep this answer</Text></Pressable>
          <Pressable accessibilityRole="button" style={styles.textButton} onPress={leaveOpen}><Text style={styles.textButtonText}>Leave open for now</Text></Pressable>
        </View> : null}
        {atReview ? <View style={styles.review}>
          <Text style={styles.questionTitle}>Review your direction</Text>
          {[
            ["Direction", draft.name], ["Target roles", draft.target_titles], ["Industries", draft.industries], ["Strengths", draft.include_keywords], ["Work arrangement", draft.work_types],
            ["Location", [draft.countries, draft.states_regions].filter(Boolean).join(", ")],
            ["Base salary", draft.minimum_base || draft.target_base ? `${draft.minimum_base || "not set"} to ${draft.target_base || "not set"}` : ""],
          ].map(([label, value], index) => <Pressable accessibilityRole="button" key={label} style={styles.reviewRow} onPress={() => setStep(Math.min(index, QUESTIONS.length - 1))}>
            <Text style={styles.reviewLabel}>{label}</Text><Text style={value ? styles.reviewValue : styles.openValue}>{value || "Still needs your input"}</Text>
          </Pressable>)}
          {editing ? <View style={styles.switchRow}><View style={{ flex: 1 }}><Text style={styles.switchTitle}>Active search profile</Text><Text style={styles.switchDetail}>Include this direction in search and matching.</Text></View><Switch value={draft.is_active} onValueChange={(is_active) => setDraft({ ...draft, is_active })} trackColor={{ false: theme.border, true: theme.accent }} /></View> : null}
          <Pressable accessibilityRole="button" style={[styles.button, saving && styles.disabled]} disabled={saving} onPress={() => void save()}>{saving ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>{editing ? "Save confirmed answers" : "Create this profile"}</Text>}</Pressable>
        </View> : null}
        {step > 0 ? <Pressable accessibilityRole="button" style={styles.backButton} onPress={() => setStep(step - 1)}><Text style={styles.backButtonText}>Back</Text></Pressable> : null}
      </View>}
      {message ? <Text accessibilityLiveRegion="polite" style={message.includes("saved") || message.includes("ready") ? styles.success : styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background }, content: { padding: 20, paddingBottom: 50 },
  title: { color: theme.text, fontSize: 24, fontWeight: "700" }, subtitle: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 5, marginBottom: 18 },
  eyebrow: { color: theme.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  guideCard: { backgroundColor: theme.surface, borderColor: theme.accent, borderWidth: 1, borderRadius: 14, padding: 18, marginBottom: 16 },
  guideTitle: { color: theme.text, fontSize: 19, fontWeight: "700", marginTop: 5 }, guide: { gap: 14 },
  progressRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, progressText: { color: theme.textSecondary, marginTop: 4 },
  closeButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }, closeButtonText: { color: theme.textSecondary, fontWeight: "700" },
  resumeBox: { borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 14 }, sectionTitle: { color: theme.text, fontSize: 15, fontWeight: "700" },
  resumeChoice: { minHeight: 44, justifyContent: "center", borderTopColor: theme.border, borderTopWidth: 1, marginTop: 10, paddingTop: 10 }, resumeChoiceText: { color: theme.text, fontWeight: "600" },
  question: { backgroundColor: theme.surface, borderRadius: 14, borderColor: theme.border, borderWidth: 1, padding: 18 },
  questionTitle: { color: theme.text, fontSize: 20, fontWeight: "700" }, questionHelp: { color: theme.textSecondary, lineHeight: 20, marginTop: 8, marginBottom: 14 },
  label: { color: theme.textSecondary, fontSize: 13, fontWeight: "600", marginTop: 8 },
  input: { minHeight: 50, color: theme.text, backgroundColor: theme.background, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, marginTop: 7, marginBottom: 8 },
  button: { minHeight: 50, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent, borderRadius: 10, marginTop: 14 }, buttonText: { color: theme.accentInk, fontWeight: "700" },
  textButton: { minHeight: 44, alignItems: "center", justifyContent: "center" }, textButtonText: { color: theme.textSecondary, fontWeight: "600" },
  backButton: { minHeight: 44, alignItems: "flex-start", justifyContent: "center" }, backButtonText: { color: theme.text, fontWeight: "700" },
  review: { backgroundColor: theme.surface, borderRadius: 14, borderColor: theme.border, borderWidth: 1, padding: 18 },
  reviewRow: { borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: 12 }, reviewLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: "700" },
  reviewValue: { color: theme.text, marginTop: 4, lineHeight: 19 }, openValue: { color: theme.accent, marginTop: 4, fontWeight: "600" },
  card: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 10 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, cardTitle: { flex: 1, color: theme.text, fontSize: 16, fontWeight: "700" },
  score: { color: theme.accent, fontWeight: "700" }, cardBody: { color: theme.textSecondary, lineHeight: 19, marginTop: 6 }, meta: { color: theme.textMuted, fontSize: 12, marginTop: 8 },
  switchRow: { minHeight: 64, flexDirection: "row", alignItems: "center", marginTop: 12 }, switchTitle: { color: theme.text, fontWeight: "700" }, switchDetail: { color: theme.textSecondary, fontSize: 12, marginTop: 3 },
  disabled: { opacity: 0.55 }, success: { color: theme.success, marginTop: 14 }, message: { color: theme.textSecondary, marginTop: 14, lineHeight: 19 },
});
