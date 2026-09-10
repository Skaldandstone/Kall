import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useClerk } from "@clerk/expo";
import { ApiError } from "../api/client";
import { deleteAccount, fetchAccount } from "../api/workspace";
import { FormField, formStyles } from "../components/form";
import { theme } from "../theme";

export default function DeleteAccountScreen() {
  const { signOut } = useClerk();
  const [email, setEmail] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchAccount().then((account) => setEmail(account.email)).catch(() => setMessage("Unable to load your account."));
  }, []);

  const matches = email !== null && typed.trim().toLowerCase() === email.toLowerCase();

  async function accountStillExists() {
    try {
      await fetchAccount();
      return true;
    } catch (error) {
      // Only a definite "no such account" counts; a network failure while
      // checking is not evidence that the deletion went through.
      return !(error instanceof ApiError && (error.status === 401 || error.status === 404));
    }
  }

  async function performDeletion() {
    setDeleting(true);
    setMessage("");
    try {
      await deleteAccount(typed.trim());
      await signOut();
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(error.status === 422 ? "That does not match your account email." : error.message);
        setDeleting(false);
        return;
      }
      // Deletion walks every table in one transaction and can outlast the
      // connection. The web client confirmed the account was already gone
      // while its request threw, so ask before declaring failure.
      if (await accountStillExists()) {
        setMessage("Something went wrong. Please try again.");
        setDeleting(false);
        return;
      }
      await signOut();
    }
  }

  function confirmDeletion() {
    Alert.alert(
      "Delete your account?",
      "This permanently removes your resumes, applications, generated documents, career page, and everything else. It cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete permanently", style: "destructive", onPress: () => void performDeletion() },
      ],
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[formStyles.card, styles.dangerCard]}>
        <Text style={formStyles.cardLabel}>This cannot be undone</Text>
        <Text style={formStyles.body}>
          Deleting your account removes everything Kall holds for you: resumes, applications and their documents, career profiles, your public page, testimonials, and billing history. A record that the deletion happened is kept without your details.
        </Text>
        <Text style={[formStyles.body, styles.spaced]}>
          Any paid subscription is cancelled at the end of its current period.
        </Text>
        <FormField
          label={`Type your email${email ? ` (${email})` : ""} to confirm`}
          value={typed}
          onChange={setTyped}
          placeholder={email ?? "you@example.com"}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!deleting}
        />
        {message ? <Text style={[formStyles.error, styles.spaced]}>{message}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !matches || deleting, busy: deleting }}
          disabled={!matches || deleting}
          style={[styles.deleteButton, (!matches || deleting) && formStyles.disabled]}
          onPress={confirmDeletion}
        >
          {deleting ? <ActivityIndicator color={theme.text} /> : <Text style={styles.deleteButtonText}>Permanently delete my account</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingBottom: 48 },
  dangerCard: { borderColor: theme.danger },
  spaced: { marginTop: 10 },
  deleteButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderColor: theme.danger, borderWidth: 1, borderRadius: 10, marginTop: 16 },
  deleteButtonText: { color: theme.danger, fontWeight: "700" },
});
