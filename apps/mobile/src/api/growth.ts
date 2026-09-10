import { apiRequest } from './client';

export type Goal = {
  id: number;
  title: string;
  target_role: string;
  target_industry?: string | null;
  target_date?: string | null;
  time_per_week_hours?: number | null;
  status: string;
};

export type Milestone = {
  id: number;
  sequence: number;
  phase: string;
  title: string;
  description: string;
  category: string;
  target_date?: string | null;
  estimated_hours?: number | null;
  status: string;
};

export type Resource = {
  id: number;
  title: string;
  provider?: string | null;
  url: string;
  description?: string | null;
  cost_type?: string | null;
  difficulty?: string | null;
  estimated_hours?: number | null;
  saved: boolean;
};

export type SearchQuery = {
  id: number;
  category: string;
  query: string;
  search_url: string;
  rationale: string;
};

export type Assessment = {
  id: number;
  answer_text: string;
  applicable_skills: Array<{ skill: string; how_it_applies: string }>;
  gaps: string[];
  readiness_score: number;
  narrative: string;
  provider: string;
  created_at: string;
};

export type Plan = {
  plan: {
    id: number;
    provider: string;
    summary: string;
    current_strengths: string[];
    skill_gaps: string[];
    recommended_roles: string[];
  };
  milestones: Milestone[];
  resources: Resource[];
  searches: SearchQuery[];
  skill_assessments: Assessment[];
};

export type GrowthDashboard = {
  goals: Array<{ goal: Goal; plan: Plan | null }>;
};

export function fetchGrowthDashboard(): Promise<GrowthDashboard> {
  return apiRequest<GrowthDashboard>('/growth');
}

export type GoalInput = {
  title: string;
  target_role: string;
  target_industry?: string;
  time_per_week_hours?: number;
  budget_preference?: string;
};

export function createGoal(input: GoalInput): Promise<Goal> {
  return apiRequest<Goal>('/growth/goals', { method: 'POST', body: input });
}

export function generatePlan(goalId: number, regenerate: boolean): Promise<Plan> {
  return apiRequest<Plan>(`/growth/goals/${goalId}/plan`, { method: 'POST', body: { regenerate } });
}

export function analyzeSkills(goalId: number, answer: string): Promise<Assessment> {
  return apiRequest<Assessment>(`/growth/goals/${goalId}/skills-analysis`, { method: 'POST', body: { answer } });
}

export function importResource(planId: number, url: string, title: string, description?: string): Promise<Resource> {
  return apiRequest<Resource>(`/growth/plans/${planId}/resources`, { method: 'POST', body: { url, title, description } });
}

export type ResourceHit = {
  title: string;
  url: string;
  snippet: string;
  category: string;
  saved: boolean;
};

export function searchPlanResources(planId: number, category?: string): Promise<{ enabled: boolean; results: ResourceHit[] }> {
  return apiRequest(`/growth/plans/${planId}/search`, { method: 'POST', body: category ? { category } : {} });
}

export function pinResource(resourceId: number, saved: boolean): Promise<Resource> {
  return apiRequest<Resource>(`/growth/resources/${resourceId}`, { method: 'PATCH', body: { saved } });
}
