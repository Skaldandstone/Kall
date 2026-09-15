import { apiDownload, apiRequest } from "./client";

export type ApplicationRecord = {
  id: number;
  status: string;
  job_id: number;
  career_profile_id: number;
  base_resume_id: number | null;
  prepared_payload: {
    company?: string;
    title?: string;
    job_url?: string;
    tailoring_proposal_id?: number | null;
    cover_letter_proposal_id?: number | null;
    generated_document_id?: number | null;
    customize_resume?: boolean;
    generate_cover_letter?: boolean;
    [key: string]: unknown;
  };
};

export type TailoringChange = {
  id: number;
  section: string;
  original_text: string;
  proposed_text: string;
  edited_text: string | null;
  reason: string;
  /** Role suggestions carry the job asked about instead of a text quote. */
  evidence: Array<{ type?: string; id?: number; text?: string; employer?: string; title?: string; requirement?: string; source?: string }>;
  immutable_tokens: string[];
  status: "pending" | "accepted" | "edited" | "rejected" | string;
};

export type TailoringProposal = {
  id: number;
  job_id: number;
  resume_id: number;
  status: "review_required" | "finalized" | string;
  unsupported_requirements: string[];
  finalized_at: string | null;
};

export type ArtifactFormat = "pdf" | "docx" | "txt";

export type Artifact = {
  id: number | null;
  format: ArtifactFormat;
  mime_type: string;
  byte_size: number | null;
};

export type Coverage = {
  required_percent: number;
  preferred_percent: number;
  required_covered: string[];
  preferred_covered: string[];
  unsupported: string[];
};

/** The whole assembled resume the files are rendered from. */
export type ResumeLayout = {
  name: string;
  contact: string[];
  sections: Array<{
    key: string;
    title: string;
    paragraphs?: string[];
    bullets?: string[];
    groups?: Array<{ label: string; items: string[] }>;
    entries?: Array<{ title: string; organization: string; location: string; dates: string; bullets: string[] }>;
  }>;
};

export type DocumentDetail = {
  document: {
    id: number;
    template_key: string;
    checksum: string;
    document_type: string;
    content_json?: { sections?: Array<{ section: string; text: string }>; layout?: ResumeLayout };
  };
  artifacts: Artifact[];
  coverage: Coverage | null;
};

export type CoverLetterProposal = {
  id: number;
  status: "review_required" | "finalized" | string;
  emphasis: string;
  tone: string;
  length: string;
};

export type CoverLetterChange = {
  id: number;
  position: number;
  proposed_text: string;
  edited_text: string | null;
  status: "pending" | "accepted" | "rejected" | string;
};

export const RESUME_TEMPLATES = [
  { key: "standard", label: "Classic chronological", use: "A familiar structure for most roles and industries." },
  { key: "executive", label: "Leadership and impact", use: "For senior leaders whose scope, decisions, and outcomes should lead." },
  { key: "creative", label: "Creative and portfolio", use: "For art, design, writing, performance, and other portfolio-backed work." },
  { key: "commercial", label: "Sales and customer outcomes", use: "For sales, account management, fundraising, and customer-facing work." },
  { key: "service", label: "Service, hospitality, and skilled work", use: "For culinary, hospitality, retail, trades, operations, and hands-on roles." },
  { key: "early", label: "Early career and career change", use: "For transferable skills, training, projects, and emerging experience." },
  { key: "compact", label: "Compact two-page", use: "For long work histories that need a concise, scan-friendly structure." },
] as const;

export const fetchApplication = (applicationId: number) =>
  apiRequest<ApplicationRecord>(`/applications/${applicationId}`);

export const fetchProposal = (proposalId: number) =>
  apiRequest<{ proposal: TailoringProposal; changes: TailoringChange[] }>(`/tailoring/proposals/${proposalId}`);

export const decideChange = (changeId: number, status: "accepted" | "edited" | "rejected", editedText?: string) =>
  apiRequest<TailoringChange>(`/tailoring/changes/${changeId}`, {
    method: "PATCH",
    body: { status, edited_text: editedText ?? null },
  });

/** Approve or skip every pending change at once; `sectionPrefix` limits it
 * to one family, e.g. "role:" for every per-role suggestion. */
export const reviewAllChanges = (proposalId: number, status: "accepted" | "rejected", sectionPrefix?: string) =>
  apiRequest<{ reviewed: number; changes: TailoringChange[] }>(`/tailoring/proposals/${proposalId}/review-all`, {
    method: "POST",
    body: { status, section_prefix: sectionPrefix ?? null },
  });

/** PNG of the person's own resume in one layout, as it currently stands. */
export const fetchTemplatePreview = (proposalId: number, templateKey: string) =>
  apiDownload(`/tailoring/${proposalId}/previews/${templateKey}.png`);

export const fetchDocumentPreview = (documentId: number) => apiDownload(`/documents/${documentId}/preview.png`);

export type AtsCheckItem = { key: string; label: string; passed: boolean; detail: string };
export type AtsReport = { passed: number; total: number; checks: AtsCheckItem[] };
/** Pass/fail checks run against the rendered PDF itself. */
export const fetchAtsCheck = (documentId: number) => apiRequest<AtsReport>(`/documents/${documentId}/ats-check`);

export const saveDocumentToProfile = (documentId: number) =>
  apiRequest<{ resume: { id: number; name: string } }>(`/documents/${documentId}/save-to-profile`, { method: "POST" });

export const ROLE_SECTION_PREFIX = "role:";

export const finalizeProposal = (proposalId: number) =>
  apiRequest<TailoringProposal>(`/tailoring/proposals/${proposalId}/finalize`, { method: "POST" });

export const generateDocument = (proposalId: number, templateKey: string) =>
  apiRequest<{ id: number }>(`/tailoring/${proposalId}/documents`, {
    method: "POST",
    body: { template_key: templateKey },
  });

export const fetchDocument = (documentId: number) =>
  apiRequest<DocumentDetail>(`/documents/${documentId}`);

export type DocumentSummary = {
  id: number;
  document_type: string;
  template_key: string;
  created_at: string;
  job_id: number | null;
  company: string | null;
  title: string | null;
  application_id: number | null;
};

export const listDocuments = () => apiRequest<DocumentSummary[]>("/documents");

export const downloadDocument = (documentId: number, format: ArtifactFormat) =>
  apiDownload(`/documents/${documentId}/download/${format}`);

export const createCoverLetter = (
  proposalId: number,
  body: { emphasis: string; tone: string; length: string; company_interest_notes?: string | null },
) => apiRequest<CoverLetterProposal>(`/tailoring/${proposalId}/cover-letter`, { method: "POST", body });

export const fetchCoverLetter = (proposalId: number) =>
  apiRequest<{ proposal: CoverLetterProposal; changes: CoverLetterChange[] }>(`/cover-letters/${proposalId}`);

export const decideCoverLetterChange = (changeId: number, decision: "accepted" | "rejected" | "edited", editedText?: string) =>
  apiRequest<CoverLetterChange>(`/cover-letter-changes/${changeId}`, {
    method: "PUT",
    body: { decision, edited_text: editedText ?? null },
  });

export const finalizeCoverLetter = (proposalId: number) =>
  apiRequest<CoverLetterProposal>(`/cover-letters/${proposalId}/finalize`, { method: "POST" });

export const linkGeneratedDocuments = (
  applicationId: number,
  body: { generated_document_id?: number; cover_letter_proposal_id?: number },
) => apiRequest<ApplicationRecord>(`/applications/${applicationId}/generated-documents`, { method: "PATCH", body });

/** Discards the in-progress or already-finalized tailoring review, cover
 * letter, and generated document, and starts a fresh proposal in their
 * place -- for someone unhappy with the resume they ended up with, who
 * previously had no way back once a step was finalized. */
export const restartTailoring = (applicationId: number) =>
  apiRequest<ApplicationRecord>(`/applications/${applicationId}/restart-tailoring`, { method: "POST" });
