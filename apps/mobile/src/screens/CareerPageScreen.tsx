import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import {
  addCareerPageSection,
  deleteCareerPageSection,
  fetchCareerPage,
  reorderCareerPageSections,
  updateCareerPage,
  updateCareerPageSection,
  type CareerPage,
  type CareerPageSection,
  type Sample,
  type SectionKind,
} from "../api/careerPage";
import { fetchRecords, type RecordRow } from "../api/record";
import { fetchTestimonials } from "../api/testimonials";
import { FormActions, FormField, SelectChips, SwitchRow, formStyles } from "../components/form";
import { careerPageUrl } from "../lib/web";
import { theme } from "../theme";

const THEMES = [
  { value: "parchment", label: "Parchment" },
  { value: "meridian", label: "Meridian" },
];

const KIND_LABELS: Record<string, string> = {
  intro: "Introduction", thesis: "What I'm looking for", history: "Career history", samples: "Work samples",
  principles: "How I work", next: "What's next", skills: "Skills", education: "Education", certifications: "Certifications",
  awards: "Awards", publications: "Publications", speaking: "Speaking", testimonials: "Testimonials", patents: "Patents",
  memberships: "Memberships", service: "Service", custom: "Custom section",
};

type PageDraft = { slug: string; display_name: string; headline: string; summary: string; location: string; theme: string };

function pageDraft(page: CareerPage): PageDraft {
  return {
    slug: page.slug,
    display_name: page.display_name ?? "",
    headline: page.headline ?? "",
    summary: page.summary ?? "",
    location: page.location ?? "",
    theme: page.theme,
  };
}

/** A short label for any profile record, whatever its shape. */
function describe(row: RecordRow): string {
  const pick = (...keys: string[]) => keys.map((key) => row[key]).find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const first = pick("job_title", "role", "name", "title", "institution", "author_name", "organization");
  const second = pick("employer", "issuing_organization", "organization_or_venue", "event", "degree", "membership_type", "author_company");
  const parts = [first, second].filter(Boolean);
  return parts.length ? parts.join(" - ") : `Record ${row.id}`;
}

export default function CareerPageScreen() {
  const [page, setPage] = useState<CareerPage | null>(null);
  const [sections, setSections] = useState<CareerPageSection[]>([]);
  const [kinds, setKinds] = useState<SectionKind[]>([]);
  const [draft, setDraft] = useState<PageDraft | null>(null);
  const [links, setLinks] = useState<Array<{ label: string; url: string }>>([]);
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  const [records, setRecords] = useState<Record<string, RecordRow[]>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sectionDrafts, setSectionDrafts] = useState<Record<number, { title: string; body: string }>>({});
  const [sampleDraft, setSampleDraft] = useState({ title: "", url: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await fetchCareerPage();
      setPage(data.page);
      setSections(data.sections);
      setKinds(data.available_kinds);
      setDraft(pageDraft(data.page));
      setLinks(data.page.links ?? []);
      setSectionDrafts(Object.fromEntries(data.sections.map((section) => [section.id, { title: section.title, body: section.body ?? "" }])));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to load your career page.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function run(key: string, task: () => Promise<string | void>, fallback: string) {
    setBusy(key);
    setMessage("");
    try {
      const result = await task();
      if (result) setMessage(result);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  async function loadRecords(source: string) {
    if (records[source]) return;
    try {
      const rows = source === "testimonials"
        ? ((await fetchTestimonials()) as unknown as RecordRow[])
        : await fetchRecords(source);
      setRecords((current) => ({ ...current, [source]: rows }));
    } catch {
      setRecords((current) => ({ ...current, [source]: [] }));
    }
  }

  function savePage() {
    if (!draft || !page) return;
    void run("page", async () => {
      const body: Parameters<typeof updateCareerPage>[0] = {
        display_name: draft.display_name.trim() || null,
        headline: draft.headline.trim() || null,
        summary: draft.summary.trim() || null,
        location: draft.location.trim() || null,
        theme: draft.theme,
        links,
      };
      if (draft.slug.trim() !== page.slug) body.slug = draft.slug.trim();
      const saved = await updateCareerPage(body);
      setPage(saved);
      setDraft(pageDraft(saved));
      setLinks(saved.links ?? []);
      return "Page details saved.";
    }, "Unable to save the page.");
  }

  function togglePublished() {
    if (!page) return;
    void run("publish", async () => {
      const saved = await updateCareerPage({ published: !page.published });
      setPage(saved);
      return saved.published ? "Published. Anyone with the link can read it." : "Unpublished. Only you can see it now.";
    }, "Unable to change publishing.");
  }

  function saveSection(section: CareerPageSection) {
    const values = sectionDrafts[section.id];
    if (!values) return;
    void run(`section-${section.id}`, async () => {
      const saved = await updateCareerPageSection(section.id, { title: values.title.trim() || section.title, body: values.body.trim() || null });
      setSections((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      return "Section saved.";
    }, "Unable to save that section.");
  }

  function patchSection(section: CareerPageSection, body: Parameters<typeof updateCareerPageSection>[1]) {
    // Optimistic for the toggles; options come back rewritten by the server
    // (a pasted link is reduced to a provider), so that field re-syncs.
    setSections((current) => current.map((item) => (item.id === section.id ? { ...item, ...body } : item)));
    void run(`patch-${section.id}`, async () => {
      const saved = await updateCareerPageSection(section.id, body);
      setSections((current) => current.map((item) => (item.id === saved.id ? { ...item, options: saved.options, item_ids: saved.item_ids, visible: saved.visible } : item)));
    }, "Unable to update that section.");
  }

  function move(section: CareerPageSection, direction: -1 | 1) {
    const index = sections.findIndex((item) => item.id === section.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    setSections(next);
    void run("reorder", async () => { await reorderCareerPageSections(next.map((item) => item.id)); }, "Unable to reorder sections.");
  }

  function removeSection(section: CareerPageSection) {
    Alert.alert("Remove this section?", `"${section.title}" and anything written in it will be removed from the page.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => void run(`remove-${section.id}`, async () => {
          await deleteCareerPageSection(section.id);
          setSections((current) => current.filter((item) => item.id !== section.id));
        }, "Unable to remove that section."),
      },
    ]);
  }

  function addSection(kind: string) {
    void run(`add-${kind}`, async () => {
      const created = await addCareerPageSection(kind, KIND_LABELS[kind] ?? kind);
      setSections((current) => [...current, created]);
      setSectionDrafts((current) => ({ ...current, [created.id]: { title: created.title, body: created.body ?? "" } }));
    }, "Unable to add that section.");
  }

  function toggleItem(section: CareerPageSection, recordId: number) {
    const all = (records[section.source ?? ""] ?? []).map((row) => row.id);
    // An empty list means "all of them", so the first removal has to become
    // an explicit list of everything else.
    const current = section.item_ids.length ? section.item_ids : all;
    const next = current.includes(recordId) ? current.filter((id) => id !== recordId) : [...current, recordId];
    patchSection(section, { item_ids: next });
  }

  function addSample(section: CareerPageSection) {
    const url = sampleDraft.url.trim();
    if (!url) { setMessage("Paste a link to the work sample first."); return; }
    const samples: Sample[] = [...(section.options?.samples ?? []), { url, title: sampleDraft.title.trim(), caption: "", provider: "" }];
    setSampleDraft({ title: "", url: "" });
    patchSection(section, { options: { ...(section.options ?? {}), samples } });
  }

  function removeSample(section: CareerPageSection, index: number) {
    const samples = (section.options?.samples ?? []).filter((_, position) => position !== index);
    patchSection(section, { options: { ...(section.options ?? {}), samples } });
  }

  if (loading || !page || !draft) {
    return <View style={[styles.container, styles.centered]}>{message ? <Text style={formStyles.error}>{message}</Text> : <ActivityIndicator color={theme.text} accessibilityLabel="Loading career page" />}</View>;
  }

  const used = new Set(sections.map((section) => section.kind));
  const url = careerPageUrl(page.slug);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={88}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {message ? <Text style={/saved|Published|Unpublished/.test(message) ? formStyles.success : formStyles.error}>{message}</Text> : null}

        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>{page.published ? "Published" : "Not published"}</Text>
          <Text style={formStyles.body}>
            {page.published
              ? `Anyone with the link can read it${page.view_count ? ` · ${page.view_count} view${page.view_count === 1 ? "" : "s"}` : ""}.`
              : "Only you can see this. Nothing is public until you publish."}
          </Text>
          <Text style={styles.url}>{url}</Text>
          <FormActions>
            <Pressable accessibilityRole="button" disabled={busy === "publish"} style={[formStyles.primary, busy === "publish" && formStyles.disabled]} onPress={togglePublished}>
              {busy === "publish" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>{page.published ? "Unpublish" : "Publish"}</Text>}
            </Pressable>
            {page.published ? (
              <>
                <Pressable accessibilityRole="link" style={formStyles.secondary} onPress={() => void Linking.openURL(url)}><Text style={formStyles.secondaryText}>View</Text></Pressable>
                <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => void Share.share({ message: url }).catch(() => undefined)}><Text style={formStyles.secondaryText}>Share link</Text></Pressable>
              </>
            ) : null}
          </FormActions>
        </View>

        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Address and heading</Text>
          <FormField label="Public address" value={draft.slug} onChange={(slug) => setDraft({ ...draft, slug: slug.toLowerCase() })} autoCapitalize="none" help="3-40 characters: lowercase letters, numbers and hyphens." />
          <FormField label="Name" value={draft.display_name} onChange={(display_name) => setDraft({ ...draft, display_name })} autoCapitalize="words" />
          <FormField label="Headline" value={draft.headline} onChange={(headline) => setDraft({ ...draft, headline })} placeholder="Head of Technology" />
          <FormField label="Summary" value={draft.summary} onChange={(summary) => setDraft({ ...draft, summary })} multiline />
          <FormField label="Location" value={draft.location} onChange={(location) => setDraft({ ...draft, location })} />
          <SelectChips label="Theme" value={draft.theme} options={THEMES} onChange={(value) => setDraft({ ...draft, theme: value ?? "parchment" })} />
          <Text style={styles.subheading}>Links</Text>
          {links.map((link, index) => (
            <View key={`${link.url}-${index}`} style={styles.linkRow}>
              <View style={styles.linkCopy}>
                <Text style={styles.linkLabel}>{link.label || link.url}</Text>
                <Text style={formStyles.muted} numberOfLines={1}>{link.url}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${link.label || link.url}`} onPress={() => setLinks(links.filter((_, position) => position !== index))}>
                <Text style={formStyles.dangerText}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <FormField label="Link label" value={newLink.label} onChange={(label) => setNewLink({ ...newLink, label })} placeholder="Portfolio" />
          <FormField label="Link address" value={newLink.url} onChange={(url) => setNewLink({ ...newLink, url })} placeholder="https://" autoCapitalize="none" keyboardType="url" />
          <FormActions>
            <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => {
              if (!newLink.url.trim()) return;
              setLinks([...links, { label: newLink.label.trim() || newLink.url.trim(), url: newLink.url.trim() }]);
              setNewLink({ label: "", url: "" });
            }}>
              <Text style={formStyles.secondaryText}>Add link</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy === "page"} style={[formStyles.primary, busy === "page" && formStyles.disabled]} onPress={savePage}>
              {busy === "page" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Save page details</Text>}
            </Pressable>
          </FormActions>
        </View>

        <Text accessibilityRole="header" style={styles.sectionHeading}>Sections</Text>
        <Text style={formStyles.muted}>Order them however the argument reads best. Hidden sections keep their content.</Text>
        {sections.map((section, index) => {
          const values = sectionDrafts[section.id] ?? { title: section.title, body: section.body ?? "" };
          const open = expanded === section.id;
          const samples = section.options?.samples ?? [];
          return (
            <View key={section.id} style={[formStyles.card, styles.sectionCard, !section.visible && styles.hiddenSection]}>
              <View style={styles.sectionTop}>
                <Text style={formStyles.cardLabel}>{KIND_LABELS[section.kind] ?? section.kind}</Text>
                <View style={styles.reorder}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Move ${section.title} up`} disabled={index === 0} style={[styles.iconButton, index === 0 && formStyles.disabled]} onPress={() => move(section, -1)}><Text style={styles.iconText}>↑</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Move ${section.title} down`} disabled={index === sections.length - 1} style={[styles.iconButton, index === sections.length - 1 && formStyles.disabled]} onPress={() => move(section, 1)}><Text style={styles.iconText}>↓</Text></Pressable>
                </View>
              </View>
              <FormField label="Title" value={values.title} onChange={(title) => setSectionDrafts({ ...sectionDrafts, [section.id]: { ...values, title } })} />
              <FormField label={section.source ? "Introduction (optional)" : "Text"} value={values.body} onChange={(body) => setSectionDrafts({ ...sectionDrafts, [section.id]: { ...values, body } })} multiline />
              <SwitchRow label="Show on the page" value={section.visible} onChange={(visible) => patchSection(section, { visible })} />
              <FormActions>
                <Pressable accessibilityRole="button" disabled={busy === `section-${section.id}`} style={[formStyles.secondary, busy === `section-${section.id}` && formStyles.disabled]} onPress={() => saveSection(section)}>
                  {busy === `section-${section.id}` ? <ActivityIndicator color={theme.text} /> : <Text style={formStyles.secondaryText}>Save text</Text>}
                </Pressable>
                {section.source ? (
                  <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} style={formStyles.secondary} onPress={() => { setExpanded(open ? null : section.id); if (!open && section.source) void loadRecords(section.source); }}>
                    <Text style={formStyles.secondaryText}>{open ? "Hide entries" : `Choose entries${section.item_ids.length ? ` (${section.item_ids.length})` : ""}`}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => removeSection(section)}><Text style={formStyles.dangerText}>Remove</Text></Pressable>
              </FormActions>

              {section.kind === "samples" ? (
                <View style={styles.samples}>
                  <Text style={formStyles.muted}>Paste a link to work you have published. YouTube, Vimeo, Loom, CodePen and Figma play on the page; anything else appears as a link.</Text>
                  {samples.map((sample, position) => (
                    <View key={`${sample.url}-${position}`} style={styles.linkRow}>
                      <View style={styles.linkCopy}>
                        <Text style={styles.linkLabel}>{sample.title || sample.url}</Text>
                        <Text style={formStyles.muted}>{sample.provider && sample.provider !== "link" ? sample.provider : "link only"}</Text>
                      </View>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${sample.title || sample.url}`} onPress={() => removeSample(section, position)}><Text style={formStyles.dangerText}>Remove</Text></Pressable>
                    </View>
                  ))}
                  <FormField label="Sample title (optional)" value={sampleDraft.title} onChange={(title) => setSampleDraft({ ...sampleDraft, title })} />
                  <FormField label="Sample link" value={sampleDraft.url} onChange={(url) => setSampleDraft({ ...sampleDraft, url })} placeholder="https://" autoCapitalize="none" keyboardType="url" />
                  <FormActions>
                    <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => addSample(section)}><Text style={formStyles.secondaryText}>Add sample</Text></Pressable>
                  </FormActions>
                </View>
              ) : null}

              {open && section.source ? (
                <View style={styles.picker}>
                  {!records[section.source] ? <ActivityIndicator color={theme.text} /> : null}
                  {(records[section.source] ?? []).map((row) => {
                    const chosen = section.item_ids.length === 0 || section.item_ids.includes(row.id);
                    return <SwitchRow key={row.id} label={describe(row)} value={chosen} onChange={() => toggleItem(section, row.id)} />;
                  })}
                  {records[section.source] && records[section.source].length === 0 ? <Text style={formStyles.muted}>Nothing saved in your record for this yet.</Text> : null}
                </View>
              ) : null}
            </View>
          );
        })}

        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Add a section</Text>
          <View style={styles.kinds}>
            {kinds.filter((kind) => kind.kind === "custom" || !used.has(kind.kind)).map((kind) => (
              <Pressable key={kind.kind} accessibilityRole="button" disabled={busy === `add-${kind.kind}`} style={[styles.kindChip, busy === `add-${kind.kind}` && formStyles.disabled]} onPress={() => addSection(kind.kind)}>
                <Text style={styles.kindText}>+ {KIND_LABELS[kind.kind] ?? kind.kind}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center", padding: 20 },
  content: { padding: 20, paddingBottom: 48 },
  url: { color: theme.accent, fontSize: 13, marginTop: 8 },
  subheading: { color: theme.text, fontSize: 14, fontWeight: "700", marginTop: 16 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 8, marginTop: 8 },
  linkCopy: { flex: 1 },
  linkLabel: { color: theme.text, fontWeight: "600" },
  sectionHeading: { color: theme.text, fontSize: 17, fontWeight: "800", marginTop: 8, marginBottom: 4 },
  sectionCard: { marginTop: 12 },
  hiddenSection: { opacity: 0.7 },
  sectionTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  reorder: { flexDirection: "row", gap: 6 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderColor: theme.border, borderWidth: 1, borderRadius: 8 },
  iconText: { color: theme.text, fontSize: 16, fontWeight: "700" },
  samples: { marginTop: 12, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 12 },
  picker: { marginTop: 12, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 4 },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindChip: { minHeight: 40, justifyContent: "center", borderColor: theme.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 13 },
  kindText: { color: theme.text, fontSize: 13, fontWeight: "600" },
});
