import { useEffect, useState } from "react";
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
import { ApiError } from "../api/client";
import {
  fetchNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "../api/workspace";
import { theme } from "../theme";

export default function NotificationsScreen() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetchNotificationPreferences()
      // The server serializes times as HH:MM:SS; the inputs work in HH:MM.
      .then((loaded) => setPrefs({
        ...loaded,
        quiet_hours_start: loaded.quiet_hours_start ? loaded.quiet_hours_start.slice(0, 5) : null,
        quiet_hours_end: loaded.quiet_hours_end ? loaded.quiet_hours_end.slice(0, 5) : null,
      }))
      .catch(() => setMessage("Unable to load notification settings."));
  }, []);
  async function save() {
    if (!prefs) return;
    const quietOn = prefs.quiet_hours_start !== null || prefs.quiet_hours_end !== null;
    if (quietOn && (!/^\d{2}:\d{2}$/.test(prefs.quiet_hours_start ?? "") || !/^\d{2}:\d{2}$/.test(prefs.quiet_hours_end ?? ""))) {
      setMessage("Quiet hours need both a start and an end, written as HH:MM.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      setPrefs(
        await saveNotificationPreferences({
          ...prefs,
          digest_hour_local: Math.max(0, Math.min(23, prefs.digest_hour_local)),
          minimum_match_score: Math.max(
            0,
            Math.min(100, prefs.minimum_match_score),
          ),
        }),
      );
      setMessage("Preferences saved.");
    } catch (e) {
      setMessage(
        e instanceof ApiError
          ? e.message
          : "Unable to save notification settings.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!prefs)
    return (
      <View style={styles.loading}>
        {message ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {message}
          </Text>
        ) : (
          <ActivityIndicator color={theme.text} />
        )}
      </View>
    );
  const set = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) => setPrefs({ ...prefs, [key]: value });
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.title}>Notifications</Text>
      <Text style={styles.subtitle}>Choose what Kall emails you and when.</Text>
      {prefs.email_provider_status === "unconfigured" ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          Email delivery is not configured. These preferences will still be
          saved.
        </Text>
      ) : null}
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Email briefs and alerts</Text>
            <Text style={styles.rowDetail}>
              Morning Brief plus matching opportunities.
            </Text>
          </View>
          <Switch
            value={prefs.email_enabled}
            onValueChange={(v) => set("email_enabled", v)}
            trackColor={{ false: theme.border, true: theme.accent }}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Delivery</Text>
          <TextInput
            accessibilityLabel="Delivery hour"
            keyboardType="number-pad"
            style={styles.input}
            value={String(prefs.digest_hour_local)}
            onChangeText={(v) => set("digest_hour_local", Number(v) || 0)}
          />
        </View>
        <Text style={styles.hint}>Hour from 0 to 23 in your time zone.</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Time zone</Text>
          <TextInput
            accessibilityLabel="Time zone"
            autoCapitalize="none"
            style={styles.input}
            value={prefs.timezone}
            onChangeText={(v) => set("timezone", v)}
            placeholder="America/Los_Angeles"
            placeholderTextColor={theme.textMuted}
          />
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.rowTitle}>Opportunity alerts</Text>
        <View style={styles.segment}>
          <Pressable
            accessibilityRole="button"
            style={[
              styles.segmentButton,
              prefs.delivery_mode === "digest" && styles.segmentActive,
            ]}
            onPress={() => set("delivery_mode", "digest")}
          >
            <Text
              style={
                prefs.delivery_mode === "digest"
                  ? styles.segmentActiveText
                  : styles.segmentText
              }
            >
              Daily digest
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[
              styles.segmentButton,
              prefs.delivery_mode === "immediate" && styles.segmentActive,
            ]}
            onPress={() => set("delivery_mode", "immediate")}
          >
            <Text
              style={
                prefs.delivery_mode === "immediate"
                  ? styles.segmentActiveText
                  : styles.segmentText
              }
            >
              Soon after match
            </Text>
          </Pressable>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Minimum match score</Text>
          <TextInput
            accessibilityLabel="Minimum match score"
            keyboardType="number-pad"
            style={styles.input}
            value={String(prefs.minimum_match_score)}
            onChangeText={(v) => set("minimum_match_score", Number(v) || 0)}
          />
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Quiet hours</Text>
            <Text style={styles.rowDetail}>
              Hold immediate alerts until the morning. Digests are unaffected.
            </Text>
          </View>
          <Switch
            value={prefs.quiet_hours_start !== null}
            onValueChange={(on) =>
              setPrefs({
                ...prefs,
                quiet_hours_start: on ? prefs.quiet_hours_start ?? "22:00" : null,
                quiet_hours_end: on ? prefs.quiet_hours_end ?? "07:00" : null,
              })
            }
            trackColor={{ false: theme.border, true: theme.accent }}
          />
        </View>
        {prefs.quiet_hours_start !== null ? (
          <View style={styles.quietRow}>
            <View style={styles.quietField}>
              <Text style={styles.label}>From</Text>
              <TextInput
                accessibilityLabel="Quiet hours start"
                style={styles.input}
                value={(prefs.quiet_hours_start ?? "").slice(0, 5)}
                onChangeText={(v) => set("quiet_hours_start", v)}
                placeholder="22:00"
                placeholderTextColor={theme.textMuted}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={styles.quietField}>
              <Text style={styles.label}>Until</Text>
              <TextInput
                accessibilityLabel="Quiet hours end"
                style={styles.input}
                value={(prefs.quiet_hours_end ?? "").slice(0, 5)}
                onChangeText={(v) => set("quiet_hours_end", v)}
                placeholder="07:00"
                placeholderTextColor={theme.textMuted}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
        ) : null}
      </View>
      <View style={[styles.switchRow, styles.disabledRow]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Push notifications</Text>
          <Text style={styles.rowDetail}>
            Coming after mobile push credentials are enabled.
          </Text>
        </View>
        <Switch disabled value={false} />
      </View>
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
          <Text style={styles.buttonText}>Save preferences</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: theme.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingBottom: 50 },
  title: { color: theme.text, fontSize: 24, fontWeight: "700" },
  subtitle: { color: theme.textSecondary, marginTop: 5, marginBottom: 18 },
  notice: {
    color: theme.warning,
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    lineHeight: 19,
  },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  switchRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
  rowDetail: {
    color: theme.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  field: { marginTop: 15 },
  label: {
    color: theme.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  input: {
    minHeight: 48,
    color: theme.text,
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    marginTop: 6,
  },
  hint: { color: theme.textMuted, fontSize: 11, marginTop: 5 },
  quietRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  quietField: { flex: 1 },
  segment: { flexDirection: "row", gap: 8, marginTop: 14 },
  segmentButton: {
    flex: 1,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 6,
  },
  segmentActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  segmentText: { color: theme.textSecondary, fontWeight: "700", fontSize: 12 },
  segmentActiveText: {
    color: theme.accentInk,
    fontWeight: "700",
    fontSize: 12,
  },
  disabledRow: { opacity: 0.55, marginBottom: 12 },
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
