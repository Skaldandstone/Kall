import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ApiError } from "../api/client";
import { fetchIdentity, saveIdentity, type Identity } from "../api/workspace";
import { theme } from "../theme";

const fields: Array<{
  key: keyof Identity;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  {
    key: "preferred_name",
    label: "Preferred name",
    placeholder: "How Kall should address you",
  },
  { key: "city", label: "City", placeholder: "Seattle" },
  { key: "state_region", label: "State or region", placeholder: "Washington" },
  { key: "country", label: "Country", placeholder: "United States" },
  { key: "timezone", label: "Time zone", placeholder: "America/Los_Angeles" },
  {
    key: "linkedin_url",
    label: "LinkedIn",
    placeholder: "https://linkedin.com/in/...",
  },
  { key: "github_url", label: "GitHub", placeholder: "https://github.com/..." },
  {
    key: "professional_summary",
    label: "Professional summary",
    placeholder: "What you do and where you want to go",
    multiline: true,
  },
];
export default function IdentityScreen() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetchIdentity()
      .then(setIdentity)
      .catch(() => setMessage("Unable to load your personal details."));
  }, []);
  async function save() {
    if (!identity) return;
    setSaving(true);
    setMessage("");
    try {
      setIdentity(await saveIdentity(identity));
      setMessage("Saved.");
    } catch (e) {
      setMessage(
        e instanceof ApiError ? e.message : "Unable to save your details.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!identity)
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
      <Text style={styles.title}>Personal details</Text>
      <Text selectable style={styles.email}>
        {identity.email}
      </Text>
      {fields.map((field) => (
        <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          <TextInput
            accessibilityLabel={field.label}
            style={[styles.input, field.multiline && styles.multiline]}
            placeholder={field.placeholder}
            placeholderTextColor={theme.textMuted}
            multiline={field.multiline}
            value={String(identity[field.key] || "")}
            onChangeText={(value) =>
              setIdentity({ ...identity, [field.key]: value || null })
            }
          />
        </View>
      ))}
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={message === "Saved." ? styles.success : styles.error}
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
          <Text style={styles.buttonText}>Save details</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingBottom: 40 },
  title: {
    color: theme.text,
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  email: { color: theme.textSecondary, marginBottom: 20 },
  field: { marginBottom: 14 },
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
    paddingVertical: 12,
    fontWeight: "400",
    marginTop: 6,
  },
  multiline: { minHeight: 112, textAlignVertical: "top" },
  button: {
    minHeight: 50,
    backgroundColor: theme.accent,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonText: { color: theme.accentInk, fontWeight: "700" },
  disabled: { opacity: 0.55 },
  success: { color: theme.success, marginBottom: 10 },
  error: { color: theme.danger, marginBottom: 10 },
});
