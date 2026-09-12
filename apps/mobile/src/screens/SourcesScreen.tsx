import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import { fetchSuppressed, restoreAllResults, restoreResult, type SuppressedResult } from "../api/search";
import { addSearchSource, fetchRuns, fetchSchedules, fetchSearchSources, saveSchedule, type Schedule, type SearchRun, type SearchSource } from "../api/sources";
import { fetchCareerProfiles, type CareerProfile } from "../api/workspace";
import { FormActions, FormField, SelectChips, SwitchRow, formStyles } from "../components/form";
import { theme } from "../theme";

const PROVIDERS = [
  { value: "greenhouse", label: "Greenhouse", hint: "boards.greenhouse.io/<slug>" },
  { value: "lever", label: "Lever", hint: "jobs.lever.co/<slug>" },
  { value: "ashby", label: "Ashby", hint: "jobs.ashbyhq.com/<slug>" },
  { value: "workday", label: "Workday", hint: "<company>.wdN.myworkdayjobs.com/<site> -- paste the address bar URL" },
] as const;

const CADENCES = [
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "continuous", label: "Continuous" },
] as const;

// Same rule providers/board_feed.py's feed_key enforces for the three
// simple-slug providers, checked here so a pasted URL is caught before it
// silently breaks a scheduled poll. Workday's board key is deliberately a
// URL-shaped host+site path instead of a bare slug (see providers/
// workday.py's _parse_board_key), so it gets its own, more permissive check.
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const WORKDAY_BOARD_KEY_PATTERN = /^(?:https?:\/\/)?[A-Za-z0-9.-]+\.myworkdayjobs\.com\/[A-Za-z0-9_-]+\/?$/;
const REASON_LABELS: Record<string, string> = { dead_link: "Dead link", applied_external: "Applied on their site", applied_kall: "Applied through Kall" };

function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatWhen(value: string | null) {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

type ScheduleDraft = { cadence: string; hour: string; timezone: string; maxAge: string; enabled: boolean };

function draftFor(schedule: Schedule | undefined): ScheduleDraft {
  return {
    cadence: schedule?.cadence ?? "daily",
    hour: String(schedule ? Number(schedule.run_at_local.split(":")[0]) : 8),
    timezone: schedule?.timezone ?? deviceTimezone(),
    maxAge: String(schedule?.max_posting_age_days ?? 30),
    enabled: schedule?.enabled ?? true,
  };
}

export default function SourcesScreen() {
  const [sources, setSources] = useState<SearchSource[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [hidden, setHidden] = useState<SuppressedResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [addingSource, setAddingSource] = useState(false);
  const [source, setSource] = useState({ provider: "greenhouse", company_name: "", board_key: "" });
  const [editingProfile, setEditingProfile] = useState<number | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft>(draftFor(undefined));

  const load = useCallback(async () => {
    try {
      const [sourceRows, scheduleRows, profileRows, runRows, hiddenRows] = await Promise.all([
        fetchSearchSources().catch(() => [] as SearchSource[]),
        fetchSchedules().catch(() => [] as Schedule[]),
        fetchCareerProfiles().then((data) => data.profiles).catch(() => [] as CareerProfile[]),
        fetchRuns().catch(() => [] as SearchRun[]),
        fetchSuppressed().catch(() => [] as SuppressedResult[]),
      ]);
      setSources(sourceRows);
      setSchedules(scheduleRows);
      setProfiles(profileRows);
      setRuns(runRows.slice(0, 5));
      setHidden(hiddenRows);
      setMessage("");
    } catch {
      setMessage("Unable to load search settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function run(key: string, work: () => Promise<string>) {
    setBusy(key);
    setMessage("");
    try {
      setMessage(await work());
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to save that change.");
    } finally {
      setBusy(null);
    }
  }

  function submitSource() {
    const slug = source.board_key.trim();
    if (!source.company_name.trim()) { setMessage("Give the board a company name."); return; }
    if (source.provider === "workday") {
      if (!WORKDAY_BOARD_KEY_PATTERN.test(slug)) { setMessage("Paste the company's Workday careers URL, e.g. acme.wd5.myworkdayjobs.com/External."); return; }
    } else if (!SLUG_PATTERN.test(slug)) {
      setMessage("Use the board's slug, not a URL: letters, numbers, dashes or underscores only.");
      return;
    }
    void run("add-source", async () => {
      await addSearchSource({ provider: source.provider, company_name: source.company_name.trim(), board_key: slug });
      setSource({ provider: source.provider, company_name: "", board_key: "" });
      setAddingSource(false);
      await load();
      return "Company board added. The next search includes it.";
    });
  }

  function submitSchedule(profileId: number) {
    const hour = Number(draft.hour);
    const maxAge = Number(draft.maxAge);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) { setMessage("Hour must be 0 to 23."); return; }
    if (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > 90) { setMessage("Posting age must be 1 to 90 days."); return; }
    if (!draft.timezone.trim()) { setMessage("Enter a time zone such as America/Los_Angeles."); return; }
    void run(`schedule-${profileId}`, async () => {
      await saveSchedule({
        professional_profile_id: profileId,
        cadence: draft.cadence,
        timezone: draft.timezone.trim(),
        hour_local: hour,
        max_posting_age_days: maxAge,
        enabled: draft.enabled,
      });
      setEditingProfile(null);
      await load();
      return "Search schedule saved.";
    });
  }

  function restore(item: SuppressedResult) {
    void run(`restore-${item.id}`, async () => {
      await restoreResult(item.url);
      setHidden((current) => current.filter((row) => row.id !== item.id));
      return "Result restored.";
    });
  }

  if (loading) {
    return <View style={[styles.container, styles.centered]}><ActivityIndicator color={theme.text} accessibilityLabel="Loading search settings" /></View>;
  }

  const providerHint = PROVIDERS.find((item) => item.value === source.provider)?.hint;
  const scheduleByProfile = new Map(schedules.map((schedule) => [schedule.professional_profile_id, schedule]));

  return (
    <KeyboardAvoidingView style={styles.container} behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={88}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {message ? <Text style={/saved|added|restored/i.test(message) ? formStyles.success : formStyles.error}>{message}</Text> : null}

        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Company job boards</Text>
          <Text style={formStyles.body}>Boards Kall reads directly on every search, alongside the wider web search. Supported: Greenhouse, Lever, Ashby.</Text>
          {sources.length === 0 ? <Text style={[formStyles.muted, styles.spaced]}>None added yet.</Text> : null}
          {sources.map((item) => (
            <View key={item.id} style={styles.listRow}>
              <View style={styles.listCopy}>
                <Text style={styles.listTitle}>{item.company_name}</Text>
                <Text style={formStyles.muted}>{PROVIDERS.find((p) => p.value === item.provider)?.label ?? item.provider} · {item.board_key}{item.enabled ? "" : " · paused"}</Text>
              </View>
            </View>
          ))}
          {addingSource ? (
            <>
              <SelectChips label="Provider" value={source.provider} options={PROVIDERS} onChange={(provider) => setSource({ ...source, provider: provider ?? "greenhouse" })} />
              <FormField label="Company name" value={source.company_name} onChange={(company_name) => setSource({ ...source, company_name })} autoCapitalize="words" />
              <FormField label="Board slug" value={source.board_key} onChange={(board_key) => setSource({ ...source, board_key })} autoCapitalize="none" placeholder="acme" help={`The last part of the board's address: ${providerHint}`} />
              <FormActions>
                <Pressable accessibilityRole="button" disabled={busy === "add-source"} style={[formStyles.primary, busy === "add-source" && formStyles.disabled]} onPress={submitSource}>
                  {busy === "add-source" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Add board</Text>}
                </Pressable>
                <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => setAddingSource(false)}><Text style={formStyles.secondaryText}>Cancel</Text></Pressable>
              </FormActions>
            </>
          ) : (
            <FormActions>
              <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => setAddingSource(true)}><Text style={formStyles.secondaryText}>Add a company board</Text></Pressable>
            </FormActions>
          )}
        </View>

        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Scheduled searches</Text>
          <Text style={formStyles.body}>Kall can search on its own and put new matches in your brief. Continuous monitoring needs at least one company board.</Text>
          {profiles.length === 0 ? <Text style={[formStyles.muted, styles.spaced]}>Create a career profile first.</Text> : null}
          {profiles.map((profile) => {
            const schedule = scheduleByProfile.get(profile.id);
            const editing = editingProfile === profile.id;
            return (
              <View key={profile.id} style={styles.listRow}>
                <View style={styles.listCopy}>
                  <Text style={styles.listTitle}>{profile.name}</Text>
                  <Text style={formStyles.muted}>
                    {schedule
                      ? `${CADENCES.find((c) => c.value === schedule.cadence)?.label ?? schedule.cadence} at ${schedule.run_at_local.slice(0, 5)} ${schedule.timezone} · ${schedule.monitoring_status.replace(/_/g, " ")} · last run ${formatWhen(schedule.last_run_at)}`
                      : "Not scheduled"}
                  </Text>
                  {schedule?.last_error ? <Text style={styles.errorLine}>{schedule.last_error}</Text> : null}
                  {editing ? (
                    <>
                      <SelectChips label="How often" value={draft.cadence} options={CADENCES} onChange={(cadence) => setDraft({ ...draft, cadence: cadence ?? "daily" })} />
                      <FormField label="Hour (0-23)" value={draft.hour} onChange={(hour) => setDraft({ ...draft, hour })} keyboardType="number-pad" />
                      <FormField label="Time zone" value={draft.timezone} onChange={(timezone) => setDraft({ ...draft, timezone })} autoCapitalize="none" placeholder="America/Los_Angeles" />
                      <FormField label="Ignore postings older than (days)" value={draft.maxAge} onChange={(maxAge) => setDraft({ ...draft, maxAge })} keyboardType="number-pad" />
                      <SwitchRow label="Enabled" value={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
                      <FormActions>
                        <Pressable accessibilityRole="button" disabled={busy === `schedule-${profile.id}`} style={[formStyles.primary, busy === `schedule-${profile.id}` && formStyles.disabled]} onPress={() => submitSchedule(profile.id)}>
                          {busy === `schedule-${profile.id}` ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Save schedule</Text>}
                        </Pressable>
                        <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => setEditingProfile(null)}><Text style={formStyles.secondaryText}>Cancel</Text></Pressable>
                      </FormActions>
                    </>
                  ) : (
                    <FormActions>
                      <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => { setDraft(draftFor(schedule)); setEditingProfile(profile.id); }}>
                        <Text style={formStyles.secondaryText}>{schedule ? "Change schedule" : "Schedule searches"}</Text>
                      </Pressable>
                    </FormActions>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {runs.length > 0 ? (
          <View style={formStyles.card}>
            <Text style={formStyles.cardLabel}>Recent searches</Text>
            {runs.map((item) => (
              <View key={item.id} style={styles.listRow}>
                <View style={styles.listCopy}>
                  <Text style={styles.listTitle}>{formatWhen(item.started_at)}</Text>
                  <Text style={formStyles.muted}>
                    {item.jobs_collected} collected · {item.matches_created} new matches · {item.status.replace(/_/g, " ")}
                    {item.errors.length ? ` · ${item.errors.length} error${item.errors.length === 1 ? "" : "s"}` : ""}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Hidden results</Text>
          <Text style={formStyles.body}>Postings you flagged as dead or already applied to. Dead links stay out of every search; restore one if it was a mistake.</Text>
          {hidden.length === 0 ? <Text style={[formStyles.muted, styles.spaced]}>Nothing hidden.</Text> : null}
          {hidden.map((item) => (
            <View key={item.id} style={styles.listRow}>
              <View style={styles.listCopy}>
                <Text style={styles.listTitle} numberOfLines={2}>{item.title || item.url}</Text>
                <Text style={formStyles.muted}>{REASON_LABELS[item.reason] ?? item.reason} · {formatWhen(item.suppressed_at)}</Text>
              </View>
              <Pressable accessibilityRole="button" disabled={busy === `restore-${item.id}`} style={[formStyles.secondary, styles.restore]} onPress={() => restore(item)}>
                {busy === `restore-${item.id}` ? <ActivityIndicator color={theme.text} /> : <Text style={formStyles.secondaryText}>Restore</Text>}
              </Pressable>
            </View>
          ))}
          {hidden.length > 1 ? (
            <FormActions>
              <Pressable accessibilityRole="button" disabled={busy === "restore-all"} style={formStyles.secondary} onPress={() => void run("restore-all", async () => { const result = await restoreAllResults(); setHidden([]); return `${result.restored} result${result.restored === 1 ? "" : "s"} restored.`; })}>
                <Text style={formStyles.secondaryText}>Restore all</Text>
              </Pressable>
            </FormActions>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 48 },
  spaced: { marginTop: 10 },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 12, marginTop: 12 },
  listCopy: { flex: 1 },
  listTitle: { color: theme.text, fontSize: 15, fontWeight: "700" },
  errorLine: { color: theme.warning, fontSize: 12, lineHeight: 17, marginTop: 4 },
  restore: { minHeight: 40 },
});
