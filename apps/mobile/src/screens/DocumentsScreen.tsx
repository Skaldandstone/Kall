import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import { RESUME_TEMPLATES, downloadDocument, listDocuments, type ArtifactFormat, type DocumentSummary } from "../api/tailoring";
import { FormActions, formStyles } from "../components/form";
import { safeFileName, saveAndShare } from "../lib/files";
import { theme } from "../theme";

const FORMATS: Array<{ format: ArtifactFormat; mime: string; uti: string }> = [
  { format: "pdf", mime: "application/pdf", uti: "com.adobe.pdf" },
  { format: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", uti: "org.openxmlformats.wordprocessingml.document" },
  { format: "txt", mime: "text/plain", uti: "public.plain-text" },
];

function formatWhen(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function DocumentsScreen() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setDocuments(await listDocuments());
      setMessage("");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to load your documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function share(document: DocumentSummary, entry: (typeof FORMATS)[number]) {
    setBusy(`${document.id}-${entry.format}`);
    setMessage("");
    try {
      const { bytes, mimeType } = await downloadDocument(document.id, entry.format);
      const name = `kall-${document.document_type}-${safeFileName(document.company || String(document.id))}.${entry.format}`;
      await saveAndShare(bytes, name, mimeType || entry.mime, entry.uti);
    } catch (error) {
      setMessage(error instanceof ApiError || error instanceof Error ? error.message : "Unable to fetch that file.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <View style={[styles.container, styles.centered]}><ActivityIndicator color={theme.text} accessibilityLabel="Loading documents" /></View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>Every resume Kall has generated from a reviewed tailoring proposal. Files are rendered on demand and kept for a year; the text is kept indefinitely.</Text>
      {message ? <Text style={formStyles.error}>{message}</Text> : null}
      {documents.length === 0 ? (
        <View style={formStyles.card}>
          <Text style={formStyles.body}>Nothing generated yet. Prepare an application, review its tailored resume, and generate the files from there.</Text>
        </View>
      ) : null}
      {documents.map((document) => (
        <View key={document.id} style={formStyles.card}>
          <Text style={formStyles.cardLabel}>{document.document_type.replace(/_/g, " ")} · {formatWhen(document.created_at)}</Text>
          <Text style={formStyles.cardTitle}>{document.title || "Untitled role"}</Text>
          <Text style={formStyles.body}>
            {document.company || "Unknown company"} · {RESUME_TEMPLATES.find((template) => template.key === document.template_key)?.label ?? document.template_key}
          </Text>
          <FormActions>
            {FORMATS.map((entry) => (
              <Pressable
                key={entry.format}
                accessibilityRole="button"
                accessibilityHint="Downloads the file and opens the share sheet to save or send it"
                disabled={busy === `${document.id}-${entry.format}`}
                style={[formStyles.secondary, busy === `${document.id}-${entry.format}` && formStyles.disabled]}
                onPress={() => void share(document, entry)}
              >
                {busy === `${document.id}-${entry.format}` ? <ActivityIndicator color={theme.text} /> : <Text style={formStyles.secondaryText}>Save {entry.format.toUpperCase()}</Text>}
              </Pressable>
            ))}
          </FormActions>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 48 },
  subtitle: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 14 },
});
