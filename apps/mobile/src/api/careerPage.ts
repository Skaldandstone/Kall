import { apiRequest } from "./client";

export type Sample = { title: string; caption: string; provider: string; url: string };

export type CareerPageSection = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  position: number;
  visible: boolean;
  source: string | null;
  item_ids: number[];
  layout: string;
  options: { samples?: Sample[] } | null;
};

export type CareerPage = {
  id: number;
  slug: string;
  published: boolean;
  display_name: string | null;
  headline: string | null;
  summary: string | null;
  location: string | null;
  theme: string;
  links: Array<{ label: string; url: string }>;
  view_count: number;
};

export type SectionKind = { kind: string; source: string | null };

/** Creates the page (unpublished, with default sections) on first call. */
export const fetchCareerPage = () =>
  apiRequest<{ page: CareerPage; sections: CareerPageSection[]; available_kinds: SectionKind[] }>("/me/career-page");

export const updateCareerPage = (body: Partial<Pick<CareerPage, "slug" | "published" | "display_name" | "headline" | "summary" | "location" | "theme" | "links">>) =>
  apiRequest<CareerPage>("/me/career-page", { method: "PATCH", body });

export const addCareerPageSection = (kind: string, title: string) =>
  apiRequest<CareerPageSection>("/me/career-page/sections", { method: "POST", body: { kind, title } });

export const updateCareerPageSection = (
  id: number,
  body: Partial<Pick<CareerPageSection, "title" | "body" | "layout" | "visible" | "item_ids" | "options">>,
) => apiRequest<CareerPageSection>(`/me/career-page/sections/${id}`, { method: "PATCH", body });

export const deleteCareerPageSection = (id: number) =>
  apiRequest<void>(`/me/career-page/sections/${id}`, { method: "DELETE" });

/** Every section id, in the order they should appear -- the server rejects a partial list. */
export const reorderCareerPageSections = (sectionIds: number[]) =>
  apiRequest<{ reordered: number }>("/me/career-page/sections/reorder", { method: "POST", body: { section_ids: sectionIds } });
