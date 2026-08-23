import { apiRequest } from './client';

export type CareerProfile = {
  id: number;
  name: string;
  target_titles: string[];
};

export function fetchCareerProfiles(): Promise<{ profiles: CareerProfile[] }> {
  return apiRequest<{ profiles: CareerProfile[] }>('/me/career-profiles');
}

export type JobFeedItem = {
  match_id: number;
  job_id: number;
  score: number;
  recommendation: string;
  strengths: string[];
  gaps: string[];
  company: string;
  title: string;
  location?: string | null;
  work_type?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  url: string;
  source: string;
};

export function fetchJobsFeed(profileId: number, minScore = 0): Promise<JobFeedItem[]> {
  return apiRequest<JobFeedItem[]>(`/jobs/feed?professional_profile_id=${profileId}&min_score=${minScore}`);
}

export type TrackedOpportunity = {
  id: number;
  professional_profile_id: number;
  job_id: number;
  state: string;
  match_score: number;
  notes?: string | null;
  last_seen_at: string;
};

export function fetchOpportunities(): Promise<TrackedOpportunity[]> {
  return apiRequest<TrackedOpportunity[]>('/opportunities');
}

export type OpportunityState = 'new' | 'saved' | 'reviewing' | 'apply' | 'not_interested' | 'archived';

export function updateOpportunityState(id: number, state: OpportunityState): Promise<TrackedOpportunity> {
  return apiRequest<TrackedOpportunity>(`/opportunities/${id}`, { method: 'PATCH', body: { state } });
}

export function runDiscovery(profileId: number): Promise<{ jobs_collected: number; jobs_created: number; matches_created: number }> {
  return apiRequest(`/discovery/run/${profileId}`, { method: 'POST' });
}
