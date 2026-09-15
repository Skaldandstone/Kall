import { apiRequest } from "./client";

export type EmailConnection = {
  id: number;
  provider: "gmail" | "outlook";
  status: string;
  scope: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};

export const fetchEmailConnections = () => apiRequest<EmailConnection[]>("/me/email-connections");

export const authorizeEmailConnection = (provider: "gmail" | "outlook") =>
  apiRequest<{ authorize_url: string }>(`/me/email-connections/${provider}/authorize`, { method: "POST" });

export const disconnectEmailConnection = (id: number) =>
  apiRequest<{ status: string }>(`/me/email-connections/${id}`, { method: "DELETE" });
