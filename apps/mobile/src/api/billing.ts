import { apiRequest } from './client';

export type BillingStatus = {
  enabled: boolean;
  can_manage: boolean;
  livemode: boolean;
  native_enabled: boolean;
  plan: 'free' | 'plus' | 'premium';
  sources: Array<'stripe' | 'play_store' | 'app_store'>;
};

export const fetchBillingStatus = () => apiRequest<BillingStatus>('/billing/status');

export type MeterState = {
  used: number;
  limit: number | null;
  period: 'week' | 'month' | 'lifetime' | string;
  remaining: number | null;
};

export type Usage = {
  plan: 'free' | 'plus' | 'premium' | string;
  billing_exempt: boolean;
  meters: Record<'applications' | 'ai_actions' | 'storage_bytes' | string, MeterState>;
};

export const fetchUsage = () => apiRequest<Usage>('/me/usage');
