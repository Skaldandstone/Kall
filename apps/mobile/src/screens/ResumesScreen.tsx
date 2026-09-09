import { useCallback, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import { ApiError } from "../api/client";
import {
  deleteResume,
  fetchResumeStudio,
  updateResume,
  uploadResume,
  type Resume,
} from "../api/workspace";
import { theme } from "../theme";

const MAX_RESUME_BYTES = 15 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

export function resumeMimeType(name: string, reported?: string | null) {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  return MIME_BY_EXTENSION[extension] || reported || "application/octet-stream";
}

export default function ResumesScreen() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      setResumes((await fetchResumeStudio()).resumes);
      setMessage("");
    } catch {
      setMessage("Unable to load your resume library.");
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  async function upload() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const selected = result.assets[0];
    if (selected.size != null && selected.size > MAX_RESUME_BYTES) {
      setMessage("This resume is larger than the 15 MB upload limit.");
      return;
    }
    setBusy(true);
    try {
      await uploadResume({
        uri: selected.uri,
        name: selected.name,
        mimeType: resumeMimeType(selected.name, selected.mimeType),
      });
      await load();
      setMessage("Resume uploaded.");
    } catch (e) {
      setMessage(
        e instanceof ApiError ? e.message : "Unable to upload this resume.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function makeDefault(id: number) {
    setBusy(true);
    try {
      await updateResume(id, { is_default: true });
      await load();
      setMessage("Default resume updated.");
    } catch (e) {
      setMessage(
        e instanceof ApiError
          ? e.message
          : "Unable to update the default resume.",
      );
    } finally {
      setBusy(false);
    }
  }
  function confirmDelete(item: Resume) {
    Alert.alert(
      "Delete resume?",
      `Remove ${item.name} from Kall? Existing applications keep their prepared records.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await deleteResume(item.id);
              await load();
              setMessage("Resume deleted.");
            } catch (e) {
              setMessage(
                e instanceof ApiError
                  ? e.message
                  : "Unable to delete this resume.",
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
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
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.title}>Resumes</Text>
      <Text style={styles.subtitle}>
        Upload, review readiness, and choose the resume Kall starts from.
      </Text>
      <Pressable
        accessibilityRole="button"
        style={[styles.button, busy && styles.disabled]}
        disabled={busy}
        onPress={() => void upload()}
      >
        {busy ? (
          <ActivityIndicator color={theme.accentInk} />
        ) : (
          <Text style={styles.buttonText}>Upload resume</Text>
        )}
      </Pressable>
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={
            message.includes("uploaded") || message.includes("updated")
              ? styles.success
              : styles.error
          }
        >
          {message}
        </Text>
      ) : null}
      {!resumes.length ? (
        <View style={styles.empty}>
          <Text style={styles.cardTitle}>No resumes yet</Text>
          <Text style={styles.cardBody}>
            Upload a PDF, DOCX, or TXT file up to 15 MB.
          </Text>
        </View>
      ) : (
        resumes.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text selectable style={styles.cardTitle}>
                {item.name}
              </Text>
              {item.is_default ? (
                <Text style={styles.badge}>Default</Text>
              ) : null}
            </View>
            <Text style={styles.score}>
              {item.readiness.score}% ready · version {item.version}
            </Text>
            <Text style={styles.cardBody}>
              {item.target_titles.length
                ? item.target_titles.join(" · ")
                : "Add target titles on the web or through resume intelligence."}
            </Text>
            <View style={styles.actions}>
              {!item.is_default ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.secondary}
                  disabled={busy}
                  onPress={() => void makeDefault(item.id)}
                >
                  <Text style={styles.secondaryText}>Use by default</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                style={styles.delete}
                disabled={busy}
                onPress={() => confirmDelete(item)}
              >
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingBottom: 50 },
  title: { color: theme.text, fontSize: 24, fontWeight: "700" },
  subtitle: {
    color: theme.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
    marginBottom: 18,
  },
  button: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.accent,
    borderRadius: 10,
    marginBottom: 14,
  },
  buttonText: { color: theme.accentInk, fontWeight: "700" },
  disabled: { opacity: 0.55 },
  success: { color: theme.success, marginBottom: 12 },
  error: { color: theme.danger, marginBottom: 12 },
  empty: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
  },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardTitle: { flex: 1, color: theme.text, fontSize: 16, fontWeight: "700" },
  badge: { color: theme.accent, fontSize: 12, fontWeight: "700" },
  score: { color: theme.textSecondary, marginTop: 8 },
  cardBody: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  secondary: {
    minHeight: 44,
    justifyContent: "center",
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 14,
  },
  secondaryText: { color: theme.text, fontWeight: "700" },
  delete: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10 },
  deleteText: { color: theme.danger, fontWeight: "700" },
});
