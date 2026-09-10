import { apiRequest } from "./client";

export type SearchSource = {
  id: number;
  provider: "greenhouse" | "lever" | "ashby" | string;
  company_name: string;
  board_key: string;
  enabled: boolean;
};

export const fetchSearchSources = () => apiRequest<SearchSource[]>("/me/search-sources");

export const addSearchSource = (body: { provider: string; company_name: string; board_key: string }) =>
  apiRequest<SearchSource>("/me/search-sources", { method: "POST", body: { ...body, enabled: true } });

export type Schedule = {
  id: number;
  professional_profile_id: number;
  cadence: "daily" | "weekdays" | "weekly" | "continuous" | string;
  timezone: string;
  run_at_local: string;
  enabled: boolean;
  max_posting_age_days: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  monitoring_status: string;
  monitored_sources: Array<{ provider: string; company_name: string; status: string; last_success_at: string | null }>;
};

export const fetchSchedules = () => apiRequest<Schedule[]>("/discovery/schedules");

export const saveSchedule = (body: {
  professional_profile_id: number;
  cadence: string;
  timezone: string;
  hour_local: number;
  max_posting_age_days: number;
  enabled: boolean;
}) => apiRequest<Schedule>("/discovery/schedules", { method: "POST", body });

export type SearchRun = {
  id: number;
  professional_profile_id: number;
  started_at: string;
  completed_at: string | null;
  providers_requested: string[];
  jobs_collected: number;
  jobs_created: number;
  jobs_skipped: number;
  matches_created: number;
  errors: string[];
  status: string;
};

export const fetchRuns = () => apiRequest<SearchRun[]>("/discovery/runs");
