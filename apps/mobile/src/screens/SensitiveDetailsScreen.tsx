import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import { fetchPrivacyRules, fetchReadiness, saveEeo, savePrivacyRule, saveWorkAuthorization, type PrivacyRule } from "../api/record";
import { fetchIdentity, saveIdentity } from "../api/workspace";
import { FormActions, FormField, SwitchRow, formStyles } from "../components/form";
import { theme } from "../theme";

const AUTOFILL_FIELDS = [
  { path: "identity.phone", label: "Phone number" },
  { path: "identity.address", label: "Street address" },
  { path: "identity.postal_code", label: "Postal code" },
] as const;

const blankOrNull = (value: string) => (value.trim() ? value.trim() : null);

export default function SensitiveDetailsScreen() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [rules, setRules] = useState<PrivacyRule[]>([]);
  const [workAuthOnFile, setWorkAuthOnFile] = useState(false);
  const [contact, setContact] = useState({ phone: "", address: "", postal_code: "" });
  const [work, setWork] = useState({ country: "", authorization_type: "", citizenship_status: "", visa_type: "", requires_current_sponsorship: false, requires_future_sponsorship: false });
  const [eeo, setEeo] = useState({ veteran_status: "", disability_status: "", race_ethnicity: "", gender_identity: "", decline_to_answer_defaults: true });

  const load = useCallback(async () => {
    try {
      const [privacy, identity, readiness] = await Promise.all([
        fetchPrivacyRules().catch(() => [] as PrivacyRule[]),
        fetchIdentity().catch(() => null),
        fetchReadiness().catch(() => null),
      ]);
      setRules(privacy);
      if (identity?.country) setWork((current) => ({ ...current, country: current.country || identity.country || "" }));
      setWorkAuthOnFile(Boolean(readiness && readiness.sections.work_authorization === 100));
      setMessage("");
    } catch {
      setMessage("Unable to load your privacy settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const autofillOn = (path: string) => rules.some((rule) => rule.field_path === path && rule.scopes.includes("autofill"));

  async function run(key: string, task: () => Promise<string>) {
    setBusy(key);
    setMessage("");
    try {
      setMessage(await task());
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unable to save that.");
    } finally {
      setBusy(null);
    }
  }

  function saveContact() {
    const body = Object.fromEntries(Object.entries(contact).filter(([, value]) => value.trim())) as { phone?: string; address?: string; postal_code?: string };
    if (!Object.keys(body).length) {
      setMessage("Enter at least one contact detail to save.");
      return;
    }
    void run("contact", async () => {
      await saveIdentity(body);
      setContact({ phone: "", address: "", postal_code: "" });
      return "Contact details saved and encrypted.";
    });
  }

  function toggleAutofill(path: string, on: boolean) {
    void run(`privacy-${path}`, async () => {
      const saved = await savePrivacyRule(path, on ? ["autofill"] : ["private"]);
      setRules((current) => [...current.filter((rule) => rule.field_path !== path), saved]);
      return on ? "Kall may pre-fill that field on applications you approve." : "That field stays private.";
    });
  }

  function saveWork() {
    if (!work.country.trim() || !work.authorization_type.trim()) {
      setMessage("Country and authorization type are required.");
      return;
    }
    void run("work", async () => {
      await saveWorkAuthorization({
        country: work.country.trim(),
        authorization_type: work.authorization_type.trim(),
        citizenship_status: blankOrNull(work.citizenship_status),
        visa_type: blankOrNull(work.visa_type),
        requires_current_sponsorship: work.requires_current_sponsorship,
        requires_future_sponsorship: work.requires_future_sponsorship,
      });
      setWorkAuthOnFile(true);
      setWork((current) => ({ ...current, citizenship_status: "", visa_type: "" }));
      return "Work authorization saved and encrypted.";
    });
  }

  function saveSelfIdentification() {
    void run("eeo", async () => {
      await saveEeo({
        veteran_status: blankOrNull(eeo.veteran_status),
        disability_status: blankOrNull(eeo.disability_status),
        race_ethnicity: blankOrNull(eeo.race_ethnicity),
        gender_identity: blankOrNull(eeo.gender_identity),
        decline_to_answer_defaults: eeo.decline_to_answer_defaults,
      });
      setEeo((current) => ({ ...current, veteran_status: "", disability_status: "", race_ethnicity: "", gender_identity: "" }));
      return "Self-identification saved and encrypted.";
    });
  }

  if (loading) {
    return <View style={[styles.container, styles.centered]}><ActivityIndicator color={theme.text} accessibilityLabel="Loading sensitive details" /></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={88}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <Text style={styles.subtitle}>
          Everything on this screen is encrypted at rest and never shown back, not even to you. It is only used to pre-fill an application you approve, and each use asks you first.
        </Text>
        {message ? <Text style={message.includes("saved") || message.includes("may") || message.includes("stays") ? formStyles.success : formStyles.error}>{message}</Text> : null}

        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Contact details for autofill</Text>
          <Text style={formStyles.body}>Employer forms usually ask for these. Kall only fills them where you switch autofill on below.</Text>
          <FormField label="Phone number" value={contact.phone} onChange={(phone) => setContact({ ...contact, phone })} keyboardType="phone-pad" autoCapitalize="none" />
          <FormField label="Street address" value={contact.address} onChange={(address) => setContact({ ...contact, address })} />
          <FormField label="Postal code" value={contact.postal_code} onChange={(postal_code) => setContact({ ...contact, postal_code })} autoCapitalize="characters" />
          <FormActions>
            <Pressable accessibilityRole="button" disabled={busy === "contact"} style={[formStyles.primary, busy === "contact" && formStyles.disabled]} onPress={saveContact}>
              {busy === "contact" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Save contact details</Text>}
            </Pressable>
          </FormActions>
          {AUTOFILL_FIELDS.map((field) => (
            <SwitchRow
              key={field.path}
              label={`Pre-fill ${field.label.toLowerCase()}`}
              detail={autofillOn(field.path) ? "Included in the autofill pack." : "Left for you to type on the form."}
              value={autofillOn(field.path)}
              disabled={busy === `privacy-${field.path}`}
              onChange={(on) => toggleAutofill(field.path, on)}
            />
          ))}
        </View>

        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Work authorization</Text>
          <Text style={formStyles.body}>{workAuthOnFile ? "On file. Saving again replaces it for the same country." : "Nothing on file yet."} Always confirmed by you before it is used.</Text>
          <FormField label="Country *" value={work.country} onChange={(country) => setWork({ ...work, country })} autoCapitalize="words" />
          <FormField label="Authorization type *" value={work.authorization_type} onChange={(authorization_type) => setWork({ ...work, authorization_type })} placeholder="Citizen, permanent resident, work permit" />
          <FormField label="Citizenship status" value={work.citizenship_status} onChange={(citizenship_status) => setWork({ ...work, citizenship_status })} />
          <FormField label="Visa type" value={work.visa_type} onChange={(visa_type) => setWork({ ...work, visa_type })} autoCapitalize="characters" />
          <SwitchRow label="Needs sponsorship now" value={work.requires_current_sponsorship} onChange={(requires_current_sponsorship) => setWork({ ...work, requires_current_sponsorship })} />
          <SwitchRow label="Will need sponsorship in future" value={work.requires_future_sponsorship} onChange={(requires_future_sponsorship) => setWork({ ...work, requires_future_sponsorship })} />
          <FormActions>
            <Pressable accessibilityRole="button" disabled={busy === "work"} style={[formStyles.primary, busy === "work" && formStyles.disabled]} onPress={saveWork}>
              {busy === "work" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Save work authorization</Text>}
            </Pressable>
          </FormActions>
        </View>

        <View style={formStyles.card}>
          <Text style={formStyles.cardLabel}>Voluntary self-identification</Text>
          <Text style={formStyles.body}>Optional. Employers ask these for equal-opportunity reporting. Leave anything blank to decline.</Text>
          <FormField label="Veteran status" value={eeo.veteran_status} onChange={(veteran_status) => setEeo({ ...eeo, veteran_status })} />
          <FormField label="Disability status" value={eeo.disability_status} onChange={(disability_status) => setEeo({ ...eeo, disability_status })} />
          <FormField label="Race or ethnicity" value={eeo.race_ethnicity} onChange={(race_ethnicity) => setEeo({ ...eeo, race_ethnicity })} />
          <FormField label="Gender identity" value={eeo.gender_identity} onChange={(gender_identity) => setEeo({ ...eeo, gender_identity })} />
          <SwitchRow label="Decline to answer by default" detail="Kall leaves these blank on forms unless you switch them on for that application." value={eeo.decline_to_answer_defaults} onChange={(decline_to_answer_defaults) => setEeo({ ...eeo, decline_to_answer_defaults })} />
          <FormActions>
            <Pressable accessibilityRole="button" disabled={busy === "eeo"} style={[formStyles.primary, busy === "eeo" && formStyles.disabled]} onPress={saveSelfIdentification}>
              {busy === "eeo" ? <ActivityIndicator color={theme.accentInk} /> : <Text style={formStyles.primaryText}>Save self-identification</Text>}
            </Pressable>
          </FormActions>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 48 },
  subtitle: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 14 },
});
