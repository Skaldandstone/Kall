import { apiRequest } from './client';

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
  summary: { total: number; active: number; needs_review: number; submitted: number; best_match: number | null };
  stages: PipelineStage[];
  next_decision: PipelineItem | null;
  generated_at: string;
};

export function fetchPipeline(): Promise<Pipeline> {
  return apiRequest<Pipeline>('/me/applications');
}

export type Question = { id: number; prompt: string; category: string; sensitive: boolean; required: boolean };
export type Answer = { id: number; question_id: number; value?: string; status: string };
export type ReviewData = { review: { status: string; readiness_issues: string[] }; questions: Question[]; answers: Answer[] };

export async function fetchReview(applicationId: number): Promise<ReviewData> {
  // Idempotent: creates the review record on first call, then always returns the current state.
  await apiRequest(`/applications/${applicationId}/review`, { method: 'POST' });
  return apiRequest<ReviewData>(`/applications/${applicationId}/review`);
}

export function confirmReview(applicationId: number) {
  return apiRequest(`/applications/${applicationId}/review`, {
    method: 'PUT',
    body: {
      documents_confirmed: true,
      answers_confirmed: true,
      sensitive_fields_confirmed: true,
      attestations_confirmed: true,
    },
  });
}

export function approveReview(applicationId: number) {
  return apiRequest(`/applications/${applicationId}/review/approve`, { method: 'POST' });
}
