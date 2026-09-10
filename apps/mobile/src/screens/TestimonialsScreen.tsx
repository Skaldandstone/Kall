import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import {
  createTestimonialRequest,
  fetchTestimonials,
  moderateTestimonial,
  revokeTestimonialRequest,
  type Testimonial,
  type TestimonialRequest,
} from "../api/testimonials";
import { FormActions, FormField, SelectChips, SwitchRow, formStyles } from "../components/form";
import { testimonialInviteUrl } from "../lib/web";
import { theme } from "../theme";

const REQUEST_TYPES = [
  { value: "testimonial", label: "Testimonial" },
  { value: "reference", label: "Reference" },
];

type Invitation = { request: TestimonialRequest; token: string; revoked: boolean };

const STATUS_LABELS: Record<string, string> = {
  pending_review: "Waiting for your review",
  approved: "Approved",
  rejected: "Not used",
  withdrawn: "Withdrawn by author",
};

export default function TestimonialsScreen() {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ recipient_name: "", recipient_email: "", relationship: "", request_type: "testimonial", personal_message: "" });

  const load = useCallback(async () => {
    try {
      setTestimonials(await fetchTestimonials());
      setMessage("");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to load testimonials.");
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

  function submitRequest() {
    if (!form.recipient_name.trim() || !form.recipient_email.trim() || !form.relationship.trim()) {
      setMessage("Name, email, and relationship are required.");
      return;
    }
    void run("request", async () => {
      const created = await createTestimonialRequest({
        recipient_name: form.recipient_name.trim(),
        recipient_email: form.recipient_email.trim(),
        relationship: form.relationship.trim(),
        request_type: form.request_type,
        personal_message: form.personal_message.trim() || null,
      });
      setInvitations((current) => [{ request: created.request, token: created.invitation_token, revoked: false }, ...current]);
      setForm({ recipient_name: "", recipient_email: "", relationship: "", request_type: "testimonial", personal_message: "" });
      setShowForm(false);
      return "Invitation created. Send the link yourself -- Kall does not email it.";
    }, "Unable to create that invitation.");
  }

  function shareInvitation(invitation: Invitation) {
    const url = testimonialInviteUrl(invitation.token);
    void Share.share({
      title: "Testimonial request",
      message: `${invitation.request.recipient_name}, would you write a short ${invitation.request.request_type} for me? It takes a few minutes: ${url}`,
    }).catch(() => undefined);
  }

  function revoke(invitation: Invitation) {
    void run(`revoke-${invitation.request.id}`, async () => {
      await revokeTestimonialRequest(invitation.request.id);
      setInvitations((current) => current.map((item) => (item.request.id === invitation.request.id ? { ...item, revoked: true } : item)));
      return "Invitation revoked. The link no longer works.";
    }, "Unable to revoke that invitation.");
  }

  function moderate(item: Testimonial, status: "approved" | "rejected", flags?: { include_on_profile: boolean; include_in_applications: boolean }) {
    void run(`item-${item.id}`, async () => {
      const updated = await moderateTestimonial(item.id, {
        status,
        include_on_profile: status === "approved" ? (flags?.include_on_profile ?? item.include_on_profile) : false,
        include_in_applications: status === "approved" ? (flags?.include_in_applications ?? item.include_in_applications) : false,
      });
      setTestimonials((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    }, "Unable to update that testimonial.");
  }

  if (loading) {
    return <View style={[styles.container, styles.centered]}><ActivityIndicator color={theme.text} accessibilityLabel="Loading testimonials" /></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={88}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <Text style={styles.subtitle}>
          Ask someone who knows your work to vouch for it. They write it on a private link; you decide whether it appears on your career page or goes with applications.
        </Text>
        {message ? <Text style={/created|revoked/i.test(message) ? formStyles.success : formStyles.error}>{message}</Text> : null}

        {invitations.map((invitation) => (
          <View key={invitation.request.id} style={[formStyles.card, styles.inviteCard]}>
            <Text style={formStyles.cardLabel}>{invitation.revoked ? "Revoked invitation" : "Invitation ready to send"}</Text>
            <Text style={formStyles.cardTitle}>{invitation.request.recipient_name}</Text>
            <Text style={formStyles.body}>
              {invitation.revoked
                ? "This link no longer works."
                : "Kall shows this link once. Send it now; if you lose it, revoke this invitation and create another. It expires in 30 days."}
            </Text>
            {!invitation.revoked ? (
              <FormActions>
                <Pressable accessibilityRole="button" style={formStyles.primary} onPress={() => shareInvitation(invitation)}>
                  <Text style={formStyles.primaryText}>Send the link</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy === `revoke-${invitation.request.id}`} style={formStyles.secondary} onPress={() => revoke(invitation)}>
                  {busy === `revoke-${invitation.request.id}` ? <ActivityIndicator color={theme.text} /> : <Text style={formStyles.dangerText}>Revoke</Text>}
                </Pressable>
              </FormActions>
            ) : null}
          </View>
        ))}

        {showForm ? (
          <View style={formStyles.card}>
            <Text style={formStyles.cardLabel}>New request</Text>
            <FormField label="Their name *" value={form.recipient_name} onChange={(recipient_name) => setForm({ ...form, recipient_name })} autoCapitalize="words" />
            <FormField label="Their email *" value={form.recipient_email} onChange={(recipient_email) => setForm({ ...form, recipient_email })} autoCapitalize="none" keyboardType="email-address" help="Kept encrypted. Kall does not send the email; you share the link." />
            <FormField label="How you worked together *" value={form.relationship} onChange={(relationship) => setForm({ ...form, relationship })} placeholder="Former manager at Acme" />
            <SelectChips label="Ask for a" value={form.request_type} options={REQUEST_TYPES} onChange={(request_type) => setForm({ ...form, request_type: request_type ?? "testimonial" })} />
            <FormField label="Personal note (optional)" value={form.personal_message} onChange={(personal_message) => setForm({ ...form, personal_message })} multiline />
            <FormActions>
              <Pressable accessibilityRole="button" disabled={busy === "request"} style={[formStyles.primary, busy === "request" && formStyles.disabled]} onPress={submitRequest}>
                {busy === "request" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Create invitation</Text>}
              </Pressable>
              <Pressable accessibilityRole="button" style={formStyles.secondary} onPress={() => setShowForm(false)}><Text style={formStyles.secondaryText}>Cancel</Text></Pressable>
            </FormActions>
          </View>
        ) : (
          <Pressable accessibilityRole="button" style={[formStyles.primary, styles.addButton]} onPress={() => setShowForm(true)}>
            <Text style={formStyles.primaryText}>Ask for a testimonial</Text>
          </Pressable>
        )}

        {testimonials.length === 0 ? (
          <View style={formStyles.card}><Text style={formStyles.body}>Nothing received yet.</Text></View>
        ) : null}
        {testimonials.map((item) => {
          const working = busy === `item-${item.id}`;
          const canShow = item.status === "approved" && item.permission_granted;
          return (
            <View key={item.id} style={formStyles.card}>
              <View style={styles.cardTop}>
                <Text style={[styles.status, item.status === "approved" && styles.statusApproved, (item.status === "rejected" || item.status === "withdrawn") && styles.statusMuted]}>
                  {STATUS_LABELS[item.status] ?? item.status}
                </Text>
                {item.verified_via_request ? <Text style={formStyles.muted}>Verified link</Text> : null}
              </View>
              <Text style={formStyles.cardTitle}>{item.author_name}</Text>
              <Text style={formStyles.muted}>{[item.author_title, item.author_company].filter(Boolean).join(" · ") || item.relationship}</Text>
              <Text style={styles.body}>{item.body}</Text>
              {!item.permission_granted && item.status !== "withdrawn" ? (
                <Text style={formStyles.muted}>The author did not give permission to show this publicly, so it can only be read here.</Text>
              ) : null}
              {item.status !== "withdrawn" ? (
                <>
                  {canShow ? (
                    <>
                      <SwitchRow label="Show on my career page" value={item.include_on_profile} disabled={working} onChange={(on) => moderate(item, "approved", { include_on_profile: on, include_in_applications: item.include_in_applications })} />
                      <SwitchRow label="Available for applications" value={item.include_in_applications} disabled={working} onChange={(on) => moderate(item, "approved", { include_on_profile: item.include_on_profile, include_in_applications: on })} />
                    </>
                  ) : null}
                  <FormActions>
                    {item.status !== "approved" ? (
                      <Pressable accessibilityRole="button" disabled={working} style={[formStyles.primary, working && formStyles.disabled]} onPress={() => moderate(item, "approved")}>
                        {working ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Approve</Text>}
                      </Pressable>
                    ) : null}
                    {item.status !== "rejected" ? (
                      <Pressable accessibilityRole="button" disabled={working} style={[formStyles.secondary, working && formStyles.disabled]} onPress={() => moderate(item, "rejected")}>
                        <Text style={formStyles.dangerText}>Don't use</Text>
                      </Pressable>
                    ) : null}
                  </FormActions>
                </>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 48 },
  subtitle: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  inviteCard: { borderColor: theme.accent },
  addButton: { marginBottom: 14 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  status: { color: theme.accent, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  statusApproved: { color: theme.success },
  statusMuted: { color: theme.textMuted },
  body: { color: theme.text, fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 6 },
});
