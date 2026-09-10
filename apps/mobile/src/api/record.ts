import { apiRequest } from "./client";

export type RecordRow = { id: number } & Record<string, unknown>;

export const fetchRecords = (resource: string) =>
  apiRequest<RecordRow[]>(`/profile/resources/${resource}`);

export const createRecord = (resource: string, data: Record<string, unknown>) =>
  apiRequest<RecordRow>(`/profile/resources/${resource}`, { method: "POST", body: { data } });

export const updateRecord = (resource: string, id: number, data: Record<string, unknown>) =>
  apiRequest<RecordRow>(`/profile/resources/${resource}/${id}`, { method: "PATCH", body: { data } });

export const deleteRecord = (resource: string, id: number) =>
  apiRequest<void>(`/profile/resources/${resource}/${id}`, { method: "DELETE" });

export type Readiness = {
  overall: number;
  sections: Record<string, number>;
  missing: string[];
};

export const fetchReadiness = () => apiRequest<Readiness>("/profile/readiness");

// Write-only: the server encrypts these and never returns them in the clear.
export const saveEeo = (body: {
  veteran_status: string | null;
  disability_status: string | null;
  race_ethnicity: string | null;
  gender_identity: string | null;
  decline_to_answer_defaults: boolean;
}) => apiRequest<unknown>("/profile/eeo", { method: "PUT", body });

export const saveWorkAuthorization = (body: {
  country: string;
  authorization_type: string;
  citizenship_status: string | null;
  visa_type: string | null;
  requires_current_sponsorship: boolean;
  requires_future_sponsorship: boolean;
}) => apiRequest<unknown>("/profile/work-authorization", { method: "PUT", body });

export type PrivacyRule = { field_path: string; scopes: string[]; require_confirmation: boolean };

export const fetchPrivacyRules = () => apiRequest<PrivacyRule[]>("/profile/privacy");

export const savePrivacyRule = (fieldPath: string, scopes: string[]) =>
  apiRequest<PrivacyRule>(`/profile/privacy/${fieldPath}`, {
    method: "PUT",
    body: { field_path: fieldPath, scopes, require_confirmation: true },
  });

export type Achievement = {
  id: number;
  source_resume_id: number | null;
  employer: string | null;
  role_title: string | null;
  achievement_text: string;
  metrics: string[];
  skills: string[];
  verification_status: "suggested" | "verified" | "rejected" | string;
  user_notes: string | null;
  created_at: string;
};

export const fetchAchievements = () => apiRequest<Achievement[]>("/intelligence/achievements");

export const updateAchievement = (id: number, body: { verification_status?: string; achievement_text?: string; user_notes?: string }) =>
  apiRequest<Achievement>(`/intelligence/achievements/${id}`, { method: "PATCH", body });

/** Extracts achievements from a stored resume; the only way they get created. */
export const parseResume = (resumeId: number) =>
  apiRequest<{ id: number; warnings: string[] }>(`/intelligence/resumes/${resumeId}/parse`, { method: "POST" });
