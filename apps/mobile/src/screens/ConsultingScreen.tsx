import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import {
  approveConsultingFollowUp,
  approveConsultingProposal,
  completeConsultingFollowUp,
  createConsultingEngagement,
  createConsultingFollowUp,
  createConsultingLead,
  createConsultingProposal,
  fetchConsultingDiscoveryPlan,
  fetchConsultingWorkspace,
  updateConsultingEngagement,
  updateConsultingLead,
  type ConsultingDiscoveryPlan,
  type ConsultingLead,
  type ConsultingWorkspace,
} from "../api/consulting";
import { ApiError } from "../api/client";
import { fetchCareerProfiles, type CareerProfile } from "../api/opportunities";
import OpportunityTrackSwitch from "../components/OpportunityTrackSwitch";
import type { OpportunitiesStackParamList } from "../navigation/types";
import { theme } from "../theme";
import { PageHeader } from "../components/ui";

type Props = NativeStackScreenProps<OpportunitiesStackParamList, "Consulting">;
type Editor = "lead" | "proposal" | "follow-up" | "engagement";
type LeadPrefill = {
  organization?: string;
  title?: string;
  details?: string;
  segment?: string;
  source?: string;
};

const EMPTY: ConsultingWorkspace = {
  leads: [],
  proposals: [],
  follow_ups: [],
  engagements: [],
};
const WARM = new Set([
  "warm_contact",
  "former_colleague",
  "past_client",
  "referral",
  "community",
]);
const SEGMENTS = [
  "warm_contact",
  "former_colleague",
  "past_client",
  "referral",
  "community",
  "inbound",
  "marketplace",
  "cold",
];
const STAGES = [
  "identified",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
  "paused",
];

function label(value: string) {
  return value.replaceAll("_", " ");
}
function money(cents: number | null) {
  return cents === null
    ? "Value not set"
    : `$${Math.round(cents / 100).toLocaleString()}`;
}

export default function ConsultingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [workspace, setWorkspace] = useState(EMPTY);
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [discovery, setDiscovery] = useState<ConsultingDiscoveryPlan | null>(null);
  const [focus, setFocus] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"all" | "warm">("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [leadId, setLeadId] = useState<number | null>(null);
  const [organization, setOrganization] = useState("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [fee, setFee] = useState("");
  const [segment, setSegment] = useState("warm_contact");
  const [source, setSource] = useState("");
  const [dueOn, setDueOn] = useState(new Date().toISOString().slice(0, 10));
  const [vaettir, setVaettir] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextWorkspace, profileResponse] = await Promise.all([
        fetchConsultingWorkspace(),
        fetchCareerProfiles(),
      ]);
      setWorkspace(nextWorkspace);
      setProfiles(profileResponse.profiles);
      setProfileId((current) => current ?? profileResponse.profiles[0]?.id ?? null);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Unable to load consulting records.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const leads = useMemo(
    () =>
      workspace.leads.filter(
        (lead) => filter === "all" || WARM.has(lead.relationship_segment),
      ),
    [filter, workspace.leads],
  );
  const leadNames = useMemo(
    () =>
      new Map(
        workspace.leads.map((lead) => [
          lead.id,
          `${lead.organization}: ${lead.opportunity_name}`,
        ]),
      ),
    [workspace.leads],
  );

  function openEditor(next: Editor, selected?: number, prefill: LeadPrefill = {}) {
    setEditor(next);
    setLeadId(selected ?? workspace.leads[0]?.id ?? null);
    setOrganization(prefill.organization ?? "");
    setTitle(prefill.title ?? "");
    setDetails(prefill.details ?? "");
    setFee("");
    setSegment(prefill.segment ?? "warm_contact");
    setSource(prefill.source ?? "");
    setVaettir(false);
  }

  async function action(work: () => Promise<unknown>, success: string) {
    try {
      setMessage("Saving…");
      await work();
      await load();
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Kall could not save that change.",
      );
    }
  }

  async function discoverLeads() {
    if (!profileId) {
      setMessage("Create a professional profile before asking Kall to find leads.");
      return;
    }
    setDiscovering(true);
    try {
      setDiscovery(await fetchConsultingDiscoveryPlan(profileId, focus));
      setMessage("Kall prepared public searches and qualification questions for this direction.");
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Kall could not prepare consulting searches.",
      );
    } finally {
      setDiscovering(false);
    }
  }

  async function saveEditor() {
    if (
      !title.trim() ||
      (["lead", "engagement"].includes(editor || "") && !organization.trim()) ||
      (editor === "proposal" && !details.trim()) ||
      (editor !== "lead" && editor !== "engagement" && !leadId)
    ) {
      setMessage("Complete the required fields first.");
      return;
    }
    await action(async () => {
      const fee_cents = fee ? Math.round(Number(fee) * 100) : null;
      if (editor === "lead") {
        await createConsultingLead({
          organization,
          opportunity_name: title,
          relationship_segment: segment,
          source: source || null,
          projected_value_cents: fee_cents,
          next_step: details || null,
        });
      }
      if (editor === "proposal") {
        await createConsultingProposal({
          lead_id: leadId,
          title,
          summary: details || null,
          deliverables: details ? [details] : ["Scope review"],
          fee_cents,
        });
      }
      if (editor === "follow-up") {
        await createConsultingFollowUp({
          lead_id: leadId,
          due_on: dueOn,
          channel: "email",
          purpose: title,
          draft_message: details || null,
        });
      }
      if (editor === "engagement") {
        await createConsultingEngagement({
          lead_id: leadId,
          client_name: organization,
          name: title,
          status: "planned",
          fee_cents,
          design_partner_product: vaettir ? "vaettir" : null,
          design_partner_stage: vaettir ? "discovery" : null,
        });
      }
      setEditor(null);
    }, `${editor === "follow-up" ? "Follow-up" : "Record"} saved.`);
  }

  async function advanceLead(lead: ConsultingLead) {
    const current = STAGES.indexOf(lead.stage);
    const stage = STAGES[Math.min(current + 1, 4)];
    await action(
      () => updateConsultingLead(lead.id, { stage }),
      `Lead moved to ${label(stage)}.`,
    );
  }

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator
          color={theme.text}
          accessibilityLabel="Loading consulting workspace"
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <OpportunityTrackSwitch
        active="consulting"
        onSelect={(track) => {
          if (track === "jobs") navigation.popToTop();
        }}
      />
      <View style={styles.pageHeader}><PageHeader eyebrow="Consulting search" title="Find work, then build the pipeline." description="Kall turns your career direction into places to look, questions to ask, and private follow-up drafts. You choose every lead and send every message." /></View>

      <View style={styles.assistantCard}>
        <Text style={styles.cardTitle}>Ask Kall to find consulting leads</Text>
        <Text style={styles.cardBody}>
          Choose a professional direction. Add an optional specialty, industry,
          or problem you want to solve.
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.profileRow}
        >
          {profiles.map((profile) => (
            <Pressable
              key={profile.id}
              accessibilityRole="button"
              accessibilityState={{ selected: profileId === profile.id }}
              style={[styles.smallChip, profileId === profile.id && styles.smallChipActive]}
              onPress={() => setProfileId(profile.id)}
            >
              <Text style={[styles.smallChipText, profileId === profile.id && styles.smallChipTextActive]}>
                {profile.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <TextInput
          accessibilityLabel="Consulting search focus"
          value={focus}
          onChangeText={setFocus}
          placeholder="Example: release readiness for health tech"
          placeholderTextColor={theme.textMuted}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          style={[styles.primary, profiles.length === 0 && styles.disabled]}
          disabled={profiles.length === 0 || discovering}
          onPress={() => void discoverLeads()}
        >
          {discovering ? (
            <ActivityIndicator color={theme.accentInk} />
          ) : (
            <Text style={styles.primaryText}>Find lead paths</Text>
          )}
        </Pressable>
        {profiles.length === 0 ? (
          <Text style={styles.boundary}>
            Add a professional profile in Profile so Kall can tailor the search.
          </Text>
        ) : null}
      </View>

      {discovery ? (
        <View style={styles.discovery}>
          <Text style={styles.sectionTitle}>Your search brief</Text>
          <Text style={styles.positioning}>{discovery.positioning}</Text>
          <Text style={styles.subheading}>Qualify each lead</Text>
          {discovery.qualification_questions.map((question, index) => (
            <Text key={question} style={styles.question}>
              {index + 1}. {question}
            </Text>
          ))}

          {discovery.warm_lead_prompts.length > 0 ? (
            <>
              <Text style={styles.subheading}>Start with people you know</Text>
              {discovery.warm_lead_prompts.map((prompt) => (
                <View style={styles.card} key={prompt.contact_id}>
                  <Text style={styles.cardTitle}>{prompt.name}</Text>
                  <Text style={styles.cardBody}>
                    {[prompt.title, prompt.company].filter(Boolean).join(" at ") ||
                      prompt.relationship ||
                      "Saved contact"}
                  </Text>
                  <Text style={styles.draft}>{prompt.assistant_prompt}</Text>
                  <Action
                    label="Track as a lead"
                    onPress={() =>
                      openEditor("lead", undefined, {
                        organization: prompt.company ?? "",
                        title: `Potential advisory work through ${prompt.name}`,
                        details: `Qualify the need and decision maker before drafting outreach.`,
                        segment: "warm_contact",
                        source: "Kall warm-network prompt",
                      })
                    }
                  />
                </View>
              ))}
            </>
          ) : null}

          <Text style={styles.subheading}>Search public demand</Text>
          {discovery.searches.map((search) => (
            <View style={styles.card} key={search.provider}>
              <Text style={styles.cardTitle}>{search.provider}</Text>
              <Text style={styles.cardBody}>{search.rationale}</Text>
              <Text style={styles.query} numberOfLines={3}>{search.query}</Text>
              <View style={styles.actions}>
                <Action
                  label={`Search ${search.provider}`}
                  onPress={() => void Linking.openURL(search.search_url)}
                />
                <Action
                  label="Track result"
                  onPress={() =>
                    openEditor("lead", undefined, {
                      title: "Consulting opportunity",
                      details: "Confirm the business problem, decision maker, outcome, timeline, and budget.",
                      segment: search.suggested_segment,
                      source: search.provider,
                    })
                  }
                />
              </View>
            </View>
          ))}
          <Text style={styles.boundary}>
            Public results can be stale. Verify the organization and opportunity before saving it.
          </Text>
        </View>
      ) : null}

      <View style={styles.metrics}>
        <Metric value={workspace.leads.length} label="Leads" />
        <Metric
          value={workspace.follow_ups.filter((item) => item.status !== "completed").length}
          label="Follow-ups"
        />
        <Metric
          value={workspace.engagements.filter((item) => item.status === "active").length}
          label="Active"
        />
      </View>
      <Pressable
        accessibilityRole="button"
        style={styles.primary}
        onPress={() => openEditor("lead")}
      >
        <Text style={styles.primaryText}>Add a lead yourself</Text>
      </Pressable>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>
      ) : null}

      {editor ? (
        <View style={styles.editor}>
          <View style={styles.rowBetween}>
            <Text style={styles.editorTitle}>New {editor}</Text>
            <Pressable accessibilityRole="button" onPress={() => setEditor(null)}>
              <Text style={styles.link}>Close</Text>
            </Pressable>
          </View>
          {editor !== "lead" ? (
            <LeadChooser
              leads={workspace.leads}
              value={leadId}
              onChange={setLeadId}
              optional={editor === "engagement"}
            />
          ) : null}
          {editor === "lead" || editor === "engagement" ? (
            <Field
              label={editor === "lead" ? "Organization" : "Client"}
              value={organization}
              onChange={setOrganization}
            />
          ) : null}
          <Field
            label={
              editor === "lead"
                ? "Opportunity"
                : editor === "proposal"
                  ? "Proposal title"
                  : editor === "follow-up"
                    ? "Purpose"
                    : "Engagement"
            }
            value={title}
            onChange={setTitle}
          />
          {editor === "lead" ? (
            <>
              <ChipChooser
                title="Relationship"
                values={SEGMENTS}
                value={segment}
                onChange={setSegment}
              />
              <Field label="Where did you find it?" value={source} onChange={setSource} />
            </>
          ) : null}
          {editor === "follow-up" ? (
            <Field label="Due date (YYYY-MM-DD)" value={dueOn} onChange={setDueOn} />
          ) : null}
          <Field
            label={
              editor === "lead"
                ? "Next step"
                : editor === "follow-up"
                  ? "Message draft"
                  : editor === "proposal"
                    ? "Summary and deliverable"
                    : "Scope note"
            }
            value={details}
            onChange={setDetails}
            multiline
          />
          {editor !== "follow-up" ? (
            <Field
              label="Estimated value (USD)"
              value={fee}
              onChange={setFee}
              keyboard="numeric"
            />
          ) : null}
          {editor === "engagement" ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: vaettir }}
              style={styles.checkRow}
              onPress={() => setVaettir((value) => !value)}
            >
              <View style={[styles.checkbox, vaettir && styles.checkboxChecked]} />
              <Text style={styles.checkText}>Paid Vaettir design partnership</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={styles.primary}
            onPress={() => void saveEditor()}
          >
            <Text style={styles.primaryText}>Save {editor}</Text>
          </Pressable>
          {editor === "follow-up" ? (
            <Text style={styles.boundary}>
              Saving creates a private draft. It does not send the message.
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Pipeline</Text>
        <View style={styles.filterRow}>
          {(["all", "warm"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === value }}
              style={[styles.smallChip, filter === value && styles.smallChipActive]}
              onPress={() => setFilter(value)}
            >
              <Text style={[styles.smallChipText, filter === value && styles.smallChipTextActive]}>
                {value === "all" ? "All" : "Warm network"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {leads.map((lead) => (
        <View style={styles.card} key={lead.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.pill}>{label(lead.stage)}</Text>
            <Text style={styles.value}>{money(lead.projected_value_cents)}</Text>
          </View>
          <Text style={styles.cardTitle}>{lead.opportunity_name}</Text>
          <Text style={styles.cardBody}>
            {lead.organization} · {label(lead.relationship_segment)}
          </Text>
          {lead.next_step ? <Text style={styles.next}>Next: {lead.next_step}</Text> : null}
          <View style={styles.actions}>
            <Action
              label="Advance"
              onPress={() => void advanceLead(lead)}
              disabled={["won", "lost"].includes(lead.stage)}
            />
            <Action label="Proposal" onPress={() => openEditor("proposal", lead.id)} />
            <Action label="Follow-up" onPress={() => openEditor("follow-up", lead.id)} />
            <Action label="Engagement" onPress={() => openEditor("engagement", lead.id)} />
          </View>
        </View>
      ))}
      {leads.length === 0 ? <Empty text="No leads in this view." /> : null}

      <Text style={styles.sectionTitle}>Follow-up queue</Text>
      {workspace.follow_ups.map((item) => (
        <View style={styles.card} key={item.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.pill}>{label(item.status)}</Text>
            <Text style={styles.value}>{item.due_on}</Text>
          </View>
          <Text style={styles.cardTitle}>{item.purpose}</Text>
          <Text style={styles.cardBody}>{leadNames.get(item.lead_id)}</Text>
          {item.draft_message ? (
            <Text style={styles.draft}>{item.draft_message}</Text>
          ) : (
            <Text style={styles.warning}>Add the message before approval.</Text>
          )}
          <View style={styles.actions}>
            {item.status === "draft" ? (
              <Action
                label="Approve for manual use"
                disabled={!item.draft_message}
                onPress={() => void action(
                  () => approveConsultingFollowUp(item.id),
                  "Follow-up approved for manual use.",
                )}
              />
            ) : item.status === "approved_for_manual_use" ? (
              <Action
                label="Completed outside Kall"
                onPress={() => void action(
                  () => completeConsultingFollowUp(item.id),
                  "Follow-up completed.",
                )}
              />
            ) : null}
          </View>
          <Text style={styles.boundary}>
            Approval records review. Sending happens outside Kall.
          </Text>
        </View>
      ))}
      {workspace.follow_ups.length === 0 ? <Empty text="Your follow-up queue is clear." /> : null}

      <Text style={styles.sectionTitle}>Proposal drafts</Text>
      {workspace.proposals.map((item) => (
        <View style={styles.card} key={item.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.pill}>{label(item.status)}</Text>
            <Text style={styles.value}>{money(item.fee_cents)}</Text>
          </View>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardBody}>{leadNames.get(item.lead_id)}</Text>
          {item.summary ? <Text style={styles.draft}>{item.summary}</Text> : null}
          {item.status === "draft" ? (
            <Action
              label="Approve for manual use"
              onPress={() => void action(
                () => approveConsultingProposal(item.id),
                "Proposal approved for manual use.",
              )}
            />
          ) : null}
          <Text style={styles.boundary}>Kall cannot send or submit this proposal.</Text>
        </View>
      ))}
      {workspace.proposals.length === 0 ? <Empty text="No proposal drafts yet." /> : null}

      <Text style={styles.sectionTitle}>Engagements</Text>
      {workspace.engagements.map((item) => (
        <View style={styles.card} key={item.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.pill}>{label(item.status)}</Text>
            <Text style={styles.value}>{money(item.fee_cents)}</Text>
          </View>
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.cardBody}>{item.client_name}</Text>
          {item.design_partner_product === "vaettir" ? (
            <>
              <Text style={styles.partner}>
                Vaettir paid design partner · {label(item.design_partner_stage || "discovery")}
              </Text>
              <Action
                label="Advance Vaettir stage"
                disabled={item.design_partner_stage === "completed" || item.design_partner_stage === "declined"}
                onPress={() => {
                  const values = ["discovery", "proposed", "active", "completed"];
                  const next = values[Math.min(values.indexOf(item.design_partner_stage || "discovery") + 1, 3)];
                  void action(
                    () => updateConsultingEngagement(item.id, { design_partner_stage: next }),
                    `Vaettir partner moved to ${next}.`,
                  );
                }}
              />
            </>
          ) : null}
        </View>
      ))}
      {workspace.engagements.length === 0 ? <Empty text="No engagements yet." /> : null}
      <Text style={styles.footer}>Consulting records stay private to your Kall account.</Text>
    </ScrollView>
  );
}

function Metric({ value, label: text }: { value: number; label: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{text}</Text></View>;
}
function Empty({ text }: { text: string }) {
  return <View style={styles.empty}><Text style={styles.cardBody}>{text}</Text></View>;
}
function Action({ label: text, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} style={[styles.action, disabled && styles.disabled]} onPress={onPress}><Text style={styles.actionText}>{text}</Text></Pressable>;
}
function Field({ label: text, value, onChange, multiline = false, keyboard = "default" }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; keyboard?: "default" | "numeric" }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{text}</Text><TextInput accessibilityLabel={text} value={value} onChangeText={onChange} multiline={multiline} keyboardType={keyboard} style={[styles.input, multiline && styles.multiline]} placeholderTextColor={theme.textMuted} /></View>;
}
function ChipChooser({ title, values, value, onChange }: { title: string; values: string[]; value: string; onChange: (value: string) => void }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{title}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{values.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === value }} style={[styles.smallChip, item === value && styles.smallChipActive]} onPress={() => onChange(item)}><Text style={[styles.smallChipText, item === value && styles.smallChipTextActive]}>{label(item)}</Text></Pressable>)}</ScrollView></View>;
}
function LeadChooser({ leads, value, onChange, optional }: { leads: ConsultingLead[]; value: number | null; onChange: (value: number | null) => void; optional: boolean }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>Lead {optional ? "(optional)" : ""}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{optional ? <Pressable accessibilityRole="button" accessibilityState={{ selected: value === null }} style={[styles.smallChip, value === null && styles.smallChipActive]} onPress={() => onChange(null)}><Text style={[styles.smallChipText, value === null && styles.smallChipTextActive]}>None</Text></Pressable> : null}{leads.map((lead) => <Pressable accessibilityRole="button" accessibilityState={{ selected: lead.id === value }} key={lead.id} style={[styles.smallChip, lead.id === value && styles.smallChipActive]} onPress={() => onChange(lead.id)}><Text numberOfLines={1} style={[styles.smallChipText, lead.id === value && styles.smallChipTextActive]}>{lead.organization}</Text></Pressable>)}</ScrollView></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 48 },
  pageHeader: { marginTop: 22 },
  eyebrow: { color: theme.accent, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginTop: 22 },
  heading: { color: theme.text, fontSize: 26, fontWeight: "700", marginTop: 6 },
  intro: { color: theme.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 8 },
  assistantCard: { backgroundColor: theme.surface, borderColor: theme.accent, borderWidth: 1, borderRadius: 12, padding: 16, marginTop: 20 },
  profileRow: { paddingVertical: 14 },
  discovery: { marginTop: 4 },
  positioning: { color: theme.text, fontSize: 15, lineHeight: 22, backgroundColor: theme.surface, borderRadius: 10, padding: 14, marginBottom: 16 },
  subheading: { color: theme.text, fontSize: 17, fontWeight: "700", marginTop: 18, marginBottom: 8 },
  question: { color: theme.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: 7 },
  query: { color: theme.textMuted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  metrics: { flexDirection: "row", gap: 8, marginTop: 22 },
  metric: { flex: 1, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 12 },
  metricValue: { color: theme.text, fontSize: 22, fontWeight: "700" },
  metricLabel: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
  primary: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: theme.accent, marginTop: 16, paddingHorizontal: 16 },
  primaryText: { color: theme.accentInk, fontWeight: "700" },
  message: { color: theme.textSecondary, marginTop: 12, lineHeight: 20 },
  editor: { backgroundColor: theme.surface, borderColor: theme.accent, borderWidth: 1, borderRadius: 12, padding: 16, marginTop: 18 },
  editorTitle: { color: theme.text, fontSize: 20, fontWeight: "700" },
  sectionHeader: { marginTop: 28 },
  sectionTitle: { color: theme.text, fontSize: 20, fontWeight: "700", marginTop: 28, marginBottom: 10 },
  filterRow: { flexDirection: "row", gap: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  link: { color: theme.accent, fontWeight: "700", padding: 8 },
  card: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 },
  pill: { color: theme.accent, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  value: { color: theme.text, fontWeight: "700" },
  cardTitle: { color: theme.text, fontSize: 17, fontWeight: "700", marginTop: 4 },
  cardBody: { color: theme.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  next: { color: theme.text, borderTopColor: theme.border, borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  draft: { color: theme.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 12 },
  warning: { color: theme.warning, marginTop: 12 },
  partner: { color: theme.accentHover, borderColor: theme.borderStrong, borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  action: { minHeight: 44, alignItems: "center", justifyContent: "center", borderColor: theme.borderStrong, borderWidth: 1, borderRadius: 8, paddingHorizontal: 13, marginTop: 8 },
  actionText: { color: theme.text, fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  boundary: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  field: { marginTop: 14 },
  fieldLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6 },
  input: { minHeight: 48, borderColor: theme.border, borderWidth: 1, borderRadius: 9, backgroundColor: theme.surfaceRaised, color: theme.text, paddingHorizontal: 12, marginTop: 10 },
  multiline: { minHeight: 100, paddingTop: 12, textAlignVertical: "top" },
  smallChip: { minHeight: 40, justifyContent: "center", borderColor: theme.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 13, marginRight: 8 },
  smallChipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  smallChipText: { color: theme.textSecondary, fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
  smallChipTextActive: { color: theme.accentInk },
  checkRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  checkbox: { width: 22, height: 22, borderColor: theme.borderStrong, borderWidth: 2, borderRadius: 5 },
  checkboxChecked: { backgroundColor: theme.accent, borderColor: theme.accent },
  checkText: { color: theme.text, flex: 1 },
  empty: { alignItems: "center", borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 18, marginBottom: 12 },
  footer: { color: theme.textMuted, fontSize: 12, textAlign: "center", marginTop: 24 },
});
