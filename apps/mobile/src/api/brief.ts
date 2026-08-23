import { apiRequest } from './client';

export type Opportunity = {
  job_id: number;
  company: string;
  title: string;
  location?: string | null;
  work_type?: string | null;
  score: number;
  recommendation: string;
  strengths: string[];
  gaps: string[];
};

export type Dimension = { label: string; score: number; explanation: string };

export type Brief = {
  generated_at: string;
  user: { preferred_name: string };
  focus: { kind: string; title: string; detail: string; href: string };
  opportunities: Opportunity[];
  career_health: { score: number; dimensions: Dimension[] };
  applications: { total: number; active: number; by_status: Record<string, number> };
  resumes: { total: number; default_resume_id?: number | null };
};

export function fetchBrief(): Promise<Brief> {
  return apiRequest<Brief>('/me/morning-brief');
}
