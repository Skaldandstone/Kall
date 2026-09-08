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
