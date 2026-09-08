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
  work_types: string[];
  employment_types: string[];
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
  readiness: { score: number; checks: Record<string, boolean> };
};
export type ResumeStudio = {
  resumes: Resume[];
  profiles: Array<{
    id: number;
    name: string;
    default_resume_id?: number | null;
  }>;
};
export type NotificationPreferences = {
  email_enabled: boolean;
  push_enabled: boolean;
  delivery_mode: "digest" | "immediate";
  digest_hour_local: number;
  timezone: string;
  minimum_match_score: number;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  email_provider_status?: string;
};

export const fetchAccount = () => apiRequest<Account>("/me");
export const fetchIdentity = () => apiRequest<Identity>("/me/identity");
export const saveIdentity = (body: Partial<Identity>) =>
  apiRequest<Identity>("/me/identity", { method: "PUT", body });
export const fetchCareerProfiles = () =>
  apiRequest<{ profiles: CareerProfile[] }>("/me/career-profiles");
export const createCareerProfile = (body: {
  name: string;
  target_titles: string[];
  industries: string[];
  countries: string[];
  states_regions: string[];
  work_types: string[];
}) =>
  apiRequest<CareerProfile>("/me/professional-profiles", {
    method: "POST",
    body,
  });
export const saveCareerProfile = (id: number, body: Partial<CareerProfile>) =>
  apiRequest<CareerProfile>(`/me/career-profiles/${id}`, {
    method: "PUT",
    body,
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
