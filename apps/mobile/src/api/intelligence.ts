import { apiRequest } from "./client";

export type ResumeScore = {
  id: number;
  resume_id: number;
  total_score: number;
  title_score: number;
  industry_score: number;
  skills_score: number;
  leadership_score: number;
  recency_score: number;
  achievement_score: number;
  default_resume_boost: number;
  explanation: string[];
  gaps: string[];
};

export type ResumeSelection = {
  recommended_resume_id: number | null;
  selected_resume_id: number | null;
  selection_source: string;
};

export type JobIntelligence = {
  scores: ResumeScore[];
  coverage: Record<string, { covered: number; total: number }>;
  selection: ResumeSelection | null;
};

const analyzeJob = (jobId: number) =>
  apiRequest<unknown>(`/intelligence/jobs/${jobId}/analyze`, { method: "POST" });

const buildIntelligence = (jobId: number, profileId: number) =>
  apiRequest<unknown>(`/jobs/${jobId}/intelligence/${profileId}`, { method: "POST" });

export const fetchIntelligence = (jobId: number, profileId: number) =>
  apiRequest<JobIntelligence>(`/jobs/${jobId}/intelligence/${profileId}`);

/** The three calls the web job-intelligence page makes, in the order the
 * backend requires: ranking 409s until the posting has been analyzed. All
 * three are deterministic and quick, so this runs on screen open. */
export async function rankResumes(jobId: number, profileId: number): Promise<JobIntelligence> {
  await analyzeJob(jobId);
  await buildIntelligence(jobId, profileId);
  return fetchIntelligence(jobId, profileId);
}

export const selectResume = (jobId: number, profileId: number, resumeId: number) =>
  apiRequest<ResumeSelection>(`/jobs/${jobId}/intelligence/${profileId}/selection`, {
    method: "PUT",
    body: { resume_id: resumeId },
  });
