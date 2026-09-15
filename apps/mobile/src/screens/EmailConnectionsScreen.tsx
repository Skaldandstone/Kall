import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import {
  authorizeEmailConnection,
  disconnectEmailConnection,
  fetchEmailConnections,
  type EmailConnection,
} from "../api/emailConnections";
import { formStyles } from "../components/form";
import { theme } from "../theme";

const PROVIDERS: Array<{ key: "gmail" | "outlook"; label: string }> = [
  { key: "gmail", label: "Gmail" },
  { key: "outlook", label: "Outlook" },
];

/** Auto-detect application status from a connected mailbox (read-only --
 * Kall can never send, delete, or modify anything). Tapping Connect opens
 * the provider's own consent screen in the system browser; the callback
 * that finishes the connection authenticates on a signed state value, not
 * a session, since the browser that lands on it shares nothing with this
 * app (see api_email_connections.py's _user_id_from_state). */
export default function EmailConnectionsScreen() {
  const [connections, setConnections] = useState<EmailConnection[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setConnections(await fetchEmailConnections());
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to load your connections.");
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function connect(provider: "gmail" | "outlook") {
    setBusy(provider);
    setMessage("");
    try {
      const { authorize_url } = await authorizeEmailConnection(provider);
      await Linking.openURL(authorize_url);
    } catch (error) {
      setMessage(
        error instanceof ApiError && error.status === 503
          ? `${provider === "gmail" ? "Gmail" : "Outlook"} connection isn't available yet.`
          : "Unable to start that connection.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(id: number) {
    setBusy(`disconnect-${id}`);
    try {
      await disconnectEmailConnection(id);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {message ? <Text style={formStyles.error}>{message}</Text> : null}
      {connections === null ? (
        <ActivityIndicator />
      ) : (
        PROVIDERS.map((provider) => {
          const existing = connections.find((c) => c.provider === provider.key);
          return (
            <View style={formStyles.card} key={provider.key}>
              <Text style={formStyles.cardLabel}>{provider.label}</Text>
              {existing ? (
                <>
                  <Text style={formStyles.body}>
                    {existing.status === "connected" ? "Connected" : existing.status === "needs_reauth" ? "Needs reconnecting" : existing.status}
                    {existing.last_synced_at ? ` · last synced ${new Date(existing.last_synced_at).toLocaleString()}` : " · not synced yet"}
                  </Text>
                  {existing.last_error ? <Text style={formStyles.error}>{existing.last_error}</Text> : null}
                  <Pressable accessibilityRole="button" disabled={busy === `disconnect-${existing.id}`} style={formStyles.secondary} onPress={() => void disconnect(existing.id)}>
                    <Text style={formStyles.secondaryText}>Disconnect</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={formStyles.body}>Kall will only ever read mail -- never send, delete, or change anything.</Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy === provider.key}
                    style={[formStyles.primary, busy === provider.key && formStyles.disabled]}
                    onPress={() => void connect(provider.key)}
                  >
                    {busy === provider.key ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Connect {provider.label}</Text>}
                  </Pressable>
                </>
              )}
            </View>
          );
        })
      )}
      <View style={formStyles.card}>
        <Text style={formStyles.cardLabel}>Pre-tag job mail (optional)</Text>
        <Text style={formStyles.body}>
          For Gmail, download a filter file from Kall's web settings (Settings → Email) and import it from Gmail's own
          Settings → Filters and Blocked Addresses. For Outlook, create a rule that applies a category named "Kall Job
          Search" to mail from your job boards and employers. Either way, this is entirely optional -- Kall works
          without it, just with a coarser first pass.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 16, gap: 16 },
});
