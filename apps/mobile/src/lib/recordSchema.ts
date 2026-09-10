// Mirrors apps/web/app/profiles/recordSchema.ts and the SQLModel definitions
// in backend/kall/models/profile.py; keep the three in step. `sensitive`
// fields are encrypted server-side and come back as ciphertext on read, so
// the editor treats them as write-only: never prefilled, sent only when typed.

export type FieldKind = "text" | "textarea" | "date" | "number" | "select" | "checkbox" | "list";

export type RecordField = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: readonly string[];
  help?: string;
  sensitive?: boolean;
};

export type RecordSchema = {
  label: string;
  singular: string;
  description: string;
  fields: readonly RecordField[];
  titleFields: readonly string[];
};

const PROFICIENCY = ["basic", "conversational", "professional", "native"] as const;
const COMMA_HELP = "Separate multiple values with commas.";
const DATE_HELP = "YYYY-MM-DD";

export const RECORD_SCHEMAS: Record<string, RecordSchema> = {
  employment: {
    label: "Employment",
    singular: "role",
    description: "Where you have worked and what you did there.",
    titleFields: ["job_title", "employer"],
    fields: [
      { name: "employer", label: "Employer", kind: "text", required: true },
      { name: "job_title", label: "Job title", kind: "text", required: true },
      { name: "location", label: "Location", kind: "text" },
      { name: "start_date", label: "Start date", kind: "date", help: DATE_HELP },
      { name: "end_date", label: "End date", kind: "date", help: DATE_HELP },
      { name: "is_current", label: "Current role", kind: "checkbox" },
      { name: "description", label: "Description", kind: "textarea" },
    ],
  },
  education: {
    label: "Education",
    singular: "qualification",
    description: "Degrees, diplomas, and programs.",
    titleFields: ["institution"],
    fields: [
      { name: "institution", label: "Institution", kind: "text", required: true },
      { name: "degree", label: "Degree", kind: "text" },
      { name: "major", label: "Major", kind: "text" },
      { name: "minor", label: "Minor", kind: "text" },
      { name: "graduation_date", label: "Graduation date", kind: "date", help: DATE_HELP },
      { name: "gpa", label: "GPA", kind: "number" },
      { name: "honors", label: "Honors", kind: "list", help: COMMA_HELP },
      { name: "country", label: "Country", kind: "text" },
      { name: "state_region", label: "State or region", kind: "text" },
    ],
  },
  skills: {
    label: "Skills",
    singular: "skill",
    description: "What you can do, with how long and how well.",
    titleFields: ["name"],
    fields: [
      { name: "name", label: "Skill", kind: "text", required: true },
      { name: "category", label: "Category", kind: "text", help: "For example: Programming, Leadership." },
      { name: "proficiency", label: "Proficiency", kind: "select", options: PROFICIENCY },
      { name: "years_experience", label: "Years of experience", kind: "number" },
      { name: "last_used_year", label: "Last used (year)", kind: "number" },
      { name: "is_primary", label: "Highlight as a primary skill", kind: "checkbox" },
    ],
  },
  certifications: {
    label: "Certifications",
    singular: "certification",
    description: "Licenses and credentials, with renewal reminders.",
    titleFields: ["name"],
    fields: [
      { name: "name", label: "Certification", kind: "text", required: true },
      { name: "issuing_organization", label: "Issued by", kind: "text", required: true },
      { name: "credential_id", label: "Credential ID", kind: "text", sensitive: true },
      { name: "verification_url", label: "Verification link", kind: "text" },
      { name: "obtained_on", label: "Obtained on", kind: "date", help: DATE_HELP },
      { name: "expires_on", label: "Expires on", kind: "date", help: DATE_HELP },
      { name: "renewal_required", label: "Renewal required", kind: "checkbox" },
      { name: "reminder_days_before", label: "Remind me this many days before it expires", kind: "number" },
    ],
  },
  languages: {
    label: "Languages",
    singular: "language",
    description: "Languages you work in.",
    titleFields: ["name"],
    fields: [
      { name: "name", label: "Language", kind: "text", required: true },
      { name: "speaking", label: "Speaking", kind: "select", options: PROFICIENCY, required: true },
      { name: "reading", label: "Reading", kind: "select", options: PROFICIENCY, required: true },
      { name: "writing", label: "Writing", kind: "select", options: PROFICIENCY, required: true },
      { name: "years_used", label: "Years used", kind: "number" },
      { name: "certification_name", label: "Certification", kind: "text" },
    ],
  },
  awards: {
    label: "Awards",
    singular: "award",
    description: "Recognition you have received.",
    titleFields: ["name"],
    fields: [
      { name: "name", label: "Award", kind: "text", required: true },
      { name: "issuing_organization", label: "Issued by", kind: "text", required: true },
      { name: "received_on", label: "Received on", kind: "date", help: DATE_HELP },
      { name: "description", label: "Description", kind: "textarea" },
      { name: "evidence_url", label: "Evidence link", kind: "text" },
    ],
  },
  publications: {
    label: "Publications",
    singular: "publication",
    description: "Articles, books, papers, and talks in print.",
    titleFields: ["title"],
    fields: [
      { name: "title", label: "Title", kind: "text", required: true },
      { name: "kind", label: "Type", kind: "text", required: true, help: "For example: article, book, whitepaper." },
      { name: "organization_or_venue", label: "Publisher or venue", kind: "text" },
      { name: "published_on", label: "Published on", kind: "date", help: DATE_HELP },
      { name: "url", label: "Link", kind: "text" },
      { name: "co_authors", label: "Co-authors", kind: "list", help: COMMA_HELP },
      { name: "description", label: "Description", kind: "textarea" },
    ],
  },
  patents: {
    label: "Patents",
    singular: "patent",
    description: "Filed and granted patents.",
    titleFields: ["title"],
    fields: [
      { name: "title", label: "Title", kind: "text", required: true },
      { name: "patent_number", label: "Patent number", kind: "text" },
      { name: "jurisdiction", label: "Jurisdiction", kind: "text" },
      { name: "status", label: "Status", kind: "text" },
      { name: "filed_on", label: "Filed on", kind: "date", help: DATE_HELP },
      { name: "granted_on", label: "Granted on", kind: "date", help: DATE_HELP },
      { name: "url", label: "Link", kind: "text" },
    ],
  },
  speaking: {
    label: "Speaking",
    singular: "engagement",
    description: "Keynotes, panels, and workshops.",
    titleFields: ["title"],
    fields: [
      { name: "title", label: "Talk title", kind: "text", required: true },
      { name: "event", label: "Event", kind: "text", required: true },
      { name: "engagement_type", label: "Type", kind: "text", required: true, help: "For example: keynote, panel, workshop." },
      { name: "occurred_on", label: "Date", kind: "date", help: DATE_HELP },
      { name: "url", label: "Link", kind: "text" },
      { name: "description", label: "Description", kind: "textarea" },
    ],
  },
  memberships: {
    label: "Memberships",
    singular: "membership",
    description: "Professional associations and groups.",
    titleFields: ["organization"],
    fields: [
      { name: "organization", label: "Organization", kind: "text", required: true },
      { name: "membership_type", label: "Membership type", kind: "text" },
      { name: "member_since", label: "Member since", kind: "date", help: DATE_HELP },
      { name: "expires_on", label: "Expires on", kind: "date", help: DATE_HELP },
      { name: "leadership_roles", label: "Leadership roles", kind: "list", help: COMMA_HELP },
    ],
  },
  clearances: {
    label: "Clearances",
    singular: "clearance",
    description: "Security clearances and their status.",
    titleFields: ["clearance_type"],
    fields: [
      { name: "clearance_type", label: "Clearance type", kind: "text", required: true },
      { name: "country", label: "Country", kind: "text", required: true },
      { name: "status", label: "Status", kind: "select", options: ["active", "expired", "inactive"], required: true },
      { name: "granted_on", label: "Granted on", kind: "date", help: DATE_HELP },
      { name: "expires_on", label: "Expires on", kind: "date", help: DATE_HELP },
      { name: "agency", label: "Granting agency", kind: "text", sensitive: true },
      { name: "sponsor", label: "Sponsor", kind: "text", sensitive: true },
      { name: "polygraph_type", label: "Polygraph type", kind: "text" },
    ],
  },
  service: {
    label: "Service",
    singular: "service record",
    description: "Board seats, volunteering, and advisory work.",
    titleFields: ["organization"],
    fields: [
      { name: "organization", label: "Organization", kind: "text", required: true },
      { name: "role", label: "Role", kind: "text", required: true },
      { name: "service_type", label: "Type", kind: "text", required: true, help: "For example: board, volunteer, advisory." },
      { name: "started_on", label: "Started on", kind: "date", help: DATE_HELP },
      { name: "ended_on", label: "Ended on", kind: "date", help: DATE_HELP },
      { name: "impact_metrics", label: "Impact metrics", kind: "list", help: COMMA_HELP },
      { name: "description", label: "Description", kind: "textarea" },
    ],
  },
  references: {
    label: "References",
    singular: "reference",
    description: "People who will vouch for you. Contact details are encrypted.",
    titleFields: ["name"],
    fields: [
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "relationship_description", label: "Relationship", kind: "text", required: true },
      { name: "organization", label: "Organization", kind: "text" },
      { name: "title", label: "Their title", kind: "text" },
      { name: "email", label: "Email", kind: "text", sensitive: true },
      { name: "phone", label: "Phone", kind: "text", sensitive: true },
      { name: "linkedin_url", label: "LinkedIn", kind: "text" },
      { name: "permission_to_contact", label: "Has agreed to be contacted", kind: "checkbox" },
      { name: "notes", label: "Private notes", kind: "textarea", sensitive: true },
    ],
  },
  contacts: {
    label: "Contacts",
    singular: "contact",
    description: "Recruiters, alumni, and people worth following up with.",
    titleFields: ["name"],
    fields: [
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "company", label: "Company", kind: "text" },
      { name: "title", label: "Their title", kind: "text" },
      { name: "relationship", label: "How you know them", kind: "text", help: "e.g. recruiter, alumni, former coworker" },
      { name: "contact_email", label: "Email", kind: "text" },
      { name: "linkedin_url", label: "LinkedIn", kind: "text" },
      { name: "last_contacted_on", label: "Last contacted", kind: "date", help: DATE_HELP },
      { name: "follow_up_on", label: "Follow up on", kind: "date", help: DATE_HELP },
      { name: "contact_notes", label: "Notes", kind: "textarea" },
    ],
  },
};

export const RECORD_RESOURCES = Object.keys(RECORD_SCHEMAS);

export function splitList(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(",")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => {
      if (!item || seen.has(item.toLowerCase())) return false;
      seen.add(item.toLowerCase());
      return true;
    });
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
