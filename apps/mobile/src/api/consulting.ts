import { apiRequest } from "./client";

export type ConsultingLead = {
  id: number;
  organization: string;
  opportunity_name: string;
  relationship_segment: string;
  stage: string;
  projected_value_cents: number | null;
  next_step: string | null;
};

export type ConsultingProposal = {
  id: number;
  lead_id: number;
  title: string;
  summary: string | null;
  deliverables: string[];
  fee_cents: number | null;
  status: string;
};

export type ConsultingFollowUp = {
  id: number;
  lead_id: number;
  due_on: string;
  channel: string;
  purpose: string;
  draft_message: string | null;
  status: string;
};

export type ConsultingEngagement = {
  id: number;
  lead_id: number | null;
  client_name: string;
  name: string;
  status: string;
  fee_cents: number | null;
  design_partner_product: string | null;
  design_partner_stage: string | null;
};

export type ConsultingPractice = {
  available: boolean;
  engagement_types: string[];
  rate_cents: number | null;
  rate_basis: "hour" | "day" | "project" | "month";
  currency: string;
  availability_note: string | null;
  agreement_url: string | null;
};

export type ConsultingWorkspace = {
  leads: ConsultingLead[];
  proposals: ConsultingProposal[];
  follow_ups: ConsultingFollowUp[];
  engagements: ConsultingEngagement[];
  practice: ConsultingPractice | null;
  career_page: { exists: boolean; published: boolean; slug: string | null };
};

export type ConsultingDiscoveryPlan = {
  professional_profile_id: number;
  profile_name: string;
  positioning: string;
  qualification_questions: string[];
  searches: Array<{
    provider: string;
    query: string;
    search_url: string;
    rationale: string;
    suggested_segment: string;
  }>;
  warm_lead_prompts: Array<{
    contact_id: number;
    name: string;
    company: string | null;
    title: string | null;
    relationship: string | null;
    assistant_prompt: string;
  }>;
};

export const fetchConsultingWorkspace = () =>
  apiRequest<ConsultingWorkspace>("/me/consulting/workspace");

export const updateConsultingPractice = (body: object) =>
  apiRequest<ConsultingPractice>("/me/consulting/practice", { method: "PUT", body });

export const fetchConsultingDiscoveryPlan = (profileId: number, focus = "") => {
  const query = focus.trim() ? `?focus=${encodeURIComponent(focus.trim())}` : "";
  return apiRequest<ConsultingDiscoveryPlan>(
    `/me/consulting/discovery-plan/${profileId}${query}`,
  );
};

export const createConsultingLead = (body: object) =>
  apiRequest<ConsultingLead>("/me/consulting/leads", { method: "POST", body });

export const updateConsultingLead = (id: number, body: object) =>
  apiRequest<ConsultingLead>(`/me/consulting/leads/${id}`, { method: "PATCH", body });

export const createConsultingProposal = (body: object) =>
  apiRequest<ConsultingProposal>("/me/consulting/proposals", { method: "POST", body });

export const approveConsultingProposal = (id: number) =>
  apiRequest<ConsultingProposal>(`/me/consulting/proposals/${id}/approve`, {
    method: "POST",
    body: { confirm_reviewed_for_manual_use: true },
  });

export const createConsultingFollowUp = (body: object) =>
  apiRequest<ConsultingFollowUp>("/me/consulting/follow-ups", { method: "POST", body });

export const approveConsultingFollowUp = (id: number) =>
  apiRequest<ConsultingFollowUp>(`/me/consulting/follow-ups/${id}/approve`, {
    method: "POST",
    body: { confirm_reviewed_for_manual_use: true },
  });

export const completeConsultingFollowUp = (id: number) =>
  apiRequest<ConsultingFollowUp>(`/me/consulting/follow-ups/${id}/complete`, {
    method: "POST",
    body: { confirm_completed_outside_kall: true },
  });

export const createConsultingEngagement = (body: object) =>
  apiRequest<ConsultingEngagement>("/me/consulting/engagements", { method: "POST", body });

export const updateConsultingEngagement = (id: number, body: object) =>
  apiRequest<ConsultingEngagement>(`/me/consulting/engagements/${id}`, { method: "PATCH", body });
