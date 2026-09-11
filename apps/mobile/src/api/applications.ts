import { apiRequest } from "./client";

export type PipelineItem = {
  id: number;
  status: string;
  stage: string;
  company: string;
  role: string;
  location?: string | null;
  job_url?: string | null;
  match_score?: number | null;
};

export type PipelineStage = {
  key: string;
  label: string;
  count: number;
  items: PipelineItem[];
};

export type Pipeline = {
  summary: {
    total: number;
    active: number;
    needs_review: number;
    submitted: number;
    best_match: number | null;
  };
  stages: PipelineStage[];
  next_decision: PipelineItem | null;
  generated_at: string;
};

export function fetchPipeline(): Promise<Pipeline> {
  return apiRequest<Pipeline>("/me/applications");
}

export type Question = {
  id: number;
  prompt: string;
  category: string;
  sensitive: boolean;
  required: boolean;
};
export type Answer = {
  id: number;
  question_id: number;
  value?: string;
  status: string;
};
export type ReviewData = {
  review: {
    status: string;
    readiness_issues: string[];
    documents_confirmed?: boolean;
    answers_confirmed?: boolean;
    sensitive_fields_confirmed?: boolean;
    attestations_confirmed?: boolean;
  };
  questions: Question[];
  answers: Answer[];
};

export async function fetchReview(applicationId: number): Promise<ReviewData> {
  // Idempotent: creates the review record on first call, then always returns the current state.
  await apiRequest(`/applications/${applicationId}/review`, { method: "POST" });
  return apiRequest<ReviewData>(`/applications/${applicationId}/review`);
}

export function approveReview(applicationId: number) {
  return apiRequest(`/applications/${applicationId}/review/approve`, {
    method: "POST",
  });
}

export function saveAnswer(
  applicationId: number,
  answerId: number,
  value: string,
) {
  return apiRequest(`/applications/${applicationId}/answers/${answerId}`, {
    method: "PUT",
    body: { value, value_json: {}, decision: "edited" },
  });
}

export function confirmReview(
  applicationId: number,
  body: {
    documents_confirmed: boolean;
    answers_confirmed: boolean;
    sensitive_fields_confirmed: boolean;
    attestations_confirmed: boolean;
  },
) {
  return apiRequest(`/applications/${applicationId}/review`, {
    method: "PUT",
    body,
  });
}

export type PreparedApplication = { id: number; status: string };

export type ExistingApplication = {
  id: number;
  status: string;
  stage: string;
  completed: boolean;
  created_at: string | null;
  submitted_at: string | null;
  company: string | null;
  title: string | null;
  job_url: string | null;
};

/** Whether an application already exists for this posting (by job or by
 * any spelling of its link), so the app can offer to continue it. */
export function checkExistingApplication(query: { job_id?: number; url?: string }): Promise<{ exists: boolean; application: ExistingApplication | null }> {
  const params = new URLSearchParams();
  if (query.job_id != null) params.set("job_id", String(query.job_id));
  if (query.url) params.set("url", query.url);
  return apiRequest(`/me/applications/existing?${params.toString()}`);
}

export function prepareApplication(body: {
  job_id: number;
  professional_profile_id: number;
  resume_id: number | null;
  customize_resume: boolean;
  generate_cover_letter: boolean;
  application_mode: "assisted" | "automatic";
}): Promise<PreparedApplication> {
  return apiRequest<PreparedApplication>("/applications/prepare-options", {
    method: "POST",
    body,
  });
}
