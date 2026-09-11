import { apiRequest, apiUpload } from "./client";

export type Account = {
  id: number;
  email: string;
  full_name: string;
  plan: string;
};
export type Identity = {
  email: string;
  full_name: string;
  preferred_name?: string | null;
  city?: string | null;
  state_region?: string | null;
  country?: string | null;
  timezone?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  portfolio_urls: string[];
  website_urls: string[];
  professional_summary?: string | null;
};
export type CareerProfile = {
  id: number;
  name: string;
  target_titles: string[];
  industries: string[];
  functional_areas: string[];
  include_keywords: string[];
  exclude_keywords: string[];
  countries: string[];
  states_regions: string[];
  cities: string[];
  work_types: string[];
  employment_types: string[];
  pay_basis: "salary" | "hourly" | string;
  minimum_base?: number | null;
  target_base?: number | null;
  default_resume_id?: number | null;
  default_resume_name?: string | null;
  is_active: boolean;
  match_count: number;
  best_match_score?: number | null;
  completeness: { score: number };
};
export type Resume = {
  id: number;
  name: string;
  version: number;
  tags: string[];
  industries: string[];
  target_titles: string[];
  is_default: boolean;
  updated_at: string;
  readiness: { score: number; strengths: string[]; gaps: string[]; explanation: string };
};
export type ResumeStudio = {
  resumes: Resume[];
  profiles: Array<{
    id: number;
    name: string;
    default_resume_id?: number | null;
  }>;
};
export type CareerStrategySuggestion = {
  summary?: string;
  profile_name?: string;
  target_titles?: string[];
  functional_areas?: string[];
  industries?: string[];
  keywords?: string[];
  work_types?: string[];
  pay_basis?: "salary" | "hourly";
  suggested_salary_min?: number | null;
  suggested_salary_max?: number | null;
};
export type CareerProfileInput = {
  name: string;
  target_titles: string[];
  industries: string[];
  functional_areas: string[];
  include_keywords: string[];
  exclude_keywords: string[];
  countries: string[];
  states_regions: string[];
  cities: string[];
  work_types: string[];
  employment_types: string[];
  pay_basis: string;
  minimum_base: number | null;
  target_base: number | null;
  default_resume_id: number | null;
  is_active?: boolean;
};
export type NotificationPreferences = {
  email_enabled: boolean;
  push_enabled: boolean;
  delivery_mode: "digest" | "immediate";
  digest_hour_local: number;
  timezone: string;
  minimum_match_score: number;
  // Both set, or both null -- the server rejects one without the other.
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  email_provider_status?: string;
};

export const fetchAccount = () => apiRequest<Account>("/me");
/** Irreversible. The server deletes everything in one transaction and
 * returns 204; the email is typed back as the confirmation step. */
export const deleteAccount = (confirmEmail: string) =>
  apiRequest<void>("/me", { method: "DELETE", body: { confirm_email: confirmEmail } });
export const fetchIdentity = () => apiRequest<Identity>("/me/identity");
// phone, address and postal_code are accepted, encrypted, and never returned.
export const saveIdentity = (body: Partial<Identity> & { phone?: string; address?: string; postal_code?: string }) =>
  apiRequest<Identity>("/me/identity", { method: "PUT", body });
export const fetchCareerProfiles = () =>
  apiRequest<{ profiles: CareerProfile[] }>("/me/career-profiles");
export const createCareerProfile = (body: CareerProfileInput) =>
  apiRequest<CareerProfile>("/me/professional-profiles", {
    method: "POST",
    body,
  });
export const saveCareerProfile = (id: number, body: CareerProfileInput) =>
  apiRequest<CareerProfile>(`/me/career-profiles/${id}`, {
    method: "PUT",
    body,
  });
export type FunctionalArea = { name: string; related_roles: string[] };
export const fetchFunctionalAreas = () =>
  apiRequest<{ areas: FunctionalArea[] }>("/me/career-profiles/functional-areas");
/** Close variants of titles already approved -- the next spellings job
 * boards use for the same role. `exclude` keeps already-offered ones out. */
export const fetchRelatedTitles = (titles: string[], exclude: string[]) =>
  apiRequest<{ titles: string[]; ai_enabled: boolean }>("/me/career-profiles/related-titles", {
    method: "POST",
    body: { titles, exclude },
  });
/** What the web onboarding wizard records when it finishes. The server
 * self-heals this from profile data too, so a failure here is harmless. */
export const markOnboardingComplete = (withResume: boolean) =>
  apiRequest<unknown>("/profile/onboarding", {
    method: "PUT",
    body: {
      current_step: "complete",
      completed_steps: ["account", ...(withResume ? ["resume"] : []), "strategy"],
      dismissed_steps: [],
      is_complete: true,
    },
  });
export const fetchResumeStudio = () =>
  apiRequest<ResumeStudio>("/me/resume-studio");
export const uploadResume = (file: {
  uri: string;
  name: string;
  mimeType?: string | null;
}) =>
  apiUpload<Resume>("/me/resumes", "file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || "application/octet-stream",
  });
export const suggestCareerStrategy = (resumeId: number) =>
  apiRequest<{
    ai_enabled: boolean;
    suggestion: CareerStrategySuggestion | null;
  }>(`/me/resumes/${resumeId}/suggest-strategy`, { method: "POST" });
export const updateResume = (
  id: number,
  body: {
    is_default?: boolean;
    name?: string;
    tags?: string[];
    industries?: string[];
    target_titles?: string[];
  },
) => apiRequest<Resume>(`/me/resumes/${id}`, { method: "PATCH", body });
export const deleteResume = (id: number) =>
  apiRequest<void>(`/me/resumes/${id}`, { method: "DELETE" });
export const fetchNotificationPreferences = () =>
  apiRequest<NotificationPreferences>("/notification-preferences");
export const saveNotificationPreferences = (body: NotificationPreferences) =>
  apiRequest<NotificationPreferences>("/notification-preferences", {
    method: "PUT",
    body,
  });
