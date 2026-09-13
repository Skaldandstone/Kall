/** Empty means unset; zero is a real preference, including zero travel. */
export function optionalProfileNumber(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();
  return text === '' ? null : Number(text);
}

/**
 * The fixed option sets a career profile's work fields accept.
 *
 * Onboarding rendered these as chips while editing the same profile later
 * offered a bare comma-separated text box, so "On-Site" and "on_site" were
 * both things a person could end up storing for the same field. One
 * definition, used by both.
 */
export const WORK_TYPE_OPTIONS = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'on_site', label: 'On-Site' },
];

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'contract', label: 'Contract' },
  { value: 'full_time', label: 'Full Time' },
  { value: 'fractional', label: 'Fractional' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'salaried', label: 'Salaried' },
];
