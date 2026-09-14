import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import { createSharedSearch, fetchSharedSearches, revokeSharedSearch, type SharedSearch } from "../api/sharedSearch";
import { FormActions, FormField, formStyles } from "../components/form";
import { sharedSearchUrl } from "../lib/web";
import { theme } from "../theme";

/** Help a friend find a job: share a batch of matching openings with someone
 * who may have no Kall account -- neither the owner nor Kall ever applies on
 * their behalf, the public page only ever links out to the real posting. */
export default function SharedSearchesScreen() {
  const [shares, setShares] = useState<SharedSearch[] | null>(null);
  const [titles, setTitles] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setShares(await fetchSharedSearches());
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to load your shares.");
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function create(payload: Parameters<typeof createSharedSearch>[0]) {
    setBusy("create");
    setMessage("");
    try {
      await createSharedSearch(payload);
      setTitles("");
      setLabel("");
      await load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to create that share.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: number) {
    setBusy(`revoke-${id}`);
    try {
      await revokeSharedSearch(id);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const active = (shares ?? []).filter((share) => share.status !== "revoked");

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {message ? <Text style={formStyles.error}>{message}</Text> : null}

      <View style={formStyles.card}>
        <Text style={formStyles.cardLabel}>Fill in a quick profile for them</Text>
        <Text style={formStyles.body}>You know roughly what they want -- enter a few basics and get a link right away.</Text>
        <FormField label="Job titles (comma separated)" value={titles} onChange={setTitles} placeholder="Retail Associate, Store Manager" />
        <FormField label="Friend's name (optional, just for your own list)" value={label} onChange={setLabel} />
        <FormActions>
          <Pressable
            accessibilityRole="button"
            disabled={busy === "create" || !titles.trim()}
            style={[formStyles.primary, (busy === "create" || !titles.trim()) && formStyles.disabled]}
            onPress={() => void create({ criteria: { target_titles: titles.split(",").map((t) => t.trim()).filter(Boolean) }, friend_label: label || null })}
          >
            {busy === "create" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Create share</Text>}
          </Pressable>
        </FormActions>
      </View>

      <View style={formStyles.card}>
        <Text style={formStyles.cardLabel}>Send them a link to fill it in themselves</Text>
        <Text style={formStyles.body}>No Kall account needed -- they answer a short form and get their own matches.</Text>
        <FormActions>
          <Pressable accessibilityRole="button" disabled={busy === "create"} style={formStyles.secondary} onPress={() => void create({ mode: "invite", friend_label: label || null })}>
            <Text style={formStyles.secondaryText}>Create invite link</Text>
          </Pressable>
        </FormActions>
      </View>

      <View style={formStyles.card}>
        <Text style={formStyles.cardLabel}>Your shares</Text>
        {shares === null ? <ActivityIndicator /> : active.length === 0 ? (
          <Text style={formStyles.body}>Nothing shared yet.</Text>
        ) : (
          active.map((share) => (
            <View key={share.id} style={styles.row}>
              <View style={styles.rowCopy}>
                <Text style={formStyles.body}>{share.friend_label || "Untitled share"}</Text>
                <Text style={formStyles.muted}>{share.status === "awaiting_input" ? "waiting on their answers" : "active"}</Text>
              </View>
              <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => void Share.share({ message: sharedSearchUrl(share.slug) }).catch(() => undefined)}>
                <Text style={formStyles.secondaryText}>Share link</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy === `revoke-${share.id}`} onPress={() => void revoke(share.id)}>
                <Text style={formStyles.dangerText}>Revoke</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 16, gap: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  rowCopy: { flex: 1 },
});
