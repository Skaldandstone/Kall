import { useCallback, useState } from "react";
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
  saveCareerProfile,
  type CareerProfile,
} from "../api/workspace";
import { theme } from "../theme";

const csv = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const text = (items: string[]) => items.join(", ");
const blank = {
  name: "",
  target_titles: "",
  industries: "",
  countries: "",
  states_regions: "",
  work_types: "remote",
};

export default function CareerProfilesScreen() {
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [editing, setEditing] = useState<CareerProfile | null>(null);
  const [draft, setDraft] = useState(blank);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      setProfiles((await fetchCareerProfiles()).profiles);
      setMessage("");
    } catch {
      setMessage("Unable to load career profiles.");
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  function choose(profile?: CareerProfile) {
    setEditing(profile || null);
    setDraft(
      profile
        ? {
            name: profile.name,
            target_titles: text(profile.target_titles),
            industries: text(profile.industries),
            countries: text(profile.countries),
            states_regions: text(profile.states_regions),
            work_types: text(profile.work_types),
          }
        : blank,
    );
  }
  async function save() {
    if (!draft.name.trim() || !csv(draft.target_titles).length) {
      setMessage("Add a profile name and at least one target title.");
      return;
    }
    const body = {
      name: draft.name.trim(),
      target_titles: csv(draft.target_titles),
      industries: csv(draft.industries),
      countries: csv(draft.countries),
      states_regions: csv(draft.states_regions),
      work_types: csv(draft.work_types),
      ...(editing ? { is_active: editing.is_active } : {}),
    };
    setSaving(true);
    setMessage("");
    try {
      if (editing) await saveCareerProfile(editing.id, body);
      else await createCareerProfile(body);
      await load();
      choose();
      setMessage("Career profile saved.");
    } catch (e) {
      setMessage(
        e instanceof ApiError
          ? e.message
          : "Unable to save this career profile.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <ActivityIndicator
        style={{ flex: 1, backgroundColor: theme.background }}
        color={theme.text}
      />
    );
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.heading}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Career profiles</Text>
          <Text style={styles.subtitle}>
            Define each kind of role Kall should search for.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          style={styles.smallButton}
          onPress={() => choose()}
        >
          <Text style={styles.smallButtonText}>New</Text>
        </Pressable>
      </View>
      {profiles.map((profile) => (
        <Pressable
          accessibilityRole="button"
          key={profile.id}
          style={styles.card}
          onPress={() => choose(profile)}
        >
          <View style={styles.cardTop}>
            <Text style={styles.cardTitle}>{profile.name}</Text>
            <Text style={styles.score}>{profile.completeness.score}%</Text>
          </View>
          <Text style={styles.cardBody}>
            {profile.target_titles.join(" · ") || "No target titles"}
          </Text>
          <Text style={styles.meta}>
            {profile.match_count} matches
            {profile.best_match_score != null
              ? ` · best ${profile.best_match_score}%`
              : ""}
          </Text>
        </Pressable>
      ))}
      <View style={styles.form}>
        <Text style={styles.formTitle}>
          {editing ? `Edit ${editing.name}` : "New career profile"}
        </Text>
        {(
          [
            ["name", "Profile name", "Product leadership"],
            ["target_titles", "Target titles", "Product Director, VP Product"],
            ["industries", "Industries", "SaaS, Climate tech"],
            ["countries", "Countries", "United States"],
            ["states_regions", "States or regions", "Washington, Oregon"],
            ["work_types", "Work types", "remote, hybrid"],
          ] as const
        ).map(([key, label, placeholder]) => (
          <View key={key} style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              style={styles.input}
              value={draft[key]}
              onChangeText={(value) => setDraft({ ...draft, [key]: value })}
              placeholder={placeholder}
              placeholderTextColor={theme.textMuted}
            />
          </View>
        ))}
        {editing ? (
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchTitle}>Active search profile</Text>
              <Text style={styles.switchDetail}>
                Include this direction in search and matching.
              </Text>
            </View>
            <Switch
              value={editing.is_active}
              onValueChange={(value) =>
                setEditing({ ...editing, is_active: value })
              }
              trackColor={{ false: theme.border, true: theme.accent }}
            />
          </View>
        ) : null}
        {message ? (
          <Text
            accessibilityLiveRegion="polite"
            style={message.includes("saved") ? styles.success : styles.error}
          >
            {message}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={[styles.button, saving && styles.disabled]}
          disabled={saving}
          onPress={() => void save()}
        >
          {saving ? (
            <ActivityIndicator color={theme.accentInk} />
          ) : (
            <Text style={styles.buttonText}>
              {editing ? "Save changes" : "Create profile"}
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingBottom: 50 },
  heading: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
  title: { color: theme.text, fontSize: 24, fontWeight: "700" },
  subtitle: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  smallButton: {
    minHeight: 44,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  smallButtonText: { color: theme.text, fontWeight: "700" },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between" },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
  score: { color: theme.accent, fontWeight: "700" },
  cardBody: { color: theme.textSecondary, marginTop: 6 },
  meta: { color: theme.textMuted, fontSize: 12, marginTop: 8 },
  form: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 20,
  },
  formTitle: {
    color: theme.text,
    fontSize: 19,
    fontWeight: "700",
    marginBottom: 16,
  },
  field: { marginBottom: 13 },
  label: {
    color: theme.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  input: {
    minHeight: 48,
    color: theme.text,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    marginTop: 6,
    fontWeight: "400",
  },
  switchRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  switchTitle: { color: theme.text, fontWeight: "700" },
  switchDetail: { color: theme.textSecondary, fontSize: 12, marginTop: 3 },
  button: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.accent,
    borderRadius: 10,
  },
  buttonText: { color: theme.accentInk, fontWeight: "700" },
  disabled: { opacity: 0.55 },
  success: { color: theme.success, marginBottom: 10 },
  error: { color: theme.danger, marginBottom: 10 },
});
