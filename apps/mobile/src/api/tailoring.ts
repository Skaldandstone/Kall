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
  evidence: Array<{ type?: string; id?: number; text: string }>;
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

export type DocumentDetail = {
  document: { id: number; template_key: string; checksum: string; document_type: string };
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

export const finalizeProposal = (proposalId: number) =>
  apiRequest<TailoringProposal>(`/tailoring/proposals/${proposalId}/finalize`, { method: "POST" });

export const generateDocument = (proposalId: number, templateKey: string) =>
  apiRequest<{ id: number }>(`/tailoring/${proposalId}/documents`, {
    method: "POST",
    body: { template_key: templateKey },
  });

export const fetchDocument = (documentId: number) =>
  apiRequest<DocumentDetail>(`/documents/${documentId}`);

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
