import { apiRequest } from "./client";

export type SuppressionReason = "dead_link" | "applied_external" | "applied_kall";

export type SuppressedResult = {
  id: number;
  url: string;
  reason: SuppressionReason | string;
  title: string | null;
  suppressed_at: string;
};

export const fetchSuppressed = () => apiRequest<SuppressedResult[]>("/search/suppressed");

/** Per-URL and permanent -- unlike an opportunity's "not interested", which
 * resurfaces if the posting changes. Only dead_link also blocks discovery. */
export const suppressResult = (url: string, title: string | null, reason: SuppressionReason) =>
  apiRequest<SuppressedResult>("/search/suppressed", { method: "POST", body: { url, title, reason } });

export const restoreResult = (url: string) =>
  apiRequest<{ status: string }>("/search/suppressed", { method: "DELETE", body: { url } });

export const restoreAllResults = () =>
  apiRequest<{ restored: number }>("/search/suppressed/all", { method: "DELETE" });
