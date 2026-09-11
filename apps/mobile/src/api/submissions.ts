import { apiDownload, apiRequest } from "./client";

export type AutofillField = {
  path: string;
  label: string;
  value: string | boolean | number;
  tier: "always" | "opt_in" | "always_confirm";
  requires_confirmation: boolean;
};

export type AutofillPack = {
  application_id: number;
  job: { company: string | null; title: string | null; url: string | null };
  provider: string;
  fields: AutofillField[];
  resume: { resume_id: number; filename: string; mime_type: string; download_url: string } | null;
  screening_answers: Array<{ key: string; prompt: string; value: string | null; requires_confirmation: boolean }>;
  omitted: Array<{ path: string; label: string; reason: string }>;
};

export const fetchAutofillPack = (applicationId: number) =>
  apiRequest<AutofillPack>(`/applications/${applicationId}/autofill-pack`);

export const downloadResume = (resumeId: number) => apiDownload(`/me/resumes/${resumeId}/download`);

export type Submission = {
  id: number;
  application_id: number;
  provider: string;
  status: "prepared" | "awaiting_confirmation" | "confirmed" | "needs_manual_completion" | "blocked" | "submitted" | string;
  failure_code: string | null;
  failure_detail: string | null;
  confirmed_at: string | null;
  submitted_at: string | null;
};

export const listSubmissions = () => apiRequest<Submission[]>("/submissions");

export const prepareSubmission = (applicationId: number) =>
  apiRequest<Submission>(`/applications/${applicationId}/submission-preview`, { method: "POST" });

/** Always 200 -- read `status` and `failure_detail`, the HTTP code says nothing. */
export const confirmSubmission = (submissionId: number) =>
  apiRequest<Submission>(`/submissions/${submissionId}/confirm`, { method: "POST" });

export const attemptSubmission = (submissionId: number) =>
  apiRequest<{ id: number; status: string; attempt_number: number }>(`/submissions/${submissionId}/attempt`, { method: "POST" });

export type PipelineStage = "preparing" | "review" | "approved" | "submitted" | "interview" | "closed" | "rejected";

export const moveApplicationStage = (applicationId: number, stage: PipelineStage) =>
  apiRequest<{ id: number; stage: PipelineStage; job_url: string | null }>(`/me/applications/${applicationId}/stage`, {
    method: "PATCH",
    body: { stage },
  });

export const trackExternalApplication = (body: {
  url: string;
  title: string;
  snippet?: string | null;
  source: string;
  professional_profile_id: number;
  /** Record it as applied even though an in-progress application exists. */
  mark_submitted_anyway?: boolean;
}) => apiRequest<{ id: number; status: string }>("/applications/track-external", { method: "POST", body });
