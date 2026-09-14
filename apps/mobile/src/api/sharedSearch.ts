import { apiRequest } from "./client";

export type SharedSearch = {
  id: number;
  slug: string;
  friend_label: string | null;
  source_profile_id: number | null;
  status: "awaiting_input" | "active" | "revoked";
};

export const fetchSharedSearches = () => apiRequest<SharedSearch[]>("/me/shared-searches");

export const createSharedSearch = (body: { source_profile_id?: number; criteria?: { target_titles: string[] }; mode?: "invite"; friend_label?: string | null }) =>
  apiRequest<SharedSearch>("/me/shared-searches", { method: "POST", body });

export const revokeSharedSearch = (id: number) => apiRequest<{ status: string }>(`/me/shared-searches/${id}`, { method: "DELETE" });
