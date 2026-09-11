import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import { ApiError } from "../api/client";
import {
  createCareerProfile,
  fetchCareerProfiles,
  fetchFunctionalAreas,
  fetchRelatedTitles,
  fetchResumeStudio,
  markOnboardingComplete,
  saveCareerProfile,
  suggestCareerStrategy,
  uploadResume,
  type CareerProfile,
  type CareerProfileInput,
  type FunctionalArea,
  type Resume,
} from "../api/workspace";
import { countryNames, regionsForCountries } from "../lib/locationData";
import { theme } from "../theme";
import { resumeMimeType } from "./ResumesScreen";

const MAX_RESUME_BYTES = 15 * 1024 * 1024;

const numberOrNull = (value: string) => {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
};

type PayBasis = "salary" | "hourly";

type Draft = {
  name: string;
  target_titles: string[];
  industries: string[];
  functional_areas: string[];
  include_keywords: string[];
  exclude_keywords: string[];
  work_types: string[];
  employment_types: string[];
  countries: string[];
  states_regions: string[];
  cities: string[];
  pay_basis: PayBasis;
  minimum_base: string;
  target_base: string;
  default_resume_id: number | null;
  is_active: boolean;
};

// Same values the web onboarding posts, so a profile reads identically on
// both platforms (the server stores these as plain strings).
const WORK_TYPES: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", on_site: "On-site" };
const EMPLOYMENT_TYPES: Record<string, string> = {
  full_time: "Full time", contract: "Contract", fractional: "Fractional", hourly: "Hourly", salaried: "Salaried",
};

const blank: Draft = {
  name: "", target_titles: [], industries: [], functional_areas: [], include_keywords: [], exclude_keywords: [],
  work_types: ["remote", "hybrid"], employment_types: ["full_time"], countries: ["United States"], states_regions: [], cities: [],
  pay_basis: "salary", minimum_base: "", target_base: "", default_resume_id: null, is_active: true,
};

type ListKey = "target_titles" | "industries" | "functional_areas" | "include_keywords" | "exclude_keywords" | "work_types" | "employment_types";
type QuestionKey = "name" | ListKey | "location" | "compensation";

const QUESTIONS: ReadonlyArray<{ module: string; key: QuestionKey; title: string; help: string; placeholder?: string; optional?: boolean }> = [
  { module: "Direction", key: "name", title: "What should we call this career direction?", help: "Use a short label you will recognize, such as Quality Leadership or Product Design.", placeholder: "Quality leadership" },
  { module: "Direction", key: "target_titles", title: "Which roles should Kall look for?", help: "Tap Kall's suggestions to approve them, or add another role. Include close variants -- job boards phrase the same role differently.", placeholder: "QA Director" },
  { module: "Direction", key: "industries", title: "Which industries fit this direction?", help: "Short, specific industry names match best. Leave this open if the role matters more than the industry.", placeholder: "SaaS, games, financial services" },
  { module: "Direction", key: "functional_areas", title: "Which functions describe the work?", help: "Kall widens the search to related titles in these areas, so a role phrased differently still shows up.", placeholder: "Search functions", optional: true },
  { module: "Evidence", key: "include_keywords", title: "What strengths should a matching role need?", help: "List skills and specialties your resume can support. Kall will use these as matching evidence, not invent them.", placeholder: "Quality strategy, test automation, team leadership" },
  { module: "Evidence", key: "exclude_keywords", title: "Anything Kall should rule out?", help: "Postings that mention these phrases are excluded from every search and match.", placeholder: "Unpaid internship, door-to-door", optional: true },
  { module: "Work fit", key: "work_types", title: "Where would you do the work?", help: "Choose every setting that works for you.", placeholder: "Add another setting" },
  { module: "Work fit", key: "employment_types", title: "What kind of arrangement?", help: "Choose every arrangement you would consider.", placeholder: "Add another arrangement" },
  { module: "Work fit", key: "location", title: "Where are you willing to work?", help: "A country and state or region is enough. Cities narrow it further. Leave uncertain details open instead of guessing." },
  { module: "Compensation", key: "compensation", title: "What pay range should Kall use?", help: "Enter your own minimum and target. Resume suggestions are only starting points for your review." },
];

function profileDraft(profile: CareerProfile): Draft {
  return {
    name: profile.name,
    target_titles: [...profile.target_titles],
    industries: [...profile.industries],
    functional_areas: [...(profile.functional_areas ?? [])],
    include_keywords: [...profile.include_keywords],
    exclude_keywords: [...(profile.exclude_keywords ?? [])],
    work_types: [...profile.work_types],
    employment_types: [...(profile.employment_types ?? [])],
    countries: [...profile.countries],
    states_regions: [...profile.states_regions],
    cities: [...(profile.cities ?? [])],
    pay_basis: profile.pay_basis === "hourly" ? "hourly" : "salary",
    minimum_base: profile.minimum_base?.toString() || "",
    target_base: profile.target_base?.toString() || "",
    default_resume_id: profile.default_resume_id || null,
    is_active: profile.is_active,
  };
}

type SuggestedLists = Partial<Record<ListKey, string[]>>;

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

function ValueChips({ values, labels, onRemove }: { values: string[]; labels?: Record<string, string>; onRemove?: (value: string) => void }) {
  if (!values.length) return null;
  return <View style={styles.chipWrap}>{values.map((value) => <View key={value} style={styles.valueChip}>
    <Text style={styles.valueChipText}>{labels?.[value] ?? value}</Text>
    {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${labels?.[value] ?? value}`} hitSlop={8} onPress={() => onRemove(value)}>
      <Text style={styles.removeChip}>×</Text>
    </Pressable> : null}
  </View>)}</View>;
}

function ChoiceField({ label, values, suggestions = [], presets = [], labels, placeholder, allowCustom = true, onChange }: {
  label: string; values: string[]; suggestions?: string[]; presets?: string[]; labels?: Record<string, string>; placeholder: string; allowCustom?: boolean; onChange: (values: string[]) => void;
}) {
  const [entry, setEntry] = useState("");
  const add = (raw: string) => {
    const value = raw.trim();
    if (!value || values.some((item) => same(item, value))) return;
    onChange([...values, value]);
    setEntry("");
  };
  const options = [...presets, ...suggestions].filter((value, index, all) => value && all.findIndex((item) => same(item, value)) === index);
  return <View style={styles.choiceField}>
    <Text style={styles.label}>{label}</Text>
    {options.length ? <View style={styles.choiceWrap}>{options.map((value) => {
      const selected = values.some((item) => same(item, value));
      return <Pressable key={value} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} style={[styles.choiceButton, selected && styles.choiceButtonSelected]} onPress={() => selected ? onChange(values.filter((item) => !same(item, value))) : add(value)}>
        <Text style={[styles.choiceButtonText, selected && styles.choiceButtonTextSelected]}>{selected ? "✓ " : "+ "}{labels?.[value] ?? value}</Text>
      </Pressable>;
    })}</View> : null}
    <ValueChips values={values.filter((value) => !options.some((option) => same(option, value)))} labels={labels} onRemove={(value) => onChange(values.filter((item) => item !== value))} />
    {allowCustom ? <View style={styles.addRow}>
      <TextInput accessibilityLabel={`Add ${label}`} style={[styles.input, styles.addInput]} value={entry} onChangeText={setEntry} onSubmitEditing={() => add(entry)} returnKeyType="done" placeholder={placeholder} placeholderTextColor={theme.textMuted} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Confirm ${label} entry`} style={[styles.addButton, !entry.trim() && styles.disabled]} disabled={!entry.trim()} onPress={() => add(entry)}><Text style={styles.addButtonText}>Add</Text></Pressable>
    </View> : null}
  </View>;
}

/** A pick-from-a-long-list field: the selected values as chips, a search
 * box, and the closest matches from `options`. Free text is still allowed
 * when the list is missing something. */
function SearchChoiceField({ label, values, options, suggestions = [], placeholder, emptyHint, onChange }: {
  label: string; values: string[]; options: string[]; suggestions?: string[]; placeholder: string; emptyHint?: string; onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const offered = suggestions.filter((value, index, all) => value && all.findIndex((item) => same(item, value)) === index && !values.some((item) => same(item, value)));
  const matches = useMemo(() => {
    if (!trimmed) return [];
    const needle = trimmed.toLocaleLowerCase();
    const starts = options.filter((option) => option.toLocaleLowerCase().startsWith(needle));
    const contains = options.filter((option) => !option.toLocaleLowerCase().startsWith(needle) && option.toLocaleLowerCase().includes(needle));
    return [...starts, ...contains].filter((option) => !values.some((value) => same(value, option))).slice(0, 8);
  }, [options, trimmed, values]);
  const exact = options.some((option) => same(option, trimmed));
  const add = (value: string) => {
    if (!value || values.some((item) => same(item, value))) return;
    onChange([...values, value]);
    setQuery("");
  };
  return <View style={styles.choiceField}>
    <Text style={styles.label}>{label}</Text>
    <ValueChips values={values} onRemove={(value) => onChange(values.filter((item) => item !== value))} />
    {offered.length ? <>
      <Text style={styles.hint}>Suggested from your resume and roles. Tap to approve.</Text>
      <View style={styles.choiceWrap}>{offered.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Approve ${option}`} style={styles.choiceButton} onPress={() => add(option)}>
        <Text style={styles.choiceButtonText}>+ {option}</Text>
      </Pressable>)}</View>
    </> : null}
    {options.length === 0 && emptyHint ? <Text style={styles.hint}>{emptyHint}</Text> : null}
    <TextInput accessibilityLabel={`Search ${label}`} style={styles.input} value={query} onChangeText={setQuery} onSubmitEditing={() => add(matches[0] ?? trimmed)} returnKeyType="done" placeholder={placeholder} placeholderTextColor={theme.textMuted} autoCorrect={false} />
    {matches.length ? <View style={styles.choiceWrap}>{matches.map((option) => <Pressable key={option} accessibilityRole="button" style={styles.choiceButton} onPress={() => add(option)}>
      <Text style={styles.choiceButtonText}>+ {option}</Text>
    </Pressable>)}</View> : null}
    {trimmed && !exact && !matches.some((option) => same(option, trimmed)) ? <Pressable accessibilityRole="button" style={styles.textButton} onPress={() => add(trimmed)}>
      <Text style={styles.textButtonText}>Use "{trimmed}" as typed</Text>
    </Pressable> : null}
  </View>;
}

export default function CareerProfilesScreen() {
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [functionalAreaOptions, setFunctionalAreaOptions] = useState<FunctionalArea[]>([]);
  const functionalAreas = useMemo(() => functionalAreaOptions.map((area) => area.name), [functionalAreaOptions]);
  // Titles the related-titles lookup has already been asked about, so the
  // same approved set is not re-sent on every render.
  const relatedAskedFor = useRef<string>("");
  const [editing, setEditing] = useState<CareerProfile | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [step, setStep] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [suggestedLists, setSuggestedLists] = useState<SuggestedLists>({});
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [profileData, resumeData, areaData] = await Promise.all([
        fetchCareerProfiles(),
        fetchResumeStudio(),
        fetchFunctionalAreas().catch(() => ({ areas: [] })),
      ]);
      setProfiles(profileData.profiles);
      setResumes(resumeData.resumes);
      setFunctionalAreaOptions(areaData.areas);
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
    setSuggestedLists({});
    relatedAskedFor.current = "";
    setStep(0);
    setMessage(profile ? "Review each answer. Kall keeps anything unfinished visible." : "Start with a resume for suggestions, or answer one question at a time.");
    // Editing an existing direction still deserves suggestions: read the
    // resume it is based on (or the only one there is) for lists to offer,
    // without touching the answers already confirmed.
    const source = profile
      ? resumes.find((resume) => resume.id === profile.default_resume_id) ?? (resumes.length === 1 ? resumes[0] : undefined)
      : undefined;
    if (source) void suggestFromResume(source, { listsOnly: true });
  }

  const mergeSuggestions = useCallback((incoming: SuggestedLists) => {
    setSuggestedLists((current) => {
      const next: SuggestedLists = { ...current };
      for (const [key, values] of Object.entries(incoming) as Array<[ListKey, string[] | undefined]>) {
        const existing = next[key] ?? [];
        next[key] = [...existing, ...(values ?? []).filter((value) => value && !existing.some((item) => same(item, value)))];
      }
      return next;
    });
  }, []);

  async function suggestFromResume(resume: Resume, options: { listsOnly?: boolean } = {}) {
    setSuggesting(true);
    if (!options.listsOnly) setMessage("Reading your resume and preparing suggestions for review.");
    try {
      const { suggestion } = await suggestCareerStrategy(resume.id);
      if (!options.listsOnly) {
        setDraft((current) => ({
          ...current,
          name: suggestion?.profile_name || current.name,
          pay_basis: suggestion?.pay_basis === "hourly" ? "hourly" : suggestion?.pay_basis === "salary" ? "salary" : current.pay_basis,
          minimum_base: suggestion?.suggested_salary_min?.toString() || current.minimum_base,
          target_base: suggestion?.suggested_salary_max?.toString() || current.target_base,
          default_resume_id: resume.id,
        }));
      }
      mergeSuggestions(suggestion ? {
        target_titles: suggestion.target_titles || [], functional_areas: suggestion.functional_areas || [],
        industries: suggestion.industries || [], include_keywords: suggestion.keywords || [], work_types: suggestion.work_types || [],
      } : {});
      if (!options.listsOnly) {
        setMessage(suggestion ? "Suggestions are ready. Tap the ones you approve as you move through the questions." : "That resume did not provide enough detail, so the questions remain open.");
      }
    } catch (error) {
      if (!options.listsOnly) setMessage(error instanceof ApiError ? error.message : "Kall could not prepare suggestions from that resume.");
    } finally {
      setSuggesting(false);
    }
  }

  // Each approved title surfaces the next spellings boards use for it, so
  // the list of suggestions grows with the answer instead of staying fixed.
  const onTitlesQuestion = step === 1;
  const approvedTitles = draft.target_titles;
  useEffect(() => {
    if (!onTitlesQuestion || approvedTitles.length === 0) return;
    const signature = approvedTitles.map((title) => title.toLocaleLowerCase()).sort().join("|");
    if (signature === relatedAskedFor.current) return;
    const handle = setTimeout(() => {
      relatedAskedFor.current = signature;
      fetchRelatedTitles(approvedTitles, suggestedLists.target_titles ?? [])
        .then(({ titles }) => { if (titles.length) mergeSuggestions({ target_titles: titles }); })
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(handle);
  }, [onTitlesQuestion, approvedTitles, suggestedLists.target_titles, mergeSuggestions]);

  // Functions implied by the approved titles (via the vocabulary's related
  // roles) join the resume's own suggestions on the functions question.
  const impliedAreas = useMemo(() => {
    const haystack = draft.target_titles.map((title) => title.toLocaleLowerCase());
    return functionalAreaOptions
      .filter((area) => [area.name, ...area.related_roles].some((phrase) => haystack.some((title) => title.includes(phrase.toLocaleLowerCase()))))
      .map((area) => area.name);
  }, [draft.target_titles, functionalAreaOptions]);

  async function uploadAndSuggest() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const selected = result.assets[0];
    if (selected.size != null && selected.size > MAX_RESUME_BYTES) {
      setMessage("This resume is larger than the 15 MB upload limit.");
      return;
    }
    setUploading(true);
    setMessage("Uploading your resume…");
    try {
      const resume = await uploadResume({ uri: selected.uri, name: selected.name, mimeType: resumeMimeType(selected.name, selected.mimeType) });
      setResumes((current) => [resume, ...current.filter((item) => item.id !== resume.id)]);
      await suggestFromResume(resume);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to upload this resume.");
    } finally {
      setUploading(false);
    }
  }

  const unknowns = useMemo(() => [
    !draft.name.trim() && "career direction name",
    !draft.target_titles.length && "target roles",
    !draft.industries.length && "industries",
    !draft.include_keywords.length && "evidence-backed strengths",
    !draft.work_types.length && "work setting",
    !draft.employment_types.length && "work arrangement",
    !draft.countries.length && !draft.states_regions.length && "location",
    !draft.target_base.trim() && "target compensation",
  ].filter(Boolean) as string[], [draft]);

  async function save() {
    if (!draft.name.trim() || !draft.target_titles.length) {
      setStep(!draft.name.trim() ? 0 : 1);
      setMessage("A profile needs a name and at least one target role.");
      return;
    }
    const body: CareerProfileInput = {
      name: draft.name.trim(), target_titles: draft.target_titles, industries: draft.industries,
      functional_areas: draft.functional_areas, include_keywords: draft.include_keywords, exclude_keywords: draft.exclude_keywords,
      countries: draft.countries, states_regions: draft.states_regions, cities: draft.cities,
      work_types: draft.work_types, employment_types: draft.employment_types, pay_basis: draft.pay_basis,
      minimum_base: numberOrNull(draft.minimum_base), target_base: numberOrNull(draft.target_base),
      default_resume_id: draft.default_resume_id,
      ...(editing ? { is_active: draft.is_active } : {}),
    };
    setSaving(true);
    setMessage("Saving only the answers shown in your review.");
    try {
      if (editing) {
        await saveCareerProfile(editing.id, body);
      } else {
        await createCareerProfile(body);
        markOnboardingComplete(resumes.length > 0).catch(() => undefined);
      }
      await load();
      setStep(null);
      setEditing(null);
      setDraft({ ...blank });
      setSuggestedLists({});
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
      setDraft({ ...draft, countries: [], states_regions: [], cities: [] });
    } else if (question.key === "compensation") {
      setDraft({ ...draft, minimum_base: "", target_base: "" });
    } else if (question.key === "name") {
      setDraft({ ...draft, name: "" });
    } else {
      setDraft({ ...draft, [question.key]: [] });
    }
    setStep(step + 1);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: theme.background }} color={theme.text} />;
  const atReview = step === QUESTIONS.length;
  const question = step != null && !atReview ? QUESTIONS[step] : null;
  const answered = 8 - unknowns.length;
  const regionOptions = regionsForCountries(draft.countries);
  const payLabel = draft.pay_basis === "hourly" ? "hourly rate" : "annual base";
  const reviewRows: Array<{ label: string; value: string | string[]; labels?: Record<string, string>; step: number }> = [
    { label: "Direction", value: draft.name, step: 0 },
    { label: "Target roles", value: draft.target_titles, step: 1 },
    { label: "Industries", value: draft.industries, step: 2 },
    { label: "Functions", value: draft.functional_areas, step: 3 },
    { label: "Strengths", value: draft.include_keywords, step: 4 },
    { label: "Ruled out", value: draft.exclude_keywords, step: 5 },
    { label: "Work setting", value: draft.work_types, labels: WORK_TYPES, step: 6 },
    { label: "Arrangement", value: draft.employment_types, labels: EMPLOYMENT_TYPES, step: 7 },
    { label: "Location", value: [...draft.countries, ...draft.states_regions, ...draft.cities], step: 8 },
    { label: draft.pay_basis === "hourly" ? "Hourly rate" : "Base salary", value: draft.minimum_base || draft.target_base ? `${draft.minimum_base || "not set"} to ${draft.target_base || "not set"}` : "", step: 9 },
  ];
  const optionalRows = new Set(["Functions", "Ruled out"]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={88}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentInsetAdjustmentBehavior="automatic">
      <Text style={styles.title}>Career profiles</Text>
      <Text style={styles.subtitle}>Tell Kall what a good next role looks like. Kall will guide the questions, use only facts you confirm, and show what still needs an answer.</Text>
      {step == null ? <>
        <View style={styles.guideCard}>
          <Text style={styles.eyebrow}>GUIDED PROFILE</Text>
          <Text style={styles.guideTitle}>Build a direction with Kall</Text>
          <Text style={styles.cardBody}>Ten short questions cover direction, evidence, work fit, and compensation. A resume can provide suggestions for you to review.</Text>
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
        {step === 0 && !editing ? <View style={styles.resumeBox}>
          <Text style={styles.sectionTitle}>Start with a resume</Text><Text style={styles.cardBody}>Kall reads it and suggests answers. Nothing is saved until your final review.</Text>
          {resumes.map((resume) => <Pressable accessibilityRole="button" key={resume.id} disabled={suggesting || uploading} style={styles.resumeChoice} onPress={() => void suggestFromResume(resume)}><Text style={styles.resumeChoiceText}>{draft.default_resume_id === resume.id ? "✓ " : ""}Use {resume.name}</Text></Pressable>)}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: suggesting || uploading, busy: uploading }} disabled={suggesting || uploading} style={[styles.uploadButton, (suggesting || uploading) && styles.disabled]} onPress={() => void uploadAndSuggest()}>
            {uploading || suggesting ? <ActivityIndicator color={theme.text} /> : <Text style={styles.uploadButtonText}>{resumes.length ? "Upload a different resume" : "Upload a resume (PDF, Word, or text)"}</Text>}
          </Pressable>
        </View> : null}
        {question ? <View style={styles.question}>
          <Text style={styles.questionTitle}>{question.title}</Text><Text style={styles.questionHelp}>{question.help}</Text>
          {question.key === "location" ? <>
            <SearchChoiceField label="countries" values={draft.countries} options={countryNames} placeholder="Search countries" onChange={(countries) => {
              const allowed = new Set(regionsForCountries(countries).map((region) => region.toLocaleLowerCase()));
              setDraft({ ...draft, countries, states_regions: draft.states_regions.filter((region) => allowed.has(region.toLocaleLowerCase())) });
            }} />
            <SearchChoiceField label="states or regions" values={draft.states_regions} options={regionOptions} placeholder={draft.countries.length ? "Search states or regions" : "Choose a country first"} emptyHint={draft.countries.length ? undefined : "Add a country to see its states and regions."} onChange={(states_regions) => setDraft({ ...draft, states_regions })} />
            <ChoiceField label="cities (optional)" values={draft.cities} placeholder="Add a city you'd work in or near" onChange={(cities) => setDraft({ ...draft, cities })} />
          </> : question.key === "compensation" ? <>
            <Text style={styles.label}>Pay basis</Text>
            <View style={styles.choiceWrap}>
              {(["salary", "hourly"] as const).map((basis) => <Pressable key={basis} accessibilityRole="radio" accessibilityState={{ checked: draft.pay_basis === basis }} style={[styles.choiceButton, draft.pay_basis === basis && styles.choiceButtonSelected]} onPress={() => setDraft({ ...draft, pay_basis: basis })}>
                <Text style={[styles.choiceButtonText, draft.pay_basis === basis && styles.choiceButtonTextSelected]}>{basis === "salary" ? "Annual salary" : "Hourly rate"}</Text>
              </Pressable>)}
            </View>
            <Text style={styles.label}>Minimum {payLabel}</Text><TextInput accessibilityLabel={`Minimum ${payLabel}`} keyboardType="number-pad" style={styles.input} value={draft.minimum_base} onChangeText={(minimum_base) => setDraft({ ...draft, minimum_base })} placeholder={draft.pay_basis === "hourly" ? "60" : "120000"} placeholderTextColor={theme.textMuted} />
            <Text style={styles.label}>Target {payLabel}</Text><TextInput accessibilityLabel={`Target ${payLabel}`} keyboardType="number-pad" style={styles.input} value={draft.target_base} onChangeText={(target_base) => setDraft({ ...draft, target_base })} placeholder={draft.pay_basis === "hourly" ? "85" : "150000"} placeholderTextColor={theme.textMuted} />
          </> : question.key === "name" ? <TextInput accessibilityLabel={question.title} style={styles.input} value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} returnKeyType="done" placeholder={question.placeholder} placeholderTextColor={theme.textMuted} />
          : question.key === "functional_areas" ? <SearchChoiceField label="functions" values={draft.functional_areas} options={functionalAreas} suggestions={[...(suggestedLists.functional_areas ?? []), ...impliedAreas]} placeholder={question.placeholder ?? ""} onChange={(functional_areas) => setDraft({ ...draft, functional_areas })} />
          : <ChoiceField
              key={question.key}
              label={question.key === "target_titles" ? "roles" : question.key === "include_keywords" ? "strengths" : question.key === "exclude_keywords" ? "phrases to exclude" : question.key === "work_types" ? "work settings" : question.key === "employment_types" ? "arrangements" : "industries"}
              values={draft[question.key]}
              suggestions={suggestedLists[question.key]}
              presets={question.key === "work_types" ? Object.keys(WORK_TYPES) : question.key === "employment_types" ? Object.keys(EMPLOYMENT_TYPES) : []}
              labels={question.key === "work_types" ? WORK_TYPES : question.key === "employment_types" ? EMPLOYMENT_TYPES : undefined}
              allowCustom={question.key !== "work_types" && question.key !== "employment_types"}
              placeholder={question.placeholder ?? ""}
              onChange={(values) => setDraft({ ...draft, [question.key]: values })}
            />}
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => setStep(step + 1)}><Text style={styles.buttonText}>{question.optional && !draft[question.key as ListKey]?.length ? "Skip this" : "Keep this answer"}</Text></Pressable>
          {!question.optional ? <Pressable accessibilityRole="button" style={styles.textButton} onPress={leaveOpen}><Text style={styles.textButtonText}>Leave open for now</Text></Pressable> : null}
        </View> : null}
        {atReview ? <View style={styles.review}>
          <Text style={styles.questionTitle}>Review your direction</Text>
          {reviewRows.map(({ label, value, labels, step: targetStep }) => <Pressable accessibilityRole="button" key={label} style={styles.reviewRow} onPress={() => setStep(targetStep)}>
            <Text style={styles.reviewLabel}>{label}</Text>
            {Array.isArray(value) ? value.length ? <ValueChips values={value} labels={labels} /> : <Text style={optionalRows.has(label) ? styles.optionalValue : styles.openValue}>{optionalRows.has(label) ? "None" : "Still needs your input"}</Text> : <Text style={value ? styles.reviewValue : styles.openValue}>{value || "Still needs your input"}</Text>}
          </Pressable>)}
          {editing ? <View style={styles.switchRow}><View style={{ flex: 1 }}><Text style={styles.switchTitle}>Active search profile</Text><Text style={styles.switchDetail}>Include this direction in search and matching.</Text></View><Switch value={draft.is_active} onValueChange={(is_active) => setDraft({ ...draft, is_active })} trackColor={{ false: theme.border, true: theme.accent }} /></View> : null}
          <Pressable accessibilityRole="button" style={[styles.button, saving && styles.disabled]} disabled={saving} onPress={() => void save()}>{saving ? <ActivityIndicator color={theme.accentInk} /> : <Text style={styles.buttonText}>{editing ? "Save confirmed answers" : "Create this profile"}</Text>}</Pressable>
        </View> : null}
        {step > 0 ? <Pressable accessibilityRole="button" style={styles.backButton} onPress={() => setStep(step - 1)}><Text style={styles.backButtonText}>Back</Text></Pressable> : null}
      </View>}
      {message ? <Text accessibilityLiveRegion="polite" style={message.includes("saved") || message.includes("ready") ? styles.success : styles.message}>{message}</Text> : null}
    </ScrollView>
    </KeyboardAvoidingView>
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
  uploadButton: { minHeight: 46, alignItems: "center", justifyContent: "center", borderColor: theme.borderStrong, borderWidth: 1, borderRadius: 10, marginTop: 12 }, uploadButtonText: { color: theme.text, fontWeight: "700" },
  question: { backgroundColor: theme.surface, borderRadius: 14, borderColor: theme.border, borderWidth: 1, padding: 18 },
  questionTitle: { color: theme.text, fontSize: 20, fontWeight: "700" }, questionHelp: { color: theme.textSecondary, lineHeight: 20, marginTop: 8, marginBottom: 14 },
  label: { color: theme.textSecondary, fontSize: 13, fontWeight: "600", marginTop: 8 },
  hint: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  input: { minHeight: 50, color: theme.text, backgroundColor: theme.background, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, marginTop: 7, marginBottom: 8 },
  choiceField: { gap: 8 }, choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choiceButton: { minHeight: 44, justifyContent: "center", borderColor: theme.border, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, backgroundColor: theme.background },
  choiceButtonSelected: { borderColor: theme.accent, backgroundColor: theme.accent }, choiceButtonText: { color: theme.text, fontWeight: "600" }, choiceButtonTextSelected: { color: theme.accentInk },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }, valueChip: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 7, borderColor: theme.accent, borderWidth: 1, borderRadius: 19, paddingHorizontal: 12, backgroundColor: theme.background },
  valueChipText: { color: theme.text, fontWeight: "600", maxWidth: 230 }, removeChip: { color: theme.textSecondary, fontSize: 22, lineHeight: 24 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8 }, addInput: { flex: 1, marginBottom: 0 }, addButton: { minHeight: 50, justifyContent: "center", borderRadius: 10, paddingHorizontal: 16, backgroundColor: theme.surfaceRaised }, addButtonText: { color: theme.text, fontWeight: "700" },
  button: { minHeight: 50, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent, borderRadius: 10, marginTop: 14 }, buttonText: { color: theme.accentInk, fontWeight: "700" },
  textButton: { minHeight: 44, alignItems: "center", justifyContent: "center" }, textButtonText: { color: theme.textSecondary, fontWeight: "600" },
  backButton: { minHeight: 44, alignItems: "flex-start", justifyContent: "center" }, backButtonText: { color: theme.text, fontWeight: "700" },
  review: { backgroundColor: theme.surface, borderRadius: 14, borderColor: theme.border, borderWidth: 1, padding: 18 },
  reviewRow: { borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: 12 }, reviewLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: "700" },
  reviewValue: { color: theme.text, marginTop: 4, lineHeight: 19 }, openValue: { color: theme.accent, marginTop: 4, fontWeight: "600" }, optionalValue: { color: theme.textMuted, marginTop: 4 },
  card: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 10 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, cardTitle: { flex: 1, color: theme.text, fontSize: 16, fontWeight: "700" },
  score: { color: theme.accent, fontWeight: "700" }, cardBody: { color: theme.textSecondary, lineHeight: 19, marginTop: 6 }, meta: { color: theme.textMuted, fontSize: 12, marginTop: 8 },
  switchRow: { minHeight: 64, flexDirection: "row", alignItems: "center", marginTop: 12 }, switchTitle: { color: theme.text, fontWeight: "700" }, switchDetail: { color: theme.textSecondary, fontSize: 12, marginTop: 3 },
  disabled: { opacity: 0.55 }, success: { color: theme.success, marginTop: 14 }, message: { color: theme.textSecondary, marginTop: 14, lineHeight: 19 },
});
