/**
 * What each professional-record section actually asks for.
 *
 * The editor used to be a single textarea that took raw JSON, which meant
 * knowing the backend's field names to add a skill. These declarations drive
 * real labelled inputs instead; they mirror the SQLModel definitions in
 * backend/kall/models/profile.py, so keep them in step with those.
 */

export type FieldKind = 'text' | 'textarea' | 'date' | 'number' | 'select' | 'checkbox' | 'list';

export type RecordField = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Options for `select`. */
  options?: readonly string[];
  /** Shown under the input. */
  help?: string;
};

export type RecordSchema = {
  /** Singular noun for buttons and empty states. */
  singular: string;
  fields: readonly RecordField[];
  /** Fields used to title a saved row, in order of preference. */
  titleFields: readonly string[];
};

const PROFICIENCY = ['basic', 'conversational', 'professional', 'native'] as const;

// `list` fields post as string[]; the backend stores them as JSON columns.
const COMMA_HELP = 'Separate multiple values with commas.';

export const RECORD_SCHEMAS: Record<string, RecordSchema> = {
  skills: {
    singular: 'skill',
    titleFields: ['name'],
    fields: [
      { name: 'name', label: 'Skill', kind: 'text', required: true },
      { name: 'category', label: 'Category', kind: 'text', help: 'For example: Programming, Leadership.' },
      { name: 'proficiency', label: 'Proficiency', kind: 'select', options: PROFICIENCY },
      { name: 'years_experience', label: 'Years of experience', kind: 'number' },
      { name: 'last_used_year', label: 'Last used (year)', kind: 'number' },
      { name: 'is_primary', label: 'Highlight as a primary skill', kind: 'checkbox' },
    ],
  },
  education: {
    singular: 'qualification',
    titleFields: ['institution'],
    fields: [
      { name: 'institution', label: 'Institution', kind: 'text', required: true },
      { name: 'degree', label: 'Degree', kind: 'text' },
      { name: 'major', label: 'Major', kind: 'text' },
      { name: 'minor', label: 'Minor', kind: 'text' },
      { name: 'graduation_date', label: 'Graduation date', kind: 'date' },
      { name: 'gpa', label: 'GPA', kind: 'number' },
      { name: 'honors', label: 'Honors', kind: 'list', help: COMMA_HELP },
      { name: 'country', label: 'Country', kind: 'text' },
      { name: 'state_region', label: 'State or region', kind: 'text' },
    ],
  },
  certifications: {
    singular: 'certification',
    titleFields: ['name'],
    fields: [
      { name: 'name', label: 'Certification', kind: 'text', required: true },
      { name: 'issuing_organization', label: 'Issued by', kind: 'text', required: true },
      { name: 'verification_url', label: 'Verification link', kind: 'text' },
      { name: 'obtained_on', label: 'Obtained on', kind: 'date' },
      { name: 'expires_on', label: 'Expires on', kind: 'date' },
      { name: 'renewal_required', label: 'Renewal required', kind: 'checkbox' },
      { name: 'reminder_days_before', label: 'Remind me this many days before it expires', kind: 'number' },
    ],
  },
  languages: {
    singular: 'language',
    titleFields: ['name'],
    fields: [
      { name: 'name', label: 'Language', kind: 'text', required: true },
      { name: 'speaking', label: 'Speaking', kind: 'select', options: PROFICIENCY, required: true },
      { name: 'reading', label: 'Reading', kind: 'select', options: PROFICIENCY, required: true },
      { name: 'writing', label: 'Writing', kind: 'select', options: PROFICIENCY, required: true },
      { name: 'years_used', label: 'Years used', kind: 'number' },
      { name: 'certification_name', label: 'Certification', kind: 'text' },
    ],
  },
  awards: {
    singular: 'award',
    titleFields: ['name'],
    fields: [
      { name: 'name', label: 'Award', kind: 'text', required: true },
      { name: 'issuing_organization', label: 'Issued by', kind: 'text', required: true },
      { name: 'received_on', label: 'Received on', kind: 'date' },
      { name: 'description', label: 'Description', kind: 'textarea' },
      { name: 'evidence_url', label: 'Evidence link', kind: 'text' },
    ],
  },
  publications: {
    singular: 'publication',
    titleFields: ['title'],
    fields: [
      { name: 'title', label: 'Title', kind: 'text', required: true },
      { name: 'kind', label: 'Type', kind: 'text', required: true, help: 'For example: article, book, whitepaper.' },
      { name: 'organization_or_venue', label: 'Publisher or venue', kind: 'text' },
      { name: 'published_on', label: 'Published on', kind: 'date' },
      { name: 'url', label: 'Link', kind: 'text' },
      { name: 'co_authors', label: 'Co-authors', kind: 'list', help: COMMA_HELP },
      { name: 'description', label: 'Description', kind: 'textarea' },
    ],
  },
  patents: {
    singular: 'patent',
    titleFields: ['title'],
    fields: [
      { name: 'title', label: 'Title', kind: 'text', required: true },
      { name: 'patent_number', label: 'Patent number', kind: 'text' },
      { name: 'jurisdiction', label: 'Jurisdiction', kind: 'text' },
      { name: 'status', label: 'Status', kind: 'text' },
      { name: 'filed_on', label: 'Filed on', kind: 'date' },
      { name: 'granted_on', label: 'Granted on', kind: 'date' },
      { name: 'url', label: 'Link', kind: 'text' },
    ],
  },
  speaking: {
    singular: 'engagement',
    titleFields: ['title'],
    fields: [
      { name: 'title', label: 'Talk title', kind: 'text', required: true },
      { name: 'event', label: 'Event', kind: 'text', required: true },
      { name: 'engagement_type', label: 'Type', kind: 'text', required: true, help: 'For example: keynote, panel, workshop.' },
      { name: 'occurred_on', label: 'Date', kind: 'date' },
      { name: 'url', label: 'Link', kind: 'text' },
      { name: 'description', label: 'Description', kind: 'textarea' },
    ],
  },
  memberships: {
    singular: 'membership',
    titleFields: ['organization'],
    fields: [
      { name: 'organization', label: 'Organization', kind: 'text', required: true },
      { name: 'membership_type', label: 'Membership type', kind: 'text' },
      { name: 'member_since', label: 'Member since', kind: 'date' },
      { name: 'expires_on', label: 'Expires on', kind: 'date' },
      { name: 'leadership_roles', label: 'Leadership roles', kind: 'list', help: COMMA_HELP },
    ],
  },
  service: {
    singular: 'service record',
    titleFields: ['organization'],
    fields: [
      { name: 'organization', label: 'Organization', kind: 'text', required: true },
      { name: 'role', label: 'Role', kind: 'text', required: true },
      { name: 'service_type', label: 'Type', kind: 'text', required: true, help: 'For example: board, volunteer, advisory.' },
      { name: 'started_on', label: 'Started on', kind: 'date' },
      { name: 'ended_on', label: 'Ended on', kind: 'date' },
      { name: 'impact_metrics', label: 'Impact metrics', kind: 'list', help: COMMA_HELP },
      { name: 'description', label: 'Description', kind: 'textarea' },
    ],
  },
  references: {
    singular: 'reference',
    titleFields: ['name'],
    fields: [
      { name: 'name', label: 'Name', kind: 'text', required: true },
      { name: 'relationship_description', label: 'Relationship', kind: 'text', required: true },
      { name: 'organization', label: 'Organization', kind: 'text' },
      { name: 'title', label: 'Their title', kind: 'text' },
      { name: 'linkedin_url', label: 'LinkedIn', kind: 'text' },
      { name: 'permission_to_contact', label: 'Has agreed to be contacted', kind: 'checkbox' },
    ],
  },
};

export const RECORD_RESOURCES = Object.keys(RECORD_SCHEMAS);

export function resourceLabel(resource: string) {
  return resource.charAt(0).toUpperCase() + resource.slice(1);
}

/** Split a comma-separated entry into trimmed, de-duplicated values. */
export function splitList(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => {
      if (!item || seen.has(item.toLowerCase())) return false;
      seen.add(item.toLowerCase());
      return true;
    });
}
